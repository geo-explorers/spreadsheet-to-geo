/**
 * Build delete-triples operations for Geo protocol
 *
 * Converts validated RelationEntry[] and PropertyUnsetEntry[] into a DeleteTriplesBatch
 * containing Op[] that:
 * 1. Delete specific relations via Graph.deleteRelation()
 * 2. Unset specific properties via Graph.updateEntity({ id, unset })
 *
 * Property unsets are grouped by entity ID for efficiency (one updateEntity call per entity).
 * This function is pure -- no API calls. It builds ops from already-validated data.
 */

import { Graph } from '@geoprotocol/geo-sdk';
import type { Op } from '@geoprotocol/geo-sdk';
import type {
  RelationEntry,
  PropertyUnsetEntry,
  DeleteTriplesBatch,
  DeleteTriplesSummary,
} from '../config/delete-triples-types.js';

/**
 * Build deleteRelation and updateEntity(unset) operations from validated entries.
 *
 * For relations: one Graph.deleteRelation({ id }) per relation entry.
 * For properties: grouped by entity ID, one Graph.updateEntity({ id, unset }) per entity.
 *
 * @param relations - Validated relation entries from the Relations tab
 * @param properties - Validated property unset entries from the Properties tab
 * @returns Batch with all ops and a summary of counts
 */
export function buildDeleteTriplesOps(
  relations: RelationEntry[],
  properties: PropertyUnsetEntry[]
): DeleteTriplesBatch {
  const allOps: Op[] = [];

  // 1. Build deleteRelation ops for each relation
  for (const relation of relations) {
    const { ops } = Graph.deleteRelation({ id: relation.relationId });
    allOps.push(...ops);
  }

  // 2. Group property unsets by entity ID for efficiency
  const entityPropertyMap = new Map<string, string[]>();
  for (const { entityId, propertyId } of properties) {
    if (!entityPropertyMap.has(entityId)) {
      entityPropertyMap.set(entityId, []);
    }
    entityPropertyMap.get(entityId)!.push(propertyId);
  }

  // 3. Build updateEntity(unset) ops per entity
  for (const [entityId, propertyIds] of entityPropertyMap) {
    const { ops } = Graph.updateEntity({
      id: entityId,
      unset: propertyIds.map(property => ({ property })),
    });
    allOps.push(...ops);
  }

  // 4. Build summary
  const summary: DeleteTriplesSummary = {
    relationsToDelete: relations.length,
    propertiesToUnset: properties.length,
    entitiesAffected: entityPropertyMap.size,
  };

  return { ops: allOps, summary };
}
