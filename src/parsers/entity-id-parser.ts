/**
 * Entity ID parser for Excel-based delete/update inputs
 *
 * Reads entity IDs from the 'Entity ID' column and space ID from the 'Space ID' column.
 * Enforces: 32-char hex format, header row required, duplicate rejection (not silent dedup),
 * whitespace trimming, blank row skipping, single space ID per CSV.
 */

import XLSX from 'xlsx';
import { isValidGeoId, cleanString } from '../utils/cell-parsers.js';

export interface EntityIdParseResult {
  ids: string[];
  spaceId: string;
  errors: string[];
}

/**
 * Find a column value by header name, handling BOM prefixes and case variations.
 * CSV files may have a BOM (\uFEFF) prepended to the first header, so we strip it.
 */
function getColumnValue(row: Record<string, unknown>, headerName: string): unknown {
  // Direct match first
  if (headerName in row) return row[headerName];

  // Try stripping BOM from keys (CSV files may have \uFEFF prefix on first header)
  for (const key of Object.keys(row)) {
    const cleaned = key.replace(/^\uFEFF/, '');
    if (cleaned === headerName) return row[key];
  }

  return undefined;
}

/**
 * Parse entity IDs from an Excel tab.
 * Expects a tab with a header row containing 'Entity ID' and 'Space ID' columns.
 *
 * Behavior:
 * - Reads entity IDs from the 'Entity ID' column by header name
 * - Reads space IDs from the 'Space ID' column by header name
 * - Trims whitespace from each cell
 * - Skips completely blank rows silently
 * - Rejects duplicate entity IDs (returns error, does NOT silently dedup)
 * - Validates 32-char hex format via isValidGeoId()
 * - Enforces exactly one unique space ID across all rows
 *
 * @param filePath - Path to the Excel file
 * @param tabName - Name of the tab containing entity IDs
 * @returns Object with validated ids array, single spaceId, and errors array
 */
export function parseEntityIds(filePath: string, tabName: string): EntityIdParseResult {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[tabName];

  if (!sheet) {
    return { ids: [], spaceId: '', errors: [`Tab "${tabName}" not found in workbook`] };
  }

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) {
    return { ids: [], spaceId: '', errors: ['No data rows found (only header row or empty tab)'] };
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  const spaceIds = new Set<string>();
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 for 0-index, +1 for header row

    // Read named columns
    const entityIdRaw = getColumnValue(row, 'Entity ID');
    const spaceIdRaw = getColumnValue(row, 'Space ID');

    const entityIdStr = entityIdRaw !== undefined && entityIdRaw !== null && entityIdRaw !== '' ? cleanString(String(entityIdRaw)) : undefined;
    const spaceIdStr = spaceIdRaw !== undefined && spaceIdRaw !== null && spaceIdRaw !== '' ? cleanString(String(spaceIdRaw)) : undefined;

    // Skip completely blank rows (both columns empty)
    if (!entityIdStr && !spaceIdStr) continue;

    // Validate: if one column has data but the other is missing, report error
    if (!entityIdStr && spaceIdStr) {
      errors.push(`Row ${rowNum}: Missing Entity ID`);
      // Still process space ID even if entity ID is missing
    }
    if (entityIdStr && !spaceIdStr) {
      errors.push(`Row ${rowNum}: Missing Space ID`);
    }

    // Validate and collect entity ID
    if (entityIdStr) {
      const id = entityIdStr.toLowerCase();

      if (!isValidGeoId(id)) {
        errors.push(`Row ${rowNum}: "${entityIdStr}" is not a valid entity ID (expected 32-char hex string)`);
      } else if (seen.has(id)) {
        errors.push(`Row ${rowNum}: Duplicate entity ID "${id}"`);
      } else {
        seen.add(id);
        ids.push(id);
      }
    }

    // Validate and collect space ID
    if (spaceIdStr) {
      const spaceIdLower = spaceIdStr.toLowerCase();

      if (!isValidGeoId(spaceIdLower)) {
        errors.push(`Row ${rowNum}: "${spaceIdStr}" is not a valid space ID (expected 32-char hex string)`);
      } else {
        spaceIds.add(spaceIdLower);
      }
    }
  }

  // Validate single space ID across entire CSV
  if (spaceIds.size === 0 && ids.length > 0) {
    errors.push('No Space ID found in CSV');
  }
  if (spaceIds.size > 1) {
    errors.push(`CSV contains multiple Space IDs: ${[...spaceIds].join(', ')}. Each CSV must target a single space.`);
  }

  const spaceId = [...spaceIds][0] ?? '';

  return { ids, spaceId, errors };
}
