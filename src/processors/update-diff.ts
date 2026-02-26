/**
 * Diff engine for the update command
 *
 * Compares spreadsheet values against live Geo entity state and produces
 * typed diffs. The diff captures per-entity scalar and relation changes,
 * which the update command handler will convert into SDK ops.
 *
 * Key design notes:
 * - Blank spreadsheet cells are ALWAYS skipped (never produce a diff entry or an op).
 *   This is the UPD-04 override: blank = "no opinion", not "unset".
 * - The --additive flag causes relation diffs to only add, never remove.
 * - Relation property ID IS the relation type ID (relation.typeId === resolvedProperty.id).
 * - Values are compared in canonical form, not raw strings. The Geo API may return
 *   dates as ISO datetime, booleans as true/false, numbers as strings, etc.
 * - Hard-error if any fetchEntityDetails call returns null (API failure, not "doesn't exist").
 */

import { fetchEntityDetails } from '../api/geo-client.js';
import type { EntityDetails } from '../api/geo-client.js';
import { normalizeEntityName, parseDate, parseDatetime, parseTime, convertToTypedValue } from '../utils/cell-parsers.js';
import type { PropertyDiff, RelationDiff, EntityDiff, DiffSummary } from '../config/update-types.js';
import { SystemIds } from '@geoprotocol/geo-sdk';
import { logger } from '../utils/logger.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute diffs for all entities by comparing spreadsheet data against live state.
 *
 * @param entities     Array of { name, properties, relations } from parsed spreadsheet
 * @param resolvedEntities  Map of normalized name -> { id, name } (resolved entity IDs)
 * @param propertyDefs      Map of normalized property name -> { id, dataType, ... }
 * @param spaceId           Target space ID
 * @param network           TESTNET or MAINNET
 * @param options           { additive, verbose }
 * @returns { diffs, summary }
 */
export async function computeEntityDiffs(
  entities: Array<{
    name: string;
    properties: Record<string, string>;
    relations: Record<string, string[]>;
  }>,
  resolvedEntities: Map<string, { id: string; name: string }>,
  propertyDefs: Map<string, { id: string; dataType: string }>,
  spaceId: string,
  network: 'TESTNET' | 'MAINNET',
  options: { additive: boolean; verbose: boolean }
): Promise<{ diffs: EntityDiff[]; summary: DiffSummary }> {

  // Step 1: Collect all entity IDs that need detail fetching
  const entityIdsToFetch: Array<{ entityId: string; entityName: string }> = [];
  for (const entity of entities) {
    const normalized = normalizeEntityName(entity.name);
    const resolved = resolvedEntities.get(normalized);
    if (!resolved) {
      logger.warn(`Entity "${entity.name}" not found in resolved entities -- skipping diff`);
      continue;
    }
    entityIdsToFetch.push({ entityId: resolved.id, entityName: entity.name });
  }

  // Step 2: Batch-fetch entity details with concurrency of 10
  logger.info(`Fetching details for ${entityIdsToFetch.length} entities...`);
  const detailsMap = new Map<string, EntityDetails>();
  const batchSize = 10;

  for (let i = 0; i < entityIdsToFetch.length; i += batchSize) {
    const batch = entityIdsToFetch.slice(i, i + batchSize);
    const promises = batch.map(({ entityId }) =>
      fetchEntityDetails(entityId, spaceId, network)
    );

    const results = await Promise.all(promises);

    for (let j = 0; j < batch.length; j++) {
      const details = results[j];
      const { entityId, entityName } = batch[j];

      // Hard-error: if an entity exists but details can't be fetched, it's an API failure
      if (!details) {
        throw new Error(
          `Failed to fetch details for entity "${entityName}" (ID: ${entityId}). ` +
          `This is likely an API failure. Cannot proceed with partial data.`
        );
      }

      detailsMap.set(entityId, details);
    }

    if (entityIdsToFetch.length > batchSize) {
      logger.info(`Fetched ${Math.min(i + batchSize, entityIdsToFetch.length)}/${entityIdsToFetch.length} entity details...`);
    }
  }

  // Step 3: Compute per-entity diffs
  const diffs: EntityDiff[] = [];

  for (const entity of entities) {
    const normalized = normalizeEntityName(entity.name);
    const resolved = resolvedEntities.get(normalized);
    if (!resolved) continue; // Already warned above

    const details = detailsMap.get(resolved.id);
    if (!details) continue; // Should not happen due to hard-error above

    const diff = diffEntity(entity, details, propertyDefs, resolvedEntities, options);
    diffs.push(diff);
  }

  // Step 4: Aggregate summary
  const summary = computeDiffSummary(diffs);

  return { diffs, summary };
}

