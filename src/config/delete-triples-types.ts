/**
 * Delete-triples-specific type definitions
 *
 * These types are used only by the delete-triples pipeline (parse Excel tabs,
 * validate IDs, build deleteRelation + updateEntity(unset) ops, publish).
 * Shared types live in types.ts.
 */

import type { Op } from '@geoprotocol/geo-sdk';

/** A single relation entry parsed from the Relations tab */
export interface RelationEntry {
  relationId: string; // 32-char hex
  spaceId: string; // 32-char hex
}

/** A single property unset entry parsed from the Properties tab */
export interface PropertyUnsetEntry {
  entityId: string; // 32-char hex
  propertyId: string; // 32-char hex
  spaceId: string; // 32-char hex
}

/** Result of parsing the triples Excel file */
export interface TriplesParseResult {
  relations: RelationEntry[];
  properties: PropertyUnsetEntry[];
  spaceId: string; // Single validated space ID
  errors: string[];
}

/** Options for the delete-triples command (parsed from CLI flags) */
export interface DeleteTriplesOptions {
  network?: string;
  space?: string; // Optional --space flag override
  dryRun: boolean;
  output: string; // Report output directory
  verbose: boolean;
  force: boolean; // --force skips confirmation
}

/** Summary of delete-triples operations built */
export interface DeleteTriplesSummary {
  relationsToDelete: number;
  propertiesToUnset: number;
  entitiesAffected: number; // Unique entity count from property unsets
}

/** Batch of delete-triples operations ready for publishing */
export interface DeleteTriplesBatch {
  ops: Op[];
  summary: DeleteTriplesSummary;
}
