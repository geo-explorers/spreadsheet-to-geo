/**
 * Relation building - create relations between entities
 *
 * Updated for new spreadsheet format:
 * - Skip relations for LINK entities (can't modify existing entities in other spaces)
 * - Relations are only created for entities we're creating (action='CREATE')
 */

import type {
  ParsedSpreadsheet,
  EntityMap,
} from '../config/schema.js';
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
}

/**
 * Build list of relations to create from spreadsheet data
 *
 * Only creates relations for entities with action='CREATE'.
 * Linked entities (existing in Geo) can't have new relations added.
 */
export function buildRelations(
  data: ParsedSpreadsheet,
  entityMap: EntityMap
): RelationToCreate[] {
  logger.section('Building Relations');

  const relations: RelationToCreate[] = [];
  const errors: string[] = [];
  let skippedLinked = 0;

  // Process each entity's relation columns
  for (const entity of data.entities) {
    // Check if this entity is being created or linked
    const resolvedEntity = getResolvedEntity(entity.name, entityMap);
    if (resolvedEntity?.action === 'LINK') {
      // Skip relations for linked entities - we can't modify entities in other spaces
      skippedLinked++;
      logger.debug(`Skipping relations for linked entity: ${entity.name}`);
      continue;
    }

    const fromEntityId = resolveEntityId(entity.name, entityMap);

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

        relations.push({
          fromEntityId,
          fromEntityName: entity.name,
          toEntityId,
          toEntityName: targetName,
          propertyId,
          propertyName,
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
    skippedLinkedEntities: skippedLinked,
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
