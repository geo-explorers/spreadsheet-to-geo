/**
 * Upsert-specific type definitions
 *
 * These types are used only by the upsert pipeline (parse, validate, resolve, batch, publish).
 * Shared types (Metadata, ValidationError, etc.) live in types.ts.
 */

import type { Op } from '@geoprotocol/geo-sdk';
import type { Metadata } from './types.js';

// ============================================================================
// Spreadsheet Tab Models
// ============================================================================

/**
 * Types tab - type definitions
 * Note: No geoId column - we search for existing types by name via API
 */
export interface TypeDefinition {
  name: string;
  space?: string; // "Root", "AI", etc. - informational only
  description?: string;
  defaultProperties?: string; // Comma or semicolon separated
}

/**
 * Properties tab - property definitions
 * Note: No geoId column - we search for existing properties by name via API
 */
export interface PropertyDefinition {
  name: string;
  dataType:
    | 'TEXT'
    | 'INTEGER'
    | 'FLOAT'
    | 'DATE'
    | 'TIME'
    | 'DATETIME'
    | 'BOOLEAN'
    | 'RELATION'
    | 'POINT';
  renderableType?: string;
  pointsToTypes?: string; // For RELATION type - comma or semicolon separated type names
  description?: string;
}

/**
 * Generic entity from any entity tab
 * Tab name determines the entity type (e.g., "Person" tab -> type "Person")
 * Note: No geoId column - we search for existing entities by name via API
 */
export interface SpreadsheetEntity {
  name: string;
  types: string[]; // Usually just the tab name, but can be multiple
  properties: Record<string, string>; // Column name -> value
  relations: Record<string, string[]>; // Property name -> array of entity names
  sourceTab: string; // Which tab this came from
}

// ============================================================================
// Parsed Spreadsheet Model
// ============================================================================

export interface ParsedSpreadsheet {
  metadata: Metadata;
  types: TypeDefinition[];
  properties: PropertyDefinition[];
  entities: SpreadsheetEntity[]; // All entities from all entity tabs
}

// ============================================================================
// Entity Resolution
// ============================================================================

export type EntityAction = 'CREATE' | 'LINK';

export interface ResolvedEntity {
  name: string;
  id: string; // Geo ID (existing from API or generated)
  types: string[]; // Type names
  typeIds: string[]; // Resolved type IDs
  action: EntityAction;
  sourceTab?: string;
}

export interface ResolvedType {
  name: string;
  id: string;
  action: EntityAction;
}

export interface ResolvedProperty {
  name: string;
  id: string;
  action: EntityAction;
  definition: PropertyDefinition;
}

export interface EntityMap {
  // Maps normalized entity name -> resolved entity info
  entities: Map<string, ResolvedEntity>;
  // Maps type name -> resolved type info
  types: Map<string, ResolvedType>;
  // Maps property name -> resolved property info
  properties: Map<string, ResolvedProperty>;
  // Maps property name -> property definition (for checking if RELATION)
  propertyDefinitions: Map<string, PropertyDefinition>;
}

// ============================================================================
// Operations Batch
// ============================================================================

export interface OperationsBatch {
  ops: Op[]; // Geo SDK operations
  summary: BatchSummary;
}

export interface BatchSummary {
  typesCreated: number;
  typesLinked: number;
  propertiesCreated: number;
  propertiesLinked: number;
  entitiesCreated: number;
  entitiesLinked: number;
  relationsCreated: number;
  multiTypeEntities: Array<{ name: string; types: string[] }>;
}

// ============================================================================
// Publish Result
// ============================================================================

export interface PublishResult {
  success: boolean;
  editId?: string;
  cid?: string;
  transactionHash?: string;
  error?: string;
  summary: BatchSummary;
}
