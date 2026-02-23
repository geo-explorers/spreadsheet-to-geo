/**
 * Relation building - create relations between entities
 *
 * Relations are built for ALL entities (CREATE and LINK). Creating a relation
 * FROM a linked entity does NOT modify that entity — the relation lives in
 * the publishing space. GRC-20 allows cross-space relations.
 */

import type {
  ParsedSpreadsheet,
  EntityMap,
} from '../config/upsert-types.js';
import {
  resolveEntityId,
  resolvePropertyId,
  getPropertyDefinition,
  getResolvedEntity,
} from './entity-processor.js';
import { normalizeEntityName } from '../utils/cell-parsers.js';
import { logger } from '../utils/logger.js';

/**
 * Relation to be created
 */
export interface RelationToCreate {
  fromEntityId: string;
  fromEntityName: string;
  toEntityId: string;
  toEntityName: string;
  propertyId: string;
  propertyName: string;
  position: string; // Row-based ordering string for display order in Geo UI
}

/**
 * Build list of relations to create from spreadsheet data
 *
 * Creates relations for all entities — both CREATE and LINK.
 */
export function buildRelations(
  data: ParsedSpreadsheet,
  entityMap: EntityMap
): RelationToCreate[] {
  logger.section('Building Relations');

  const relations: RelationToCreate[] = [];
  const errors: string[] = [];
  let linkedWithRelations = 0;

  // Track position per (fromEntity, property) for ordering in Geo UI
  const positionCounters = new Map<string, number>();

  // Process each entity's relation columns (both CREATE and LINK entities)
  for (const entity of data.entities) {
    const resolvedEntity = getResolvedEntity(entity.name, entityMap);
    const fromEntityId = resolveEntityId(entity.name, entityMap);

    // Track linked entities that have outbound relations (informational)
    if (resolvedEntity?.action === 'LINK' && Object.keys(entity.relations).length > 0) {
      linkedWithRelations++;
    }

    for (const [propertyName, targetNames] of Object.entries(entity.relations)) {
      // Get property ID
      let propertyId: string;
      try {
        propertyId = resolvePropertyId(propertyName, entityMap);
      } catch (e) {
        errors.push(`Unknown property "${propertyName}" in entity "${entity.name}"`);
        continue;
      }

      // Verify it's a relation property
      const propDef = getPropertyDefinition(propertyName, entityMap);
      if (propDef?.dataType !== 'RELATION') {
        logger.warn(`Property "${propertyName}" is not a RELATION type, skipping`);
        continue;
      }

      // Create relation for each target
      for (const targetName of targetNames) {
        let toEntityId: string;

        try {
          toEntityId = resolveEntityId(targetName, entityMap);
        } catch (e) {
          errors.push(
            `Entity "${entity.name}" references unknown entity "${targetName}" via ${propertyName}`
          );
          continue;
        }

        // Auto-position: increment counter per (fromEntity, property) pair
        const posKey = `${fromEntityId}:${propertyId}`;
        const pos = positionCounters.get(posKey) ?? 0;
        positionCounters.set(posKey, pos + 1);

        relations.push({
          fromEntityId,
          fromEntityName: entity.name,
          toEntityId,
          toEntityName: targetName,
          propertyId,
          propertyName,
          position: String(pos),
        });

        logger.debug('Relation', {
          from: entity.name,
          to: targetName,
          via: propertyName,
        });
      }
    }
  }

  if (errors.length > 0) {
    logger.error(`${errors.length} relation errors found`);
    for (const err of errors) {
      logger.listItem(err);
    }
    throw new Error(`Failed to build relations: ${errors.length} errors`);
  }

  logger.success(`Built ${relations.length} relations`, {
    linkedEntitiesWithRelations: linkedWithRelations,
  });

  return relations;
}

/**
 * Group relations by property for summary
 */
export function groupRelationsByProperty(
  relations: RelationToCreate[]
): Map<string, number> {
  const grouped = new Map<string, number>();

  for (const rel of relations) {
    const current = grouped.get(rel.propertyName) || 0;
    grouped.set(rel.propertyName, current + 1);
  }

  return grouped;
}

/**
 * Get relations for a specific entity
 */
export function getRelationsForEntity(
  entityName: string,
  relations: RelationToCreate[]
): {
  outgoing: RelationToCreate[];
  incoming: RelationToCreate[];
} {
  const normalized = normalizeEntityName(entityName);

  const outgoing = relations.filter(
    r => normalizeEntityName(r.fromEntityName) === normalized
  );

  const incoming = relations.filter(
    r => normalizeEntityName(r.toEntityName) === normalized
  );

  return { outgoing, incoming };
}

/**
 * Validate all relation targets exist
 */
export function validateRelationTargets(
  data: ParsedSpreadsheet,
  entityMap: EntityMap
): string[] {
  const errors: string[] = [];

  for (const entity of data.entities) {
    for (const [propertyName, targetNames] of Object.entries(entity.relations)) {
      for (const targetName of targetNames) {
        const normalized = normalizeEntityName(targetName);

        if (!entityMap.entities.has(normalized)) {
          errors.push(
            `Entity "${entity.name}" references unknown entity "${targetName}" via ${propertyName}`
          );
        }
      }
    }
  }

  return errors;
}
