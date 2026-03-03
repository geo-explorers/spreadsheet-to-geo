/**
 * Build delete operations for blanking entities in Geo
 *
 * Converts EntityDetails[] into a DeleteBatch containing Op[] that:
 * 1. Delete all outgoing relations (including type assignments) via Graph.deleteRelation()
 * 2. Delete all incoming relations (backlinks) via Graph.deleteRelation()
 * 3. Unset all property values via Graph.updateEntity({ id, unset })
 *
 * CRITICAL: Graph.deleteEntity() is NOT used -- the Indexer ignores it.
 * The entity "shell" remains but appears blank (no properties, no relations).
 */

import { Graph } from '@geoprotocol/geo-sdk';
import type { Op } from '@geoprotocol/geo-sdk';
import type { EntityDetails } from '../api/geo-client.js';
import type { DeleteBatch, DeleteSummary } from '../config/delete-types.js';

/**
 * Build delete operations for a list of entities.
 *
 * For each entity:
 * 1. Delete all outgoing relations (includes type assignments) via Graph.deleteRelation()
 * 2. Delete all incoming relations (backlinks) via Graph.deleteRelation()
 * 3. Unset all property values via Graph.updateEntity({ id, unset })
 *
 * Maintains a Set<string> of already-processed relation IDs to handle the case
 * where the same relation appears as an outgoing relation on entity A and a
 * backlink on entity B (both in the input list). Each relation is deleted only once.
 *
 * NOTE: Graph.deleteEntity() is NOT used -- the Indexer ignores it.
 * The entity "shell" remains but appears blank (no properties, no relations).
 */
export function buildDeleteOps(entities: EntityDetails[]): DeleteBatch {
  const allOps: Op[] = [];
  const processedRelationIds = new Set<string>();
  let totalRelations = 0;
  let totalBacklinks = 0;
  let totalProperties = 0;

  for (const entity of entities) {
    // 1. Delete outgoing relations (includes type assignment relations)
    for (const rel of entity.relations) {
      if (processedRelationIds.has(rel.id)) continue;
      processedRelationIds.add(rel.id);
      const { ops } = Graph.deleteRelation({ id: rel.id });
      allOps.push(...ops);
      totalRelations++;
    }

    // 2. Delete incoming relations (backlinks / "Referenced by")
    for (const backlink of entity.backlinks) {
      if (processedRelationIds.has(backlink.id)) continue;
      processedRelationIds.add(backlink.id);
      const { ops } = Graph.deleteRelation({ id: backlink.id });
      allOps.push(...ops);
      totalBacklinks++;
    }

    // 3. Unset ALL property values (blanks the entity)
    // Deduplicate property IDs -- a property may have multiple values
    const propertyIds = [...new Set(entity.values.map(v => v.propertyId))];
    if (propertyIds.length > 0) {
      const { ops } = Graph.updateEntity({
        id: entity.id,
        unset: propertyIds.map(property => ({ property })),
      });
      allOps.push(...ops);
      totalProperties += propertyIds.length;
    }
  }

  const summary: DeleteSummary = {
    entitiesProcessed: entities.length,
    relationsToDelete: totalRelations,
    propertiesToUnset: totalProperties,
    backlinksToDelete: totalBacklinks,
  };

  return { ops: allOps, summary };
}
