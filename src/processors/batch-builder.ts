/**
 * Build operations batch for publishing to Geo
 *
 * Updated for new spreadsheet format:
 * - No "Geo ID" columns - use action='CREATE' or 'LINK' from EntityMap
 * - Skip operations for linked entities/types/properties
 * - Only create operations for items with action='CREATE'
 */

import {
  Graph,
  type Op,
  type DataType,
  type TypedValue,
  type PropertyValueParam,
} from '@geoprotocol/geo-sdk';
import type {
  ParsedSpreadsheet,
  EntityMap,
  OperationsBatch,
  BatchSummary,
  PropertyDefinition,
} from '../config/schema.js';
import type { RelationToCreate } from './relation-builder.js';
import { normalizeEntityName, parseDate, parseTime, parseDatetime } from '../utils/cell-parsers.js';
import { logger } from '../utils/logger.js';

/**
 * Build operations batch from parsed data using the Geo SDK directly
 */
export function buildOperationsBatch(
  data: ParsedSpreadsheet,
  entityMap: EntityMap,
  relations: RelationToCreate[]
): OperationsBatch {
  logger.section('Building Operations Batch');

  const ops: Op[] = [];
  const summary: BatchSummary = {
    typesCreated: 0,
    typesLinked: 0,
    propertiesCreated: 0,
    propertiesLinked: 0,
    entitiesCreated: 0,
    entitiesLinked: 0,
    relationsCreated: 0,
    multiTypeEntities: [],
  };

  // Phase 1: Create properties (that need to be created)
  logger.subsection('Phase 1: Properties');
  buildPropertyOps(data.properties, entityMap, ops, summary);

  // Phase 2: Create types (that need to be created)
  logger.subsection('Phase 2: Types');
  buildTypeOps(data.types, entityMap, ops, summary);

  // Phase 3: Create entities (skip linked entities)
  logger.subsection('Phase 3: Entities');
  buildEntityOps(data, entityMap, ops, summary);

  // Phase 4: Create relations
  logger.subsection('Phase 4: Relations');
  buildRelationOps(relations, entityMap, ops, summary);

  // Detect multi-type entities for summary
  summary.multiTypeEntities = Array.from(entityMap.entities.values())
    .filter(e => e.types.length > 1)
    .map(e => ({ name: e.name, types: e.types }));

  logger.success('Operations batch built', {
    totalOps: ops.length,
    propertiesCreated: summary.propertiesCreated,
    typesCreated: summary.typesCreated,
    entitiesCreated: summary.entitiesCreated,
    relationsCreated: summary.relationsCreated,
  });

  return { ops, summary };
}

/**
 * Build property creation operations using Graph.createProperty()
 * Only creates properties with action='CREATE'
 */
function buildPropertyOps(
  properties: PropertyDefinition[],
  entityMap: EntityMap,
  ops: Op[],
  summary: BatchSummary
): void {
  for (const prop of properties) {
    const normalized = normalizeEntityName(prop.name);
    const resolved = entityMap.properties.get(normalized);

    if (!resolved) {
      logger.warn(`Property not found in map: ${prop.name}`);
      continue;
    }

    if (resolved.action === 'LINK') {
      // Already exists - just link
      summary.propertiesLinked++;
      logger.debug(`Property LINK: ${prop.name}`, { id: resolved.id });
      continue;
    }

    // Need to create
    const { ops: propertyOps } = Graph.createProperty({
      id: resolved.id,
      name: prop.name,
      dataType: prop.dataType as DataType,
      description: prop.description,
    });

    ops.push(...propertyOps);
    summary.propertiesCreated++;

    logger.debug(`Property CREATE: ${prop.name}`, { id: resolved.id });
  }
}

/**
 * Build type creation operations using Graph.createType()
 * Only creates types with action='CREATE'
 */
