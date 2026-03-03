/**
 * Excel template parser for the merge command (Phase 4: Bulk Merge)
 *
 * Parses an Excel workbook with:
 * - Metadata tab: Field/Value rows containing Space ID and Operation type
 * - Merge tab: Two columns (Keeper, Merger) with entity name pairs
 *
 * Follows the error-accumulation pattern from entity-id-parser.ts:
 * all errors are collected and returned to the caller rather than
 * failing on the first error encountered.
 */

import XLSX from 'xlsx';
import type { MergePair } from '../config/merge-types.js';
import { cleanString } from '../utils/cell-parsers.js';

/** Result of parsing a merge template */
export interface MergeParseResult {
  pairs: MergePair[];
  spaceId: string;
  operationType: string;
  errors: string[];
}

/**
 * Find a column value by header name, handling BOM prefixes.
 * CSV/Excel files may have a BOM (\uFEFF) prepended to the first header,
 * so we strip it before matching.
 *
 * Same BOM-tolerant pattern as entity-id-parser.ts.
 */
function getColumnValue(row: Record<string, unknown>, headerName: string): unknown {
  // Direct match first
  if (headerName in row) return row[headerName];

  // Try stripping BOM from keys
  for (const key of Object.keys(row)) {
    const cleaned = key.replace(/^\uFEFF/, '');
    if (cleaned === headerName) return row[key];
  }

  return undefined;
}

/**
 * Extract a string value from a row column, trimming whitespace.
 * Returns undefined for empty/missing values.
 */
function getStringValue(row: Record<string, unknown>, headerName: string): string | undefined {
  const raw = getColumnValue(row, headerName);
  if (raw === undefined || raw === null || raw === '') return undefined;
  return cleanString(String(raw));
}

/**
 * Parse Metadata tab for Space ID and Operation type.
 * The Metadata tab uses a Field/Value row pattern where each row
 * is a key-value pair with columns named "Field" and "Value".
 */
function parseMetadataTab(
  workbook: XLSX.WorkBook,
  errors: string[]
): { spaceId: string; operationType: string } {
  const sheet = workbook.Sheets['Metadata'];
  if (!sheet) {
    errors.push('Tab "Metadata" not found in workbook');
    return { spaceId: '', operationType: '' };
  }

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  let spaceId = '';
  let operationType = '';

  for (const row of rows) {
    const field = getStringValue(row, 'Field');
    const value = getStringValue(row, 'Value');

    if (!field) continue;

    const normalizedField = field.toLowerCase().replace(/\s+/g, '');

    switch (normalizedField) {
      case 'spaceid':
        spaceId = value ?? '';
        break;
      case 'operationtype':
        operationType = value ?? '';
        break;
    }
  }

  if (!spaceId) {
    errors.push('Space ID not found in Metadata tab');
  }

  return { spaceId, operationType };
}

/**
 * Parse Merge tab for keeper/merger entity name pairs.
 * Each row has a "Keeper" column and a "Merger" column.
 * Blank rows (both columns empty) are skipped silently.
 */
function parseMergeTab(
  workbook: XLSX.WorkBook,
  errors: string[]
): MergePair[] {
  const sheet = workbook.Sheets['Merge'];
  if (!sheet) {
    errors.push('Tab "Merge" not found in workbook');
    return [];
  }

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const pairs: MergePair[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // +1 for 0-index, +1 for header row

    const keeper = getStringValue(row, 'Keeper');
    const merger = getStringValue(row, 'Merger');

    // Skip completely blank rows
    if (!keeper && !merger) continue;

    // Validate: both columns must be present
    if (keeper && !merger) {
      errors.push(`Row ${rowNumber}: Missing Merger entity name`);
      continue;
    }
    if (!keeper && merger) {
      errors.push(`Row ${rowNumber}: Missing Keeper entity name`);
      continue;
    }

    // At this point both are present and non-empty
    const keeperName = keeper!;
    const mergerName = merger!;

    // Validate: keeper and merger cannot be the same entity
    if (keeperName.toLowerCase() === mergerName.toLowerCase()) {
      errors.push(`Row ${rowNumber}: Keeper and Merger cannot be the same entity ("${keeperName}")`);
      continue;
    }

    pairs.push({ keeperName, mergerName, rowNumber });
  }

  return pairs;
}

/**
 * Parse an Excel merge template.
 *
 * Reads the workbook and extracts:
 * - Space ID and Operation type from the Metadata tab
 * - Keeper/Merger entity name pairs from the Merge tab
 *
 * All validation errors are accumulated and returned in the errors array.
 * The caller decides the rejection policy based on error count.
 *
 * @param filePath - Path to the Excel (.xlsx) file
 * @returns Parsed pairs, space ID, operation type, and any errors found
 */
export function parseMergeTemplate(filePath: string): MergeParseResult {
  const workbook = XLSX.readFile(filePath);
  const errors: string[] = [];

  const { spaceId, operationType } = parseMetadataTab(workbook, errors);
  const pairs = parseMergeTab(workbook, errors);

  return { pairs, spaceId, operationType, errors };
}
