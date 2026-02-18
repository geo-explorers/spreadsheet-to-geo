/**
 * Entity processing - resolve entities to CREATE or LINK actions
 *
 * Updated for new spreadsheet format:
 * - No "Geo ID" columns - use API search for deduplication
 * - Queries Geo API to find existing entities by exact name match
 * - Uses existing IDs for matches (LINK), generates new IDs for new entities (CREATE)
 */

import type {
  ParsedSpreadsheet,
  EntityMap,
  ResolvedEntity,
  ResolvedType,
  ResolvedProperty,
  PropertyDefinition,
  TypeDefinition,
} from '../config/schema.js';
import { normalizeEntityName, generateGeoId } from '../utils/cell-parsers.js';
import { logger } from '../utils/logger.js';
import {
  searchEntitiesByNames,
  searchTypesByNames,
  searchPropertiesByNames,
} from '../api/geo-client.js';

/**
 * Build entity map from parsed spreadsheet
 * Resolves all entities, types, and properties to their IDs
 *
 * Now async - queries Geo API for existing entities
 */
export async function buildEntityMap(
  data: ParsedSpreadsheet,
  network: 'TESTNET' | 'MAINNET'
): Promise<EntityMap> {
  logger.section('Building Entity Map');

  const entityMap: EntityMap = {
    entities: new Map(),
    types: new Map(),
    properties: new Map(),
    propertyDefinitions: new Map(),
  };

  // 1. Collect all unique entity names (main entities + relation targets)
  const allEntityNames = collectAllEntityNames(data);
  logger.info(`Found ${allEntityNames.size} unique entity names`);

  // 2. Collect all type names
  const allTypeNames = data.types.map(t => t.name);
  logger.info(`Found ${allTypeNames.length} type definitions`);

  // 3. Collect all property names
  const allPropertyNames = data.properties.map(p => p.name);
  logger.info(`Found ${allPropertyNames.length} property definitions`);

  // 4. Query Geo API for existing entities, types, and properties
  logger.subsection('Querying Geo API');

  const [existingEntities, existingTypes, existingProperties] = await Promise.all([
    searchEntitiesByNames(Array.from(allEntityNames), data.metadata.spaceId, network),
    searchTypesByNames(allTypeNames, network),
    searchPropertiesByNames(allPropertyNames, network),
  ]);

  logger.info(`API Results`, {
    entitiesFound: existingEntities.size,
    typesFound: existingTypes.size,
    propertiesFound: existingProperties.size,
  });

  // 5. Process types - use existing IDs or generate new
  await processTypes(data.types, entityMap, existingTypes);

  // 6. Process properties - use existing IDs or generate new
  await processProperties(data.properties, entityMap, existingProperties);

  // 7. Process all entities - use existing IDs or generate new
  await processEntities(data.entities, entityMap, existingEntities);

  // 8. Detect multi-type entities
  detectMultiTypeEntities(entityMap);

  logger.success('Entity map built', {
    types: entityMap.types.size,
    properties: entityMap.properties.size,
    entities: entityMap.entities.size,
  });

  return entityMap;
}

/**
 * Collect all unique entity names from spreadsheet
 * Includes main entities AND relation targets
 */
function collectAllEntityNames(data: ParsedSpreadsheet): Set<string> {
  const names = new Set<string>();

  // Add all main entity names
  for (const entity of data.entities) {
    names.add(entity.name);

    // Add all relation target names
    for (const targets of Object.values(entity.relations)) {
      for (const target of targets) {
        names.add(target);
      }
    }
  }

  return names;
}

/**
 * Process types - check API results and assign IDs
 */
async function processTypes(
  types: TypeDefinition[],
  entityMap: EntityMap,
  existingTypes: Map<string, { id: string; name: string }>
): Promise<void> {
  logger.subsection('Processing Types');

  let created = 0;
  let linked = 0;

  for (const type of types) {
    const normalized = normalizeEntityName(type.name);
    const existing = existingTypes.get(normalized);

    if (existing) {
      // Link to existing type
      const resolved: ResolvedType = {
        name: type.name,
        id: existing.id,
        action: 'LINK',
      };
      entityMap.types.set(normalized, resolved);
      linked++;
      logger.debug(`Type: ${type.name} → LINK`, { id: existing.id });
    } else {
      // Create new type
      const resolved: ResolvedType = {
        name: type.name,
        id: generateGeoId(),
        action: 'CREATE',
      };
      entityMap.types.set(normalized, resolved);
      created++;
      logger.debug(`Type: ${type.name} → CREATE`, { id: resolved.id });
    }
  }

  logger.info(`Processed ${types.length} types`, { toCreate: created, toLink: linked });
}

