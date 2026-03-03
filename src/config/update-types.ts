/**
 * Update-specific type definitions
 *
 * These types are used only by the update pipeline (diff, apply, report).
 * Shared types (Metadata, ValidationError, etc.) live in types.ts.
 */

import type { TypedValue } from '@geoprotocol/geo-sdk';

/** Options for the update command */
export interface UpdateOptions {
  network: 'TESTNET' | 'MAINNET';
  dryRun: boolean;
  verbose: boolean;
  quiet: boolean;
  yes: boolean;
  additive: boolean;
  outputDir: string;
}

/** Per-property scalar diff */
export interface PropertyDiff {
  propertyId: string;
  propertyName: string;
  type: 'set' | 'unchanged';
  oldValue?: string;       // Human-readable current value
  newValue?: string;        // Human-readable new value
  typedValue?: TypedValue;  // SDK value for the op
}

/** Per-relation-property diff */
export interface RelationDiff {
  propertyId: string;
  propertyName: string;
  toAdd: Array<{ entityId: string; entityName: string }>;
  toRemove: Array<{ entityId: string; entityName: string; relationId: string }>;
  unchanged: Array<{ entityId: string; entityName: string }>;
}

/** Per-entity diff (aggregates all property and relation changes) */
export interface EntityDiff {
  entityId: string;
  entityName: string;
  status: 'updated' | 'skipped';  // 'skipped' when zero changes
  scalarChanges: PropertyDiff[];   // Only type='set' entries
  relationChanges: RelationDiff[]; // Only entries with toAdd or toRemove
  unchangedScalarCount: number;
  unchangedRelationCount: number;
}

/** Summary of all diffs across all entities */
export interface DiffSummary {
  totalEntities: number;
  entitiesWithChanges: number;
  entitiesSkipped: number;
  totalScalarChanges: number;
  totalRelationsAdded: number;
  totalRelationsRemoved: number;
}