function buildTypeOps(
  types: ParsedSpreadsheet['types'],
  entityMap: EntityMap,
  ops: Op[],
  summary: BatchSummary
): void {
  for (const type of types) {
    const normalized = normalizeEntityName(type.name);
    const resolved = entityMap.types.get(normalized);

    if (!resolved) {
      logger.warn(`Type not found in map: ${type.name}`);
      continue;
    }

    if (resolved.action === 'LINK') {
      // Already exists - just link
      summary.typesLinked++;
      logger.debug(`Type LINK: ${type.name}`, { id: resolved.id });
      continue;
    }

    // Need to create
    const { ops: typeOps } = Graph.createType({
      id: resolved.id,
      name: type.name,
      description: type.description,
    });

    ops.push(...typeOps);
    summary.typesCreated++;

    logger.debug(`Type CREATE: ${type.name}`, { id: resolved.id });
  }
}

/**
 * Build entity creation operations using Graph.createEntity()
 * Only creates entities with action='CREATE'
 */
function buildEntityOps(
  data: ParsedSpreadsheet,
  entityMap: EntityMap,
  ops: Op[],
  summary: BatchSummary
): void {
  // Track processed entities to avoid duplicates
  const processedNames = new Set<string>();

  for (const spreadsheetEntity of data.entities) {
    const normalized = normalizeEntityName(spreadsheetEntity.name);

    // Skip if already processed (same entity in multiple tabs)
    if (processedNames.has(normalized)) {
      continue;
    }
    processedNames.add(normalized);

    const entity = entityMap.entities.get(normalized);

    if (!entity) {
      logger.warn(`Entity not found in map: ${spreadsheetEntity.name}`);
      continue;
    }

    if (entity.action === 'LINK') {
      // Already exists in Geo - don't create
      summary.entitiesLinked++;
      logger.debug(`Entity LINK: ${spreadsheetEntity.name}`, { id: entity.id });
      continue;
    }

    // Build property values using SDK types
    const values = buildPropertyValues(spreadsheetEntity.properties, entityMap);

    // Case-insensitive description lookup — curator may write Description or description
    const descriptionKey = Object.keys(spreadsheetEntity.properties).find(
      k => k.toLowerCase() === 'description'
    );
    const description = descriptionKey ? spreadsheetEntity.properties[descriptionKey] : undefined;

    // Use SDK to create entity
    const { ops: entityOps } = Graph.createEntity({
      id: entity.id,
      name: spreadsheetEntity.name,
      description,
      types: entity.typeIds,
      values,
    });

    ops.push(...entityOps);
    summary.entitiesCreated++;

    logger.debug(`Entity CREATE: ${spreadsheetEntity.name}`, {
      id: entity.id,
      types: entity.types,
      valueCount: values.length,
    });
  }

  // Also create relation target entities that don't have their own rows
  // These are entities referenced in relations but not in any entity tab
  for (const [normalized, entity] of entityMap.entities) {
    if (processedNames.has(normalized)) {
      continue;
    }

    if (entity.action === 'LINK') {
      // Relation target found in Geo — link it, no ops needed
      summary.entitiesLinked++;
      continue;
    }

    // This is a relation target that needs to be created
    // (entity referenced but not defined in spreadsheet)
    if (entity.typeIds.length === 0) {
      logger.warn(`Skipping entity "${entity.name}" - no types defined and not found in Geo`);
      continue;
    }

    const { ops: entityOps } = Graph.createEntity({
      id: entity.id,
      name: entity.name,
      types: entity.typeIds,
    });

    ops.push(...entityOps);
    summary.entitiesCreated++;

    logger.debug(`Entity CREATE (relation target): ${entity.name}`, {
      id: entity.id,
      types: entity.types,
    });
  }
}

/**
 * Build relation creation operations using Graph.createRelation()
 */
