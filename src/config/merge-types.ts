/**
 * Merge-specific type definitions (Phase 4: Bulk Merge)
 *
 * These types are used only by the merge pipeline (parse template, compute diffs,
 * build ops, publish). The merge command absorbs "merger" entities into "keeper"
 * entities by transferring unique properties, re-pointing relations, and deleting
 * the merger entity.
 *
 * Shared types (ReportBase, Metadata, etc.) live in types.ts.
 */

import type { Op, TypedValue } from '@geoprotocol/geo-sdk';

// ============================================================================
// Cross-Space Strategy
// ============================================================================

/** Strategy for cross-space merges */
export type CrossSpaceStrategy = 'migrate' | 'link';

// ============================================================================
// CLI Options
// ============================================================================

/** Options for the merge command (parsed from CLI flags) */
export interface MergeOptions {
  network?: string;
  dryRun: boolean;
  output: string;      // Report output directory
  verbose: boolean;
  yes: boolean;        // Skip confirmation prompt
  crossSpace?: CrossSpaceStrategy;  // Cross-space merge strategy
}

// ============================================================================
// Template Parsing
// ============================================================================

/** A single keeper/merger pair from the Excel merge template */
export interface MergePair {
  keeperId: string;      // Keeper entity ID (required)
  mergerId: string;      // Merger entity ID (required)
  keeperName?: string;   // Optional keeper name (for readability/cross-validation)
  mergerName?: string;   // Optional merger name (for readability/cross-validation)
  keeperSpaceId?: string;  // Optional per-pair space ID (cross-space merge)
  mergerSpaceId?: string;  // Optional per-pair space ID (cross-space merge)
  rowNumber: number;     // 1-based row number for error reporting
}

// ============================================================================
// Diff Engine
// ============================================================================

/** Conflict when keeper and merger both have a property with different values */
export interface MergeConflict {
  propertyId: string;
  propertyName: string;
  keeperValue: string;   // Human-readable keeper value
  mergerValue: string;   // Human-readable merger value
}

/** Computed diff for a single merge pair -- central type for the diff engine */
export interface MergePairDiff {
  keeperName: string;
  keeperId: string;
  keeperSpaceId: string;
  mergerName: string;
  mergerId: string;
  mergerSpaceId: string;
  isCrossSpace: boolean;

  /** Unique properties to copy from merger to keeper */
  propertiesToTransfer: Array<{
    propertyId: string;
    propertyName: string;
    mergerValue: string;
    typedValue: TypedValue;
  }>;

  /** Properties both entities have with different values (keeper wins) */
  conflicts: MergeConflict[];

  /** Relations to delete on merger and recreate pointing to/from keeper */
  relationsToRepoint: Array<{
    relationId: string;
    direction: 'outgoing' | 'incoming';
    typeId: string;
    typeName: string;
    otherEntityId: string;
    otherEntityName: string;
  }>;

  /** Relations skipped because keeper already has the equivalent */
  relationsSkipped: Array<{
    direction: 'outgoing' | 'incoming';
    typeId: string;
    typeName: string;
    otherEntityId: string;
    otherEntityName: string;
  }>;

  /** Type IDs the merger has that the keeper does not */
  typesToTransfer: Array<{ typeId: string; typeName: string }>;

  /** Ops from buildDeleteOps() for post-transfer merger cleanup */
  mergerDeleteOps: Op[];
}

// ============================================================================
// Summary & Batching
// ============================================================================

/** Aggregate counts across all merge pairs */
export interface MergeSummary {
  totalPairs: number;
  propertiesTransferred: number;
  conflictsDetected: number;
  relationsRepointed: number;
  relationsSkipped: number;
  typesTransferred: number;
  mergersDeleted: number;
  crossSpacePairs: number;
}

// ============================================================================
// Cross-Space Ops
// ============================================================================

/** Split ops for cross-space merge (separate publish per space) */
export interface CrossSpaceOps {
  keeperSpaceOps: Op[];   // Ops to publish to keeper's space
  mergerSpaceOps: Op[];   // Ops to publish to merger's space
}