/**
 * Process properties - check API results and assign IDs
 */
async function processProperties(
  properties: PropertyDefinition[],
  entityMap: EntityMap,
  existingProperties: Map<string, { id: string; name: string; dataTypeId: string; dataTypeName: string }>
): Promise<void> {
  logger.subsection('Processing Properties');

  let created = 0;
  let linked = 0;

  for (const prop of properties) {
    const normalized = normalizeEntityName(prop.name);
    const existing = existingProperties.get(normalized);

    // Store definition for later reference
    entityMap.propertyDefinitions.set(normalized, prop);

    if (existing) {
      // Link to existing property
      const resolved: ResolvedProperty = {
        name: prop.name,
        id: existing.id,
        action: 'LINK',
        definition: prop,
      };
      entityMap.properties.set(normalized, resolved);
      linked++;
      logger.debug(`Property: ${prop.name} → LINK`, {
        id: existing.id,
        dataType: existing.dataTypeName,
      });
    } else {
      // Create new property
      const resolved: ResolvedProperty = {
        name: prop.name,
        id: generateGeoId(),
        action: 'CREATE',
        definition: prop,
      };
      entityMap.properties.set(normalized, resolved);
      created++;
      logger.debug(`Property: ${prop.name} → CREATE`, {
        id: resolved.id,
        dataType: prop.dataType,
      });
    }
  }

  logger.info(`Processed ${properties.length} properties`, { toCreate: created, toLink: linked });
}

/**
 * Process entities - check API results and assign IDs
 */
async function processEntities(
  entities: Array<{
    name: string;
    types: string[];
    sourceTab: string;
    properties: Record<string, string>;
    relations: Record<string, string[]>;
  }>,
  entityMap: EntityMap,
  existingEntities: Map<string, { id: string; name: string; types: Array<{ id: string; name: string }>; spaceIds: string[] }>
): Promise<void> {
  logger.subsection('Processing Entities');

  let created = 0;
  let linked = 0;

  // Group entities by normalized name to handle duplicates across tabs
  const byName = new Map<string, {
    name: string;
    types: Set<string>;
    sourceTab: string;
    existing?: { id: string; name: string; types: Array<{ id: string; name: string }>; spaceIds: string[] };
  }>();

  // First pass: collect all entities and their types
  for (const entity of entities) {
    const normalized = normalizeEntityName(entity.name);
    const existing = existingEntities.get(normalized);

    if (!byName.has(normalized)) {
      byName.set(normalized, {
        name: entity.name,
        types: new Set(entity.types),
        sourceTab: entity.sourceTab,
        existing,
      });
    } else {
      // Merge types
      const data = byName.get(normalized)!;
      for (const t of entity.types) {
        data.types.add(t);
      }
    }
  }

  // Also add relation targets that aren't main entities
  // Per IDEA.md: types come from entity tabs only — relation targets with no tab have no types
  for (const entity of entities) {
    for (const targets of Object.values(entity.relations)) {
      for (const target of targets) {
        const normalized = normalizeEntityName(target);
        if (!byName.has(normalized)) {
          const existing = existingEntities.get(normalized);
          byName.set(normalized, {
            name: target,
            types: new Set(),
            sourceTab: '',
            existing,
          });
        }
      }
    }
  }

  // Second pass: create resolved entities
  for (const [normalized, data] of byName) {
    if (data.existing) {
      // Link to existing entity
      const resolved: ResolvedEntity = {
        name: data.name,
        id: data.existing.id,
        types: data.existing.types.map(t => t.name),
        typeIds: data.existing.types.map(t => t.id),
        action: 'LINK',
        sourceTab: data.sourceTab || undefined,
      };
      entityMap.entities.set(normalized, resolved);
      linked++;
      logger.debug(`Entity: ${data.name} → LINK`, {
        id: data.existing.id,
        types: resolved.types,
      });
    } else {
      // Create new entity
      const types = Array.from(data.types);

      // Resolve type names to IDs
      const typeIds = types
        .map(typeName => {
          const resolved = entityMap.types.get(normalizeEntityName(typeName));
          return resolved?.id;
        })
        .filter((id): id is string => id !== undefined);

      // If no types specified and not existing, this is an error
      if (types.length === 0) {
        logger.warn(`Entity "${data.name}" has no types - may be a relation target not in spreadsheet`);
      }

      const resolved: ResolvedEntity = {
        name: data.name,
        id: generateGeoId(),
        types,
        typeIds,
        action: 'CREATE',
        sourceTab: data.sourceTab || undefined,
      };
      entityMap.entities.set(normalized, resolved);
      created++;
      logger.debug(`Entity: ${data.name} → CREATE`, {
        id: resolved.id,
        types,
      });
    }
  }

  logger.info(`Processed ${byName.size} entities`, { toCreate: created, toLink: linked });
}