// ============================================================================
// Per-entity diff
// ============================================================================

/**
 * Compute diff for a single entity by comparing spreadsheet values against live details.
 */
export function diffEntity(
  entity: {
    name: string;
    properties: Record<string, string>;
    relations: Record<string, string[]>;
  },
  details: EntityDetails,
  propertyDefs: Map<string, { id: string; dataType: string }>,
  resolvedEntities: Map<string, { id: string; name: string }>,
  options: { additive: boolean; verbose: boolean }
): EntityDiff {
  const scalarChanges: PropertyDiff[] = [];
  const relationChanges: RelationDiff[] = [];
  let unchangedScalarCount = 0;
  let unchangedRelationCount = 0;

  // Process scalar properties
  for (const [propertyName, value] of Object.entries(entity.properties)) {
    // Skip blank cells -- blank = "no opinion", not "unset" (UPD-04)
    if (!value || value.trim() === '') continue;

    const normalizedPropName = normalizeEntityName(propertyName);

    // Description is a system property — diff it using DESCRIPTION_PROPERTY ID
    if (normalizedPropName === 'description') {
      const descDiff = diffScalarProperty(
        'Description',
        SystemIds.DESCRIPTION_PROPERTY,
        value,
        details.values,
        'TEXT'
      );
      if (descDiff.type === 'set') {
        scalarChanges.push(descDiff);
      } else {
        unchangedScalarCount++;
      }
      continue;
    }

    const propDef = propertyDefs.get(normalizedPropName);
    if (!propDef) {
      if (options.verbose) {
        logger.debug(`Property "${propertyName}" not found in property defs -- skipping`);
      }
      continue;
    }

    // Skip relation properties (handled separately)
    if (propDef.dataType === 'RELATION') continue;

    const propDiff = diffScalarProperty(
      propertyName,
      propDef.id,
      value,
      details.values,
      propDef.dataType
    );

    if (propDiff.type === 'set') {
      scalarChanges.push(propDiff);
    } else {
      unchangedScalarCount++;
    }
  }

  // Process relation properties
  for (const [propertyName, targetNames] of Object.entries(entity.relations)) {
    // Skip blank/empty relation lists
    if (!targetNames || targetNames.length === 0) continue;

    const normalizedPropName = normalizeEntityName(propertyName);
    const propDef = propertyDefs.get(normalizedPropName);
    if (!propDef) {
      if (options.verbose) {
        logger.debug(`Relation property "${propertyName}" not found in property defs -- skipping`);
      }
      continue;
    }

    // Resolve target names to entity IDs
    const desiredTargetIds: string[] = [];
    for (const targetName of targetNames) {
      const normalizedTarget = normalizeEntityName(targetName);
      const resolvedTarget = resolvedEntities.get(normalizedTarget);
      if (resolvedTarget) {
        desiredTargetIds.push(resolvedTarget.id);
      } else if (options.verbose) {
        logger.debug(`Relation target "${targetName}" not resolved -- skipping`);
      }
    }

    const relDiff = diffRelationProperty(
      propDef.id,
      propertyName,
      desiredTargetIds,
      details.relations,
      resolvedEntities,
      options.additive
    );

    if (relDiff.toAdd.length > 0 || relDiff.toRemove.length > 0) {
      relationChanges.push(relDiff);
    } else {
      unchangedRelationCount++;
    }
  }

  const hasChanges = scalarChanges.length > 0 || relationChanges.length > 0;

  return {
    entityId: details.id,
    entityName: entity.name,
    status: hasChanges ? 'updated' : 'skipped',
    scalarChanges,
    relationChanges,
    unchangedScalarCount,
    unchangedRelationCount,
  };
}

