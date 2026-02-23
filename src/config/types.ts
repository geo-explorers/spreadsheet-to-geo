/**
 * Shared type definitions for all operations (upsert, delete, update)
 *
 * These types are operation-agnostic and used across the CLI tool.
 * Upsert-specific types live in upsert-types.ts.
 */

// ============================================================================
// Spreadsheet Metadata
// ============================================================================

/**
 * Metadata tab - configuration for the publish batch
 */
export interface Metadata {
  spaceId: string;
  spaceType: 'Personal' | 'DAO';
  author?: string; // Author's personal space ID
  sourceDate?: string;
  preparedBy?: string;
  reviewedBy?: string;
  publishedBy?: string;
  publishDate?: string;
  notes?: string;
  readyForPublishing?: boolean;
}

// ============================================================================
// Publishing
// ============================================================================

export interface PublishOptions {
  network: 'TESTNET' | 'MAINNET';
  dryRun: boolean;
  verbose: boolean;
  outputDir: string;
}

// ============================================================================
// Validation
// ============================================================================

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationError {
  tab: string;
  row?: number;
  column?: string;
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

// ============================================================================
// Column Mapping
// ============================================================================

// Standard column names (case-insensitive matching)
export const STANDARD_COLUMNS = {
  ENTITY_NAME: 'entity name',
  TYPES: 'types',
  TYPE: 'type',
  TYPE_NAME: 'type name',
  PROPERTY_NAME: 'property name',
  DATA_TYPE: 'data type',
  DESCRIPTION: 'description',
  FIELD: 'field',
  VALUE: 'value',
} as const;

// Special tabs that are NOT entity tabs
export const SPECIAL_TABS = ['Metadata', 'Types', 'Properties'] as const;

// Required tabs
export const REQUIRED_TABS = ['Metadata', 'Types', 'Properties'] as const;

// ============================================================================
// Operation Reports (discriminated union)
// ============================================================================

/**
 * Base interface for all operation reports.
 * Every report (upsert, delete, update) shares these fields.
 */
export interface ReportBase {
  operationType: string;
  timestamp: string;
  success: boolean;
  network: string;
  spaceId: string;
  dryRun: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Upsert operation report - captures full details of a create/link publish.
 */
export interface UpsertReport extends ReportBase {
  operationType: 'upsert';
  spaceType: string;
  editId?: string;
  cid?: string;
  summary: {
    typesCreated: number;
    typesLinked: number;
    propertiesCreated: number;
    propertiesLinked: number;
    entitiesCreated: number;
    entitiesLinked: number;
    relationsCreated: number;
    imagesUploaded: number;
    multiTypeEntities: Array<{ name: string; types: string[] }>;
  };
  details: {
    typesCreated: Array<{ name: string; id: string }>;
    typesLinked: Array<{ name: string; id: string }>;
    propertiesCreated: Array<{ name: string; id: string; dataType: string }>;
    propertiesLinked: Array<{ name: string; id: string }>;
    entitiesCreated: Array<{ name: string; id: string; types: string[] }>;
    entitiesLinked: Array<{ name: string; id: string }>;
    relationsCreated: Array<{
      from: string;
      to: string;
      property: string;
    }>;
    multiTypeEntities: Array<{ name: string; types: string[] }>;
  };
}

/**
 * Delete operation report - placeholder for Phase 2.
 */
export interface DeleteReport extends ReportBase {
  operationType: 'delete';
  summary: {
    entitiesDeleted: number;
    relationsDeleted: number;
    triplesDeleted: number;
  };
  details: {
    entities: Array<{ name: string; id: string }>;
    relations: Array<{ from: string; to: string; property: string }>;
  };
}

/**
 * Update operation report - placeholder for Phase 3.
 */
export interface UpdateReport extends ReportBase {
  operationType: 'update';
  summary: {
    entitiesUpdated: number;
    propertiesUpdated: number;
    relationsAdded: number;
    relationsRemoved: number;
  };
  details: {
    entities: Array<{ name: string; id: string; changes: string[] }>;
  };
}

/**
 * Discriminated union of all operation reports.
 * Use `report.operationType` to narrow the type.
 */
export type OperationReport = UpsertReport | DeleteReport | UpdateReport;