/**
 * Detect multi-type entities (same name with different types)
 * These should be merged into single entities with multiple types
 */
function detectMultiTypeEntities(entityMap: EntityMap): void {
  const multiType: Array<{ name: string; types: string[] }> = [];

  for (const [name, entity] of entityMap.entities) {
    if (entity.types.length > 1) {
      multiType.push({ name, types: entity.types });
    }
  }

  if (multiType.length > 0) {
    logger.subsection('Multi-Type Entities Detected');
    for (const { name, types } of multiType) {
      logger.listItem(`${name}: ${types.join(', ')}`);
    }
  }
}

/**
 * Get summary of entity resolution
 */
export function getEntityMapSummary(entityMap: EntityMap): {
  typesCreated: number;
  typesLinked: number;
  propertiesCreated: number;
  propertiesLinked: number;
  entitiesCreated: number;
  entitiesLinked: number;
  multiTypeEntities: Array<{ name: string; types: string[] }>;
} {
  let typesCreated = 0;
  let typesLinked = 0;

  for (const type of entityMap.types.values()) {
    if (type.action === 'CREATE') {
      typesCreated++;
    } else {
      typesLinked++;
    }
  }

  let propertiesCreated = 0;
  let propertiesLinked = 0;

  for (const prop of entityMap.properties.values()) {
    if (prop.action === 'CREATE') {
      propertiesCreated++;
    } else {
      propertiesLinked++;
    }
  }

  let entitiesCreated = 0;
  let entitiesLinked = 0;

  for (const entity of entityMap.entities.values()) {
    if (entity.action === 'CREATE') {
      entitiesCreated++;
    } else {
      entitiesLinked++;
    }
  }

  const multiTypeEntities = Array.from(entityMap.entities.values())
    .filter(e => e.types.length > 1)
    .map(e => ({ name: e.name, types: e.types }));

  return {
    typesCreated,
    typesLinked,
    propertiesCreated,
    propertiesLinked,
    entitiesCreated,
    entitiesLinked,
    multiTypeEntities,
  };
}

/**
 * Resolve an entity name to its ID
 * Throws if not found
 */
export function resolveEntityId(name: string, entityMap: EntityMap): string {
  const normalized = normalizeEntityName(name);
  const entity = entityMap.entities.get(normalized);

  if (!entity) {
    throw new Error(`Cannot resolve entity: "${name}" - not found in entity map`);
  }

  return entity.id;
}

/**
 * Resolve a type name to its ID
 * Throws if not found
 */
export function resolveTypeId(name: string, entityMap: EntityMap): string {
  const normalized = normalizeEntityName(name);
  const resolved = entityMap.types.get(normalized);

  if (!resolved) {
    throw new Error(`Cannot resolve type: "${name}" - not found in type map`);
  }

  return resolved.id;
}

/**
 * Resolve a property name to its ID
 * Throws if not found
 */
export function resolvePropertyId(name: string, entityMap: EntityMap): string {
  const normalized = normalizeEntityName(name);
  const resolved = entityMap.properties.get(normalized);

  if (!resolved) {
    throw new Error(`Cannot resolve property: "${name}" - not found in property map`);
  }

  return resolved.id;
}

/**
 * Check if a property is a relation type
 */
export function isRelationProperty(name: string, entityMap: EntityMap): boolean {
  const normalized = normalizeEntityName(name);
  const def = entityMap.propertyDefinitions.get(normalized);

  return def?.dataType === 'RELATION';
}

/**
 * Get property definition
 */
export function getPropertyDefinition(
  name: string,
  entityMap: EntityMap
): PropertyDefinition | undefined {
  const normalized = normalizeEntityName(name);
  return entityMap.propertyDefinitions.get(normalized);
}

/**
 * Get resolved entity by name
 */
export function getResolvedEntity(
  name: string,
  entityMap: EntityMap
): ResolvedEntity | undefined {
  const normalized = normalizeEntityName(name);
  return entityMap.entities.get(normalized);
}

/**
 * Get resolved type by name
 */
export function getResolvedType(
  name: string,
  entityMap: EntityMap
): ResolvedType | undefined {
  const normalized = normalizeEntityName(name);
  return entityMap.types.get(normalized);
}

/**
 * Get resolved property by name
 */
export function getResolvedProperty(
  name: string,
  entityMap: EntityMap
): ResolvedProperty | undefined {
  const normalized = normalizeEntityName(name);
  return entityMap.properties.get(normalized);
}
