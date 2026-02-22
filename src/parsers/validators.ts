/**
 * Spreadsheet validation
 *
 * Updated for new spreadsheet format:
 * - No "Related entities" tab validation (each type has its own tab)
 * - No "Geo ID" column validation (use API search for deduplication)
 */

import type { ValidationResult, ValidationError } from '../config/types.js';
import type { ParsedSpreadsheet } from '../config/upsert-types.js';
import { normalizeEntityName } from '../utils/cell-parsers.js';
import { logger } from '../utils/logger.js';

/**
 * Validate parsed spreadsheet data
 */
export function validateSpreadsheet(data: ParsedSpreadsheet): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate metadata
  validateMetadata(data, errors);

  // Validate types
  validateTypes(data, errors);

  // Validate properties
  validateProperties(data, errors);

  // Validate entities
  validateEntities(data, errors);

  // Validate entity columns against Properties tab
  validateEntityColumns(data, errors);

  // Validate reference integrity
  validateReferenceIntegrity(data, errors);

  const isValid = errors.filter(e => e.severity === 'error').length === 0;

  if (!isValid) {
    logger.error('Validation failed', { errorCount: errors.length });
  } else if (errors.length > 0) {
    logger.warn('Validation passed with warnings', { warningCount: errors.length });
  } else {
    logger.success('Validation passed');
  }

  return { isValid, errors };
}

function validateMetadata(data: ParsedSpreadsheet, errors: ValidationError[]): void {
  const { metadata } = data;

  // Space ID is required (but we allow placeholder for dry-run)
  if (!metadata.spaceId || metadata.spaceId === 'placeholder_space_id_for_dry_run') {
    errors.push({
      tab: 'Metadata',
      message: 'Space ID is required for publishing (can use placeholder for dry-run)',
      severity: 'warning',
    });
  }

  // Space type validation
  if (!['Personal', 'DAO'].includes(metadata.spaceType)) {
    errors.push({
      tab: 'Metadata',
      column: 'Space type',
      message: `Invalid space type: "${metadata.spaceType}". Must be "Personal" or "DAO"`,
      severity: 'error',
    });
  }
}

function validateTypes(data: ParsedSpreadsheet, errors: ValidationError[]): void {
  const seen = new Set<string>();

  for (let i = 0; i < data.types.length; i++) {
    const type = data.types[i];
    const row = i + 2; // Account for header row

    // Check for missing name
    if (!type.name) {
      errors.push({
        tab: 'Types',
        row,
        column: 'Type name',
        message: 'Type name is required',
        severity: 'error',
      });
      continue;
    }

    // Check for duplicate type names
    const normalized = normalizeEntityName(type.name);
    if (seen.has(normalized)) {
      errors.push({
        tab: 'Types',
        row,
        column: 'Type name',
        message: `Duplicate type name: "${type.name}"`,
        severity: 'warning',
      });
    }
    seen.add(normalized);
  }
}

function validateProperties(data: ParsedSpreadsheet, errors: ValidationError[]): void {
  const seen = new Set<string>();
  const validDataTypes = [
    'TEXT',
    'INTEGER',
    'FLOAT',
    'DATE',
    'TIME',
    'DATETIME',
    'BOOLEAN',
    'RELATION',
    'POINT',
  ];

  for (let i = 0; i < data.properties.length; i++) {
    const prop = data.properties[i];
    const row = i + 2;

    // Check for missing name
    if (!prop.name) {
      errors.push({
        tab: 'Properties',
        row,
        column: 'Property name',
        message: 'Property name is required',
        severity: 'error',
      });
      continue;
    }

    // Check for duplicate property names
    const normalized = normalizeEntityName(prop.name);
    if (seen.has(normalized)) {
      errors.push({
        tab: 'Properties',
        row,
        column: 'Property name',
        message: `Duplicate property name: "${prop.name}"`,
        severity: 'warning',
      });
    }
    seen.add(normalized);

    // Validate data type
    if (!validDataTypes.includes(prop.dataType)) {
      errors.push({
        tab: 'Properties',
        row,
        column: 'Data type',
        message: `Invalid data type: "${prop.dataType}". Valid types: ${validDataTypes.join(', ')}`,
        severity: 'error',
      });
    }

    // RELATION type should have pointsToTypes
    if (prop.dataType === 'RELATION' && !prop.pointsToTypes) {
      errors.push({
        tab: 'Properties',
        row,
        column: 'Points to type(s)',
        message: `RELATION property "${prop.name}" should specify target types`,
        severity: 'warning',
      });
    }
  }
}

