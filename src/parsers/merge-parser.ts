/**
 * Excel template parser for the merge command (Phase 4: Bulk Merge)
 *
 * Parses an Excel workbook with:
 * - Metadata tab: Field/Value rows containing Space ID and Operation type
 * - Merge tab: Keeper ID / Merger ID columns (required), Keeper / Merger name columns (optional)
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
  spaceType: string;
  author: string;
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
 * Validate that a string looks like a Geo entity ID (32-char hex, with or without 0x prefix).
 */
function isValidEntityId(id: string): boolean {
  return /^(0x)?[0-9a-f]{32}$/i.test(id);
}

/**
 * Parse Metadata tab for Space ID and Operation type.
 * The Metadata tab uses a Field/Value row pattern where each row
 * is a key-value pair with columns named "Field" and "Value".
 */
function parseMetadataTab(
  workbook: XLSX.WorkBook,
  errors: string[]
): { spaceId: string; spaceType: string; author: string; operationType: string } {
  const sheet = workbook.Sheets['Metadata'];
  if (!sheet) {
    errors.push('Tab "Metadata" not found in workbook');
    return { spaceId: '', spaceType: '', author: '', operationType: '' };
  }

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  let spaceId = '';
  let spaceType = '';
  let author = '';
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
      case 'spacetype':
        spaceType = value ?? '';
        break;
      case 'author':
        author = value ?? '';
        break;
      case 'operationtype':
        operationType = value?.trim().toUpperCase() ?? '';
        break;
    }
  }

  if (!spaceId) {
    errors.push('Space ID not found in Metadata tab');
  }

  return { spaceId, spaceType, author, operationType };
}

/**
 * Parse Merge tab for keeper/merger entity ID pairs.
 *
 * Required columns: "Keeper ID", "Merger ID"
 * Optional columns: "Keeper" (name), "Merger" (name), "Keeper Space ID", "Merger Space ID"
 *
 * Blank rows (all columns empty) are skipped silently.
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

    const keeperId = getStringValue(row, 'Keeper ID');
    const mergerId = getStringValue(row, 'Merger ID');
    const keeperName = getStringValue(row, 'Keeper');
    const mergerName = getStringValue(row, 'Merger');
    const keeperSpaceId = getStringValue(row, 'Keeper Space ID');
    const mergerSpaceId = getStringValue(row, 'Merger Space ID');

    // Skip completely blank rows
    if (!keeperId && !mergerId && !keeperName && !mergerName) continue;

    // Validate: both IDs must be present
    if (!keeperId) {
      errors.push(`Row ${rowNumber}: Missing Keeper ID`);
      continue;
    }
    if (!mergerId) {
      errors.push(`Row ${rowNumber}: Missing Merger ID`);
      continue;
    }

    // Validate ID format
    if (!isValidEntityId(keeperId)) {
      errors.push(`Row ${rowNumber}: Invalid Keeper ID format "${keeperId}" (expected 32-char hex)`);
      continue;
    }
    if (!isValidEntityId(mergerId)) {
      errors.push(`Row ${rowNumber}: Invalid Merger ID format "${mergerId}" (expected 32-char hex)`);
      continue;
    }

    // Validate: if one space ID is provided, both must be
    if ((keeperSpaceId && !mergerSpaceId) || (!keeperSpaceId && mergerSpaceId)) {
      errors.push(`Row ${rowNumber}: Both "Keeper Space ID" and "Merger Space ID" must be provided (got only one)`);
      continue;
    }

    // Validate space ID format if provided
    if (keeperSpaceId && !isValidEntityId(keeperSpaceId)) {
      errors.push(`Row ${rowNumber}: Invalid Keeper Space ID format "${keeperSpaceId}" (expected 32-char hex)`);
      continue;
    }
    if (mergerSpaceId && !isValidEntityId(mergerSpaceId)) {
      errors.push(`Row ${rowNumber}: Invalid Merger Space ID format "${mergerSpaceId}" (expected 32-char hex)`);
      continue;
    }

    // Normalize IDs (strip 0x prefix if present for consistency)
    const normalizedKeeperId = keeperId.replace(/^0x/i, '');
    const normalizedMergerId = mergerId.replace(/^0x/i, '');
    const normalizedKeeperSpaceId = keeperSpaceId?.replace(/^0x/i, '');
    const normalizedMergerSpaceId = mergerSpaceId?.replace(/^0x/i, '');

    // Validate: keeper and merger cannot be the same entity
    if (normalizedKeeperId.toLowerCase() === normalizedMergerId.toLowerCase()) {
      errors.push(`Row ${rowNumber}: Keeper ID and Merger ID cannot be the same ("${keeperId}")`);
      continue;
    }

    pairs.push({
      keeperId: normalizedKeeperId,
      mergerId: normalizedMergerId,
      keeperName: keeperName || undefined,
      mergerName: mergerName || undefined,
      keeperSpaceId: normalizedKeeperSpaceId || undefined,
      mergerSpaceId: normalizedMergerSpaceId || undefined,
      rowNumber,
    });
  }

  // Validate: detect duplicate pairs
  const seenPairs = new Set<string>();
  for (const pair of pairs) {
    const key = `${pair.keeperId}::${pair.mergerId}`;
    if (seenPairs.has(key)) {
      errors.push(`Row ${pair.rowNumber}: Duplicate pair (same Keeper ID + Merger ID)`);
    }
    seenPairs.add(key);
  }

  // Validate: detect duplicate mergers (same entity merged into different keepers)
  const mergerToKeeper = new Map<string, { keeperId: string; rowNumber: number }>();
  for (const pair of pairs) {
    const existing = mergerToKeeper.get(pair.mergerId);
    if (existing) {
      errors.push(
        `Row ${pair.rowNumber}: Merger "${pair.mergerId}" already merged into keeper "${existing.keeperId}" at row ${existing.rowNumber}`
      );
    } else {
      mergerToKeeper.set(pair.mergerId, { keeperId: pair.keeperId, rowNumber: pair.rowNumber });
    }
  }

  // Validate: detect cycles (entity is keeper in one pair and merger in another)
  const keeperIds = new Set(pairs.map(p => p.keeperId));
  const mergerIds = new Set(pairs.map(p => p.mergerId));

  for (const pair of pairs) {
    if (keeperIds.has(pair.mergerId)) {
      errors.push(
        `Row ${pair.rowNumber}: Merger ID "${pair.mergerId}" is also a Keeper in another pair (cycle)`
      );
    }
    if (mergerIds.has(pair.keeperId)) {
      errors.push(
        `Row ${pair.rowNumber}: Keeper ID "${pair.keeperId}" is also a Merger in another pair (cycle)`
      );
    }
  }

  return pairs;
}

/**
 * Parse an Excel merge template.
 *
 * Reads the workbook and extracts:
 * - Space ID and Operation type from the Metadata tab
 * - Keeper/Merger entity ID pairs from the Merge tab (names optional)
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

  const { spaceId, spaceType, author, operationType } = parseMetadataTab(workbook, errors);
  const pairs = parseMergeTab(workbook, errors);

  return { pairs, spaceId, spaceType, author, operationType, errors };
}
