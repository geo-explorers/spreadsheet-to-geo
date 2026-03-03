/**
 * Merge diff engine for Phase 4: Bulk Merge
 *
 * Compares keeper and merger EntityDetails to compute:
 * - Property transfers (unique properties on merger that keeper lacks)
 * - Conflict detection (both entities have a property with different values)
 * - Relation re-pointing (delete from merger, create on keeper)
 * - Relation dedup (skip relations keeper already has)
 * - Type union (transfer merger types not on keeper)
 * - Merger deletion (via buildDeleteOps)
 *
 * The diff engine is the core algorithmic component of the merge pipeline.
 * Everything else in the merge command is composition of existing infrastructure.
 */

import { Graph, SystemIds, type Op, type TypedValue } from '@geoprotocol/geo-sdk';
import type { EntityDetails } from '../api/geo-client.js';
import type { MergePairDiff, MergeConflict } from '../config/merge-types.js';
import { buildDeleteOps } from './delete-builder.js';

// ============================================================================
// Keeper relation dedup set
// ============================================================================

/**
 * Build a dedup set from keeper's existing relations for O(1) duplicate checking.
 * Keys encode direction + other entity + relation type so we can detect when
 * a merger relation already exists on the keeper (and should be skipped).
 */
export function buildKeeperRelationSet(keeper: EntityDetails): Set<string> {
  const dedupSet = new Set<string>();

  // Outgoing relations
  for (const rel of keeper.relations) {
    dedupSet.add(`out:${rel.toEntity.id}:${rel.typeId}`);
  }

  // Incoming backlinks
  for (const bl of keeper.backlinks) {
    dedupSet.add(`in:${bl.fromEntity.id}:${bl.typeId}`);
  }

  return dedupSet;
}

// ============================================================================
// Typed value extraction from EntityDetails values
// ============================================================================

/**
 * Extract the non-null field from an EntityDetails value entry and reconstruct
 * a TypedValue for Graph.updateEntity.
 *
 * EntityDetails values come from the GraphQL API with exactly one non-null field
 * among: text, boolean, integer, float, date, time, datetime, point, schedule.
 *
 * Returns null for schedule properties (not transferable as simple TypedValue)
 * or if all fields are null.
 */