function validateEntities(data: ParsedSpreadsheet, errors: ValidationError[]): void {
  const seen = new Map<string, { row: number; tab: string }>();

  for (let i = 0; i < data.entities.length; i++) {
    const entity = data.entities[i];
    // Row number is harder to track across tabs, use index
    const row = i + 1;

    // Check for missing name
    if (!entity.name) {
      errors.push({
        tab: entity.sourceTab,
        row,
        column: 'Entity name',
        message: 'Entity name is required',
        severity: 'error',
      });
      continue;
    }

    // Check for missing types
    if (entity.types.length === 0) {
      errors.push({
        tab: entity.sourceTab,
        row,
        column: 'Types',
        message: `Entity "${entity.name}" has no types assigned`,
        severity: 'error',
      });
    }

    // Check for duplicate entity names across tabs (warning, not error)
    const normalized = normalizeEntityName(entity.name);
    if (seen.has(normalized)) {
      const prev = seen.get(normalized)!;
      // Only warn if in different tabs - same entity in same tab is an error
      if (prev.tab !== entity.sourceTab) {
        errors.push({
          tab: entity.sourceTab,
          row,
          column: 'Entity name',
          message: `Entity "${entity.name}" also appears in ${prev.tab}`,
          severity: 'warning',
        });
      } else {
        errors.push({
          tab: entity.sourceTab,
          row,
          column: 'Entity name',
          message: `Duplicate entity "${entity.name}" in same tab (row ${prev.row})`,
          severity: 'error',
        });
      }
    } else {
      seen.set(normalized, { row, tab: entity.sourceTab });
    }
  }
}

function validateEntityColumns(data: ParsedSpreadsheet, errors: ValidationError[]): void {
  // Build set of known property names from Properties tab
  const knownProperties = new Set<string>();
  for (const prop of data.properties) {
    knownProperties.add(normalizeEntityName(prop.name));
  }

  // Warn once per (tab, column) pair — not once per entity row
  const warned = new Set<string>();

  for (const entity of data.entities) {
    for (const colName of Object.keys(entity.properties)) {
      const normalized = normalizeEntityName(colName);

      // Skip description — handled separately by batch-builder
      if (normalized === 'description') continue;

      if (!knownProperties.has(normalized)) {
        const warnKey = `${entity.sourceTab}:${colName}`;
        if (!warned.has(warnKey)) {
          warned.add(warnKey);
          errors.push({
            tab: entity.sourceTab,
            column: colName,
            message: `Column "${colName}" is not declared in the Properties tab — add it to the Properties tab or remove it before publishing`,
            severity: 'error',
          });
        }
      }
    }
  }
}

function validateReferenceIntegrity(data: ParsedSpreadsheet, errors: ValidationError[]): void {
  // Build set of all known entity names (from all entity tabs)
  const knownEntities = new Set<string>();
  for (const entity of data.entities) {
    knownEntities.add(normalizeEntityName(entity.name));
  }

  // Build set of known types — includes Types tab rows AND entity tab names
  // (per IDEA.md: "tab name becomes the default type")
  const knownTypes = new Set<string>();
  for (const type of data.types) {
    knownTypes.add(normalizeEntityName(type.name));
  }
  for (const entity of data.entities) {
    knownTypes.add(normalizeEntityName(entity.sourceTab));
  }

  // Check entity types reference known types
  for (const entity of data.entities) {
    for (const typeName of entity.types) {
      if (!knownTypes.has(normalizeEntityName(typeName))) {
        errors.push({
          tab: entity.sourceTab,
          column: 'Types',
          message: `Entity "${entity.name}" references unknown type "${typeName}"`,
          severity: 'error',
        });
      }
    }
  }

  // Build property → pointsToTypes lookup for actionable warning messages
  const propertyPointsTo = new Map<string, string>();
  for (const prop of data.properties) {
    if (prop.dataType === 'RELATION' && prop.pointsToTypes) {
      propertyPointsTo.set(normalizeEntityName(prop.name), prop.pointsToTypes);
    }
  }

  // Check relation values reference known entities
  // Deduplicate per (tab, column, targetName) — same target referenced by many rows fires once
  const warnedRefs = new Set<string>();

  for (const entity of data.entities) {
    for (const [propName, targetNames] of Object.entries(entity.relations)) {
      const expectedTypes = propertyPointsTo.get(normalizeEntityName(propName));
      const typeHint = expectedTypes ? ` (expects: ${expectedTypes})` : '';
      for (const targetName of targetNames) {
        if (!knownEntities.has(normalizeEntityName(targetName))) {
          const refKey = `${entity.sourceTab}:${propName}:${normalizeEntityName(targetName)}`;
          if (!warnedRefs.has(refKey)) {
            warnedRefs.add(refKey);
            errors.push({
              tab: entity.sourceTab,
              column: propName,
              message: `"${targetName}"${typeHint} not found in spreadsheet — ensure it exists in Geo or add it to an entity tab`,
              severity: 'warning',
            });
          }
        }
      }
    }
  }
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  const grouped = new Map<string, ValidationError[]>();

  for (const error of errors) {
    const key = error.tab;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(error);
  }

  const lines: string[] = [];

  for (const [tab, tabErrors] of grouped) {
    lines.push(`\n${tab}:`);
    for (const error of tabErrors) {
      const location = error.row
        ? `row ${error.row}`
        : error.column
          ? `column "${error.column}"`
          : '';
      const prefix = error.severity === 'error' ? '✗' : '⚠';
      lines.push(`  ${prefix} ${location ? `[${location}] ` : ''}${error.message}`);
    }
  }

  return lines.join('\n');
}
