/**
 * Delete-specific type definitions
 *
 * These types are used only by the delete pipeline (parse IDs, fetch details, build ops, publish).
 * Shared types (ReportBase, ValidationError, etc.) live in types.ts.
 */

import type { Op } from '@geoprotocol/geo-sdk';

/** Options for the delete command (parsed from CLI flags) */
export interface DeleteOptions {
  network?: string;
  space?: string; // Optional --space flag (CSV is primary source)
  dryRun: boolean;
  output: string; // Report output directory
  verbose: boolean;
  force: boolean; // --force skips confirmation
}

/** Summary of delete operations built */
export interface DeleteSummary {
  entitiesProcessed: number;
  relationsToDelete: number;
  propertiesToUnset: number;
  backlinksToDelete: number;
}

/** Batch of delete operations ready for publishing */
export interface DeleteBatch {
  ops: Op[];
  summary: DeleteSummary;
}

/** Pre-deletion snapshot of entity data for audit trail */
export interface DeleteSnapshot {
  timestamp: string;
  entities: Array<{
    id: string;
    name: string | null;
    propertyCount: number;
    relationCount: number;
    backlinkCount: number;
    typeIds: string[];
  }>;
  snapshotPath: string;
}