function buildRelationOps(
  relations: RelationToCreate[],
  entityMap: EntityMap,
  ops: Op[],
  summary: BatchSummary
): void {
  for (const relation of relations) {
    // Use SDK to create relation
    const { ops: relationOps } = Graph.createRelation({
      fromEntity: relation.fromEntityId,
      toEntity: relation.toEntityId,
      type: relation.propertyId,
    });

    ops.push(...relationOps);
    summary.relationsCreated++;

    logger.debug('Relation CREATE', {
      from: relation.fromEntityName,
      to: relation.toEntityName,
      via: relation.propertyName,
    });
  }
}

/**
 * Build property values array using SDK's PropertyValueParam type
 */
function buildPropertyValues(
  properties: Record<string, string>,
  entityMap: EntityMap
): PropertyValueParam[] {
  const values: PropertyValueParam[] = [];

  for (const [propertyName, value] of Object.entries(properties)) {
    if (!value) continue;

    // Skip description - handled separately
    if (normalizeEntityName(propertyName) === 'description') continue;

    // Get property definition
    const propDef = entityMap.propertyDefinitions.get(normalizeEntityName(propertyName));
    if (!propDef) {
      logger.warn(`Unknown property: ${propertyName}`);
      continue;
    }

    // Skip relation properties - handled separately
    if (propDef.dataType === 'RELATION') continue;

    // Get property ID from resolved property
    const resolved = entityMap.properties.get(normalizeEntityName(propertyName));
    if (!resolved) continue;

    // Convert value to SDK TypedValue format
    const typedValue = convertToTypedValue(value, propDef.dataType);
    if (!typedValue) continue;

    values.push({
      property: resolved.id,
      ...typedValue,
    });
  }

  return values;
}

/**
 * Convert spreadsheet value to SDK TypedValue format
 */
function convertToTypedValue(
  value: string,
  dataType: PropertyDefinition['dataType']
): TypedValue | undefined {
  switch (dataType) {
    case 'TEXT':
      return { type: 'text', value };

    case 'INTEGER': {
      const intVal = parseInt(value, 10);
      if (isNaN(intVal)) return undefined;
      return { type: 'integer', value: intVal };
    }

    case 'FLOAT': {
      const floatVal = parseFloat(value);
      if (isNaN(floatVal)) return undefined;
      return { type: 'float', value: floatVal };
    }

    case 'DATE': {
      const dateVal = parseDate(value);
      if (!dateVal) return undefined;
      return { type: 'date', value: dateVal };
    }

    case 'TIME': {
      const timeVal = parseTime(value);
      if (!timeVal) return undefined;
      return { type: 'time', value: timeVal };
    }

    case 'DATETIME': {
      const datetimeVal = parseDatetime(value);
      if (!datetimeVal) return undefined;
      return { type: 'datetime', value: datetimeVal };
    }

    case 'BOOLEAN': {
      const lower = value.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(lower)) return { type: 'boolean', value: true };
      if (['false', 'no', 'n', '0'].includes(lower)) return { type: 'boolean', value: false };
      return undefined;
    }

    case 'POINT': {
      // Parse "lat,lon" format
      const parts = value.split(',').map(p => parseFloat(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { type: 'point', lat: parts[0], lon: parts[1] };
      }
      return undefined;
    }

    default:
      return { type: 'text', value };
  }
}

/**
 * Get batch summary as printable table
 */
export function formatBatchSummary(summary: BatchSummary): string {
  const lines = [
    '',
    'Batch Summary',
    '─'.repeat(40),
    `Properties: ${summary.propertiesCreated} create, ${summary.propertiesLinked} link`,
    `Types:      ${summary.typesCreated} create, ${summary.typesLinked} link`,
    `Entities:   ${summary.entitiesCreated} create, ${summary.entitiesLinked} link`,
    `Relations:  ${summary.relationsCreated} create`,
    '─'.repeat(40),
  ];

  if (summary.multiTypeEntities.length > 0) {
    lines.push('Multi-type entities:');
    for (const { name, types } of summary.multiTypeEntities) {
      lines.push(`  • ${name}: ${types.join(', ')}`);
    }
  }

  return lines.join('\n');
}