// ============================================================================
// Scalar property diff
// ============================================================================

/**
 * Compare a single scalar property between spreadsheet value and live API state.
 * Both sides are normalized to canonical form before comparison to avoid
 * false diffs from format differences (e.g., ISO date vs "Jan 15, 2024").
 */
export function diffScalarProperty(
  propertyName: string,
  propertyId: string,
  spreadsheetValue: string,
  currentValues: EntityDetails['values'],
  dataType: string
): PropertyDiff {
  const currentRaw = getCurrentValueAsString(currentValues, propertyId, dataType);

  // Normalize both values to canonical form for comparison
  const normalizedNew = normalizeValue(spreadsheetValue, dataType);
  const normalizedCurrent = currentRaw !== null ? normalizeValue(currentRaw, dataType) : null;

  // Compare normalized values
  const isEqual = normalizedCurrent !== null && valuesAreEqual(normalizedNew, normalizedCurrent, dataType);

  if (isEqual) {
    return {
      propertyId,
      propertyName,
      type: 'unchanged',
      oldValue: currentRaw ?? undefined,
      newValue: spreadsheetValue,
    };
  }

  // Values differ -- compute the typed value for the SDK op
  const typedValue = convertToTypedValue(spreadsheetValue, dataType);

  return {
    propertyId,
    propertyName,
    type: 'set',
    oldValue: currentRaw ?? '(not set)',
    newValue: spreadsheetValue,
    typedValue: typedValue ?? undefined,
  };
}

// ============================================================================
// Relation property diff
// ============================================================================

/**
 * Compare relation targets between desired (spreadsheet) and current (API) state.
 *
 * Note: Relation property ID IS the relation type ID. When filtering current relations,
 * we match on `relation.typeId === propertyId`. This is documented in the Geo API:
 * relations have a typeId which corresponds to the property that defines the relation.
 */
export function diffRelationProperty(
  propertyId: string,
  propertyName: string,
  desiredTargetIds: string[],
  currentRelations: EntityDetails['relations'],
  resolvedEntities: Map<string, { id: string; name: string }>,
  additive: boolean
): RelationDiff {
  // Filter current relations to those matching this relation type
  const currentForType = currentRelations.filter(r => r.typeId === propertyId);

  // Build current target ID set
  const currentTargetSet = new Set(currentForType.map(r => r.toEntity.id));

  // Build desired target ID set
  const desiredSet = new Set(desiredTargetIds);

  // Build reverse lookup: entityId -> entityName from resolvedEntities
  const entityNameById = new Map<string, string>();
  for (const [, resolved] of resolvedEntities) {
    entityNameById.set(resolved.id, resolved.name);
  }

  // toAdd: desired but not in current
  const toAdd: RelationDiff['toAdd'] = [];
  for (const targetId of desiredTargetIds) {
    if (!currentTargetSet.has(targetId)) {
      toAdd.push({
        entityId: targetId,
        entityName: entityNameById.get(targetId) ?? targetId,
      });
    }
  }

  // toRemove: current but not in desired (unless additive mode)
  const toRemove: RelationDiff['toRemove'] = [];
  if (!additive) {
    for (const rel of currentForType) {
      if (!desiredSet.has(rel.toEntity.id)) {
        toRemove.push({
          entityId: rel.toEntity.id,
          entityName: rel.toEntity.name ?? rel.toEntity.id,
          relationId: rel.id, // The relation's own ID, needed for deleteRelation()
        });
      }
    }
  }

  // unchanged: IDs in both sets
  const unchanged: RelationDiff['unchanged'] = [];
  for (const targetId of desiredTargetIds) {
    if (currentTargetSet.has(targetId)) {
      unchanged.push({
        entityId: targetId,
        entityName: entityNameById.get(targetId) ?? targetId,
      });
    }
  }

  return {
    propertyId,
    propertyName,
    toAdd,
    toRemove,
    unchanged,
  };
}