export function extractTypedValue(
  value: EntityDetails['values'][0]
): { typedValue: TypedValue; humanReadable: string } | null {
  if (value.text !== null && value.text !== undefined) {
    return {
      typedValue: { type: 'text', value: value.text },
      humanReadable: value.text,
    };
  }

  if (value.boolean !== null && value.boolean !== undefined) {
    return {
      typedValue: { type: 'boolean', value: value.boolean },
      humanReadable: String(value.boolean),
    };
  }

  if (value.integer !== null && value.integer !== undefined) {
    return {
      typedValue: { type: 'integer', value: value.integer },
      humanReadable: String(value.integer),
    };
  }

  if (value.float !== null && value.float !== undefined) {
    return {
      typedValue: { type: 'float', value: value.float },
      humanReadable: String(value.float),
    };
  }

  if (value.date !== null && value.date !== undefined) {
    return {
      typedValue: { type: 'date', value: value.date },
      humanReadable: value.date,
    };
  }

  if (value.time !== null && value.time !== undefined) {
    return {
      typedValue: { type: 'time', value: value.time },
      humanReadable: value.time,
    };
  }

  if (value.datetime !== null && value.datetime !== undefined) {
    return {
      typedValue: { type: 'datetime', value: value.datetime },
      humanReadable: value.datetime,
    };
  }

  if (value.point !== null && value.point !== undefined) {
    // Point is stored as a string in EntityDetails (e.g., "lat,lon").
    // The SDK TypedValue for point uses { type: 'point', lat, lon }.
    const parts = value.point.split(',').map(p => Number.parseFloat(p.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return {
        typedValue: { type: 'point', lat: parts[0], lon: parts[1] },
        humanReadable: value.point,
      };
    }
    // If point string can't be parsed, skip it
    return null;
  }

  // Schedule properties are not transferable as simple TypedValue
  if (value.schedule !== null && value.schedule !== undefined) {
    return null;
  }

  // All fields null
  return null;
}

// ============================================================================
// Core diff engine
// ============================================================================

/**
 * Compare keeper and merger entities to compute what to transfer.
 *
 * Property comparison:
 * - Merger properties not on keeper are transferred (except NAME_PROPERTY)
 * - Merger properties also on keeper with different values become conflicts
 * - Same-value properties are silently skipped
 *
 * Relation comparison:
 * - Outgoing/incoming relations on merger are re-pointed to keeper unless
 *   keeper already has the equivalent (dedup)
 * - Type assignment relations (TYPES_PROPERTY) are handled separately
 *
 * Type comparison:
 * - Merger types not on keeper are transferred (union)
 *
 * Merger deletion:
 * - Uses buildDeleteOps() to produce blank-out ops for the merger entity
 */
export function computeMergePairDiff(
  keeper: EntityDetails,
  merger: EntityDetails
): MergePairDiff {
  // -- Property comparison --

  // Build a Map of keeper's properties: propertyId -> humanReadableValue
  const keeperPropertyMap = new Map<string, string>();
  for (const val of keeper.values) {
    const extracted = extractTypedValue(val);
    if (extracted) {
      keeperPropertyMap.set(val.propertyId, extracted.humanReadable);
    }
  }

  const propertiesToTransfer: MergePairDiff['propertiesToTransfer'] = [];
  const conflicts: MergeConflict[] = [];

  for (const mergerVal of merger.values) {
    // SKIP NAME_PROPERTY -- keeper's name is canonical
    if (mergerVal.propertyId === SystemIds.NAME_PROPERTY) {
      continue;
    }

    const extracted = extractTypedValue(mergerVal);
    if (!extracted) {
      continue; // Null or untransferable (schedule)
    }

    const keeperHumanValue = keeperPropertyMap.get(mergerVal.propertyId);

    if (keeperHumanValue !== undefined) {
      // Both entities have this property
      if (keeperHumanValue === extracted.humanReadable) {
        // Same value -- skip silently (not a conflict)
        continue;
      }
      // Different values -- conflict (keeper wins)
      conflicts.push({
        propertyId: mergerVal.propertyId,
        propertyName: mergerVal.propertyId, // We don't have the human name; use ID
        keeperValue: keeperHumanValue,
        mergerValue: extracted.humanReadable,
      });
    } else {
      // Keeper does NOT have this property -- transfer it
      propertiesToTransfer.push({
        propertyId: mergerVal.propertyId,
        propertyName: mergerVal.propertyId, // We don't have the human name; use ID
        mergerValue: extracted.humanReadable,
        typedValue: extracted.typedValue,
      });
    }
  }

  // -- Relation comparison --

  const keeperRelationSet = buildKeeperRelationSet(keeper);
  const relationsToRepoint: MergePairDiff['relationsToRepoint'] = [];
  const relationsSkipped: MergePairDiff['relationsSkipped'] = [];

  // Outgoing relations from merger
  for (const rel of merger.relations) {
    // Skip type assignment relations -- handled separately in type comparison
    if (rel.typeId === SystemIds.TYPES_PROPERTY) {
      continue;
    }

    const dedupKey = `out:${rel.toEntity.id}:${rel.typeId}`;

    if (keeperRelationSet.has(dedupKey)) {
      relationsSkipped.push({
        direction: 'outgoing',
        typeId: rel.typeId,
        otherEntityId: rel.toEntity.id,
        otherEntityName: rel.toEntity.name ?? rel.toEntity.id,
      });
    } else {
      relationsToRepoint.push({
        relationId: rel.id,
        direction: 'outgoing',
        typeId: rel.typeId,
        otherEntityId: rel.toEntity.id,
        otherEntityName: rel.toEntity.name ?? rel.toEntity.id,
      });
    }
  }

  // Incoming relations (backlinks) on merger
  for (const bl of merger.backlinks) {
    // Skip backlinks FROM the keeper entity itself (self-referential after merge would be odd)
    if (bl.fromEntity.id === keeper.id) {
      continue;
    }

    const dedupKey = `in:${bl.fromEntity.id}:${bl.typeId}`;

    if (keeperRelationSet.has(dedupKey)) {
      relationsSkipped.push({
        direction: 'incoming',
        typeId: bl.typeId,
        otherEntityId: bl.fromEntity.id,
        otherEntityName: bl.fromEntity.name ?? bl.fromEntity.id,
      });
    } else {
      relationsToRepoint.push({
        relationId: bl.id,
        direction: 'incoming',
        typeId: bl.typeId,
        otherEntityId: bl.fromEntity.id,
        otherEntityName: bl.fromEntity.name ?? bl.fromEntity.id,
      });
    }
  }

  // -- Type comparison (union) --

  const typesToTransfer = merger.typeIds.filter(t => !keeper.typeIds.includes(t));

  // -- Merger deletion ops --

  const deleteResult = buildDeleteOps([merger]);

  return {
    keeperName: keeper.name ?? keeper.id,
    keeperId: keeper.id,
    mergerName: merger.name ?? merger.id,
    mergerId: merger.id,
    propertiesToTransfer,
    conflicts,
    relationsToRepoint,
    relationsSkipped,
    typesToTransfer,
    mergerDeleteOps: deleteResult.ops,
  };
}

// ============================================================================
// Op builder
// ============================================================================

/**
 * Convert a MergePairDiff into an Op[] array for a single atomic publish.
 *
 * Order of ops:
 * 1. Property transfer (updateEntity with values and/or description)
 * 2. Type assignment (createRelation for each new type)
 * 3. Relation re-pointing (deleteRelation old + createRelation new)
 * 4. Merger deletion (from buildDeleteOps)
 */
export function buildMergeOps(diff: MergePairDiff, keeperId: string): Op[] {
  const allOps: Op[] = [];

  // 1. Property transfer ops
  // Separate description from regular properties (same pattern as update command's publish phase)
  const descriptionTransfer = diff.propertiesToTransfer.find(
    p => p.propertyId === SystemIds.DESCRIPTION_PROPERTY
  );
  const regularTransfers = diff.propertiesToTransfer.filter(
    p => p.propertyId !== SystemIds.DESCRIPTION_PROPERTY
  );

  // Build values array from regular transfers: { property, ...typedValue }
  const values = regularTransfers.map(p => ({
    property: p.propertyId,
    ...p.typedValue,
  }));

  // Build description string if transferring description
  const description = descriptionTransfer?.mergerValue;

  if (values.length > 0 || description) {
    const updateParams: {
      id: string;
      values?: typeof values;
      description?: string;
    } = { id: keeperId };

    if (values.length > 0) {
      updateParams.values = values;
    }
    if (description) {
      updateParams.description = description;
    }

    const { ops } = Graph.updateEntity(updateParams);
    allOps.push(...ops);
  }

  // 2. Type assignment ops
  for (const typeId of diff.typesToTransfer) {
    const { ops } = Graph.createRelation({
      fromEntity: keeperId,
      toEntity: typeId,
      type: SystemIds.TYPES_PROPERTY,
    });
    allOps.push(...ops);
  }

  // 3. Relation re-pointing ops (delete old + create new)
  for (const rel of diff.relationsToRepoint) {
    // Delete the old relation from the merger
    const { ops: deleteOps } = Graph.deleteRelation({ id: rel.relationId });
    allOps.push(...deleteOps);

    // Create the new relation on the keeper
    // CRITICAL: For incoming (backlinks), fromEntity is the third-party entity (otherEntityId),
    // NOT the keeper. See RESEARCH.md Pitfall 5.
    if (rel.direction === 'outgoing') {
      const { ops: createOps } = Graph.createRelation({
        fromEntity: keeperId,
        toEntity: rel.otherEntityId,
        type: rel.typeId,
      });
      allOps.push(...createOps);
    } else {
      // incoming: the third-party entity points TO the keeper
      const { ops: createOps } = Graph.createRelation({
        fromEntity: rel.otherEntityId,
        toEntity: keeperId,
        type: rel.typeId,
      });
      allOps.push(...createOps);
    }
  }

  // 4. Merger deletion ops
  allOps.push(...diff.mergerDeleteOps);

  return allOps;
}
