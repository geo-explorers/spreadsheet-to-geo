/**
 * Entity ID parser for Excel-based delete/update inputs
 *
 * Reads entity IDs from an Excel tab and validates them.
 * Enforces: 32-char hex format, header row required, duplicate rejection (not silent dedup),
 * whitespace trimming, blank row skipping.
 */

import XLSX from 'xlsx';
import { isValidGeoId, cleanString } from '../utils/cell-parsers.js';

export interface EntityIdParseResult {
  ids: string[];
  errors: string[];
}

/**
 * Parse entity IDs from an Excel tab.
 * Expects a tab with a header row and one column of 32-char hex entity IDs.
 *
 * Behavior:
 * - Trims whitespace from each cell
 * - Skips blank rows silently
 * - Rejects duplicate IDs (returns error, does NOT silently dedup)
 * - Validates 32-char hex format via isValidGeoId()
 *
 * @param filePath - Path to the Excel file
 * @param tabName - Name of the tab containing entity IDs
 * @returns Object with validated ids array and errors array
 */
export function parseEntityIds(filePath: string, tabName: string): EntityIdParseResult {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[tabName];

  if (!sheet) {
    return { ids: [], errors: [`Tab "${tabName}" not found in workbook`] };
  }

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) {
    return { ids: [], errors: ['No data rows found (only header row or empty tab)'] };
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 for 0-index, +1 for header row

    // Get first column value
    const values = Object.values(row);
    const raw = values[0];
    if (raw === undefined || raw === null || raw === '') continue; // blank row -- skip silently

    const value = cleanString(String(raw));
    if (!value) continue; // whitespace-only row -- skip silently

    const id = value.toLowerCase();

    if (!isValidGeoId(id)) {
      errors.push(`Row ${rowNum}: "${value}" is not a valid entity ID (expected 32-char hex string)`);
      continue;
    }

    if (seen.has(id)) {
      errors.push(`Row ${rowNum}: Duplicate entity ID "${id}"`);
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return { ids, errors };
}