// ============================================================================
// Summary aggregation
// ============================================================================

/**
 * Aggregate diff counts across all entity diffs into a summary.
 */
export function computeDiffSummary(diffs: EntityDiff[]): DiffSummary {
  let entitiesWithChanges = 0;
  let entitiesSkipped = 0;
  let totalScalarChanges = 0;
  let totalRelationsAdded = 0;
  let totalRelationsRemoved = 0;

  for (const diff of diffs) {
    if (diff.status === 'updated') {
      entitiesWithChanges++;
    } else {
      entitiesSkipped++;
    }

    totalScalarChanges += diff.scalarChanges.length;

    for (const relDiff of diff.relationChanges) {
      totalRelationsAdded += relDiff.toAdd.length;
      totalRelationsRemoved += relDiff.toRemove.length;
    }
  }

  return {
    totalEntities: diffs.length,
    entitiesWithChanges,
    entitiesSkipped,
    totalScalarChanges,
    totalRelationsAdded,
    totalRelationsRemoved,
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Extract the current value for a property from EntityDetails values array.
 * Returns a string representation suitable for display and comparison.
 */
function getCurrentValueAsString(
  values: EntityDetails['values'],
  propertyId: string,
  dataType: string
): string | null {
  const match = values.find(v => v.propertyId === propertyId);
  if (!match) return null;

  switch (dataType) {
    case 'TEXT':
      return match.text;
    case 'BOOLEAN':
      return match.boolean !== null ? String(match.boolean) : null;
    case 'INTEGER':
      return match.integer !== null ? String(match.integer) : null;
    case 'FLOAT':
      return match.float !== null ? String(match.float) : null;
    case 'DATE':
      return match.date;
    case 'TIME':
      return match.time;
    case 'DATETIME':
      return match.datetime;
    case 'POINT':
      return match.point;
    case 'SCHEDULE':
      return match.schedule;
    default:
      return match.text;
  }
}

/**
 * Normalize a value to its canonical string form for comparison.
 * This avoids false diffs caused by format differences between
 * spreadsheet input and API response.
 */
function normalizeValue(value: string, dataType: string): string {
  const trimmed = value.trim();

  switch (dataType) {
    case 'TEXT':
      return trimmed;

    case 'DATE': {
      const parsed = parseDate(trimmed);
      return parsed ?? trimmed;
    }

    case 'DATETIME': {
      const parsed = parseDatetime(trimmed);
      return parsed ?? trimmed;
    }

    case 'TIME': {
      const parsed = parseTime(trimmed);
      return parsed ?? trimmed;
    }

    case 'BOOLEAN': {
      const lower = trimmed.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(lower)) return 'true';
      if (['false', 'no', 'n', '0'].includes(lower)) return 'false';
      return trimmed;
    }

    case 'INTEGER': {
      const intVal = parseInt(trimmed, 10);
      return isNaN(intVal) ? trimmed : String(intVal);
    }

    case 'FLOAT': {
      const floatVal = Number.parseFloat(trimmed);
      return isNaN(floatVal) ? trimmed : String(floatVal);
    }

    case 'POINT': {
      // Normalize to "lat,lon" with consistent precision
      const parts = trimmed.split(',').map(p => Number.parseFloat(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return `${parts[0]},${parts[1]}`;
      }
      return trimmed;
    }

    default:
      return trimmed;
  }
}

/**
 * Compare two normalized values for equality.
 * Uses type-specific comparison (e.g., epsilon for floats).
 */
function valuesAreEqual(a: string, b: string, dataType: string): boolean {
  if (dataType === 'FLOAT') {
    const fa = Number.parseFloat(a);
    const fb = Number.parseFloat(b);
    if (!isNaN(fa) && !isNaN(fb)) {
      // Use small epsilon for floating point comparison
      return Math.abs(fa - fb) < 1e-9;
    }
  }

  return a === b;
}

