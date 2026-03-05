/**
 * Two-tab Excel parser for delete-triples command
 *
 * Reads an Excel file with optional "Relations" and "Properties" tabs.
 * - Relations tab: columns "Relation ID" and "Space ID"
 * - Properties tab: columns "Entity ID", "Property ID", and "Space ID"
 *
 * Both tabs are optional, but at least one must contain data.
 * Enforces a single unique space ID across both tabs.
 * Accumulates all errors (does not fail on first).
 */

import XLSX from 'xlsx';
import { isValidGeoId, cleanString } from '../utils/cell-parsers.js';
import type {
  RelationEntry,
  PropertyUnsetEntry,
  TriplesParseResult,
} from '../config/delete-triples-types.js';

/**
 * Find a column value by header name, handling BOM prefixes.
 * CSV/Excel files may have a BOM (\uFEFF) prepended to the first header.
 * Duplicated from entity-id-parser.ts (not exported there).
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
 * Extract and clean a cell value, returning undefined for empty/null cells.
 */
function extractCellValue(row: Record<string, unknown>, headerName: string): string | undefined {
  const raw = getColumnValue(row, headerName);
  if (raw === undefined || raw === null || raw === '') return undefined;
  return cleanString(String(raw));
}

/**
 * Parse the Relations tab from the workbook.
 * Columns: "Relation ID", "Space ID"
 */
function parseRelationsTab(
  sheet: XLSX.WorkSheet
): { items: RelationEntry[]; spaceIds: Set<string>; errors: string[] } {
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const items: RelationEntry[] = [];
  const seen = new Set<string>();
  const spaceIds = new Set<string>();
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 0-index + header row

    const relationIdStr = extractCellValue(row, 'Relation ID');
    const spaceIdStr = extractCellValue(row, 'Space ID');

    // Skip completely blank rows
    if (!relationIdStr && !spaceIdStr) continue;

    // Validate: if one column has data but the other is missing, report error
    if (!relationIdStr && spaceIdStr) {
      errors.push(`Relations tab row ${rowNum}: Missing Relation ID`);
    }
    if (relationIdStr && !spaceIdStr) {
      errors.push(`Relations tab row ${rowNum}: Missing Space ID`);
    }

    // Validate and collect relation ID
    if (relationIdStr) {
      const id = relationIdStr.toLowerCase();

      if (!isValidGeoId(id)) {
        errors.push(
          `Relations tab row ${rowNum}: "${relationIdStr}" is not a valid Relation ID (expected 32-char hex string)`
        );
      } else if (seen.has(id)) {
        errors.push(`Relations tab row ${rowNum}: Duplicate Relation ID "${id}"`);
      } else {
        seen.add(id);

        // Only add the item if space ID is also valid
        if (spaceIdStr) {
          const spaceIdLower = spaceIdStr.toLowerCase();
          if (isValidGeoId(spaceIdLower)) {
            items.push({ relationId: id, spaceId: spaceIdLower });
          }
        }
      }
    }

    // Validate and collect space ID
    if (spaceIdStr) {
      const spaceIdLower = spaceIdStr.toLowerCase();
      if (!isValidGeoId(spaceIdLower)) {
        errors.push(
          `Relations tab row ${rowNum}: "${spaceIdStr}" is not a valid Space ID (expected 32-char hex string)`
        );
      } else {
        spaceIds.add(spaceIdLower);
      }
    }
  }

  return { items, spaceIds, errors };
}

/**
 * Parse the Properties tab from the workbook.
 * Columns: "Entity ID", "Property ID", "Space ID"
 */
function parsePropertiesTab(
  sheet: XLSX.WorkSheet
): { items: PropertyUnsetEntry[]; spaceIds: Set<string>; errors: string[] } {
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const items: PropertyUnsetEntry[] = [];
  const seenPairs = new Set<string>();
  const spaceIds = new Set<string>();
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 0-index + header row

    const entityIdStr = extractCellValue(row, 'Entity ID');
    const propertyIdStr = extractCellValue(row, 'Property ID');
    const spaceIdStr = extractCellValue(row, 'Space ID');

    // Skip completely blank rows (all columns empty)
    if (!entityIdStr && !propertyIdStr && !spaceIdStr) continue;

    // Validate individual columns
    if (!entityIdStr) {
      errors.push(`Properties tab row ${rowNum}: Missing Entity ID`);
    }
    if (!propertyIdStr) {
      errors.push(`Properties tab row ${rowNum}: Missing Property ID`);
    }
    if (!spaceIdStr) {
      errors.push(`Properties tab row ${rowNum}: Missing Space ID`);
    }

    // Validate formats
    let entityIdLower: string | undefined;
    let propertyIdLower: string | undefined;
    let spaceIdLower: string | undefined;

    if (entityIdStr) {
      entityIdLower = entityIdStr.toLowerCase();
      if (!isValidGeoId(entityIdLower)) {
        errors.push(
          `Properties tab row ${rowNum}: "${entityIdStr}" is not a valid Entity ID (expected 32-char hex string)`
        );
        entityIdLower = undefined;
      }
    }

    if (propertyIdStr) {
      propertyIdLower = propertyIdStr.toLowerCase();
      if (!isValidGeoId(propertyIdLower)) {
        errors.push(
          `Properties tab row ${rowNum}: "${propertyIdStr}" is not a valid Property ID (expected 32-char hex string)`
        );
        propertyIdLower = undefined;
      }
    }

    if (spaceIdStr) {
      spaceIdLower = spaceIdStr.toLowerCase();
      if (!isValidGeoId(spaceIdLower)) {
        errors.push(
          `Properties tab row ${rowNum}: "${spaceIdStr}" is not a valid Space ID (expected 32-char hex string)`
        );
        spaceIdLower = undefined;
      } else {
        spaceIds.add(spaceIdLower);
      }
    }

    // Check for duplicate entity+property pairs
    if (entityIdLower && propertyIdLower) {
      const pairKey = `${entityIdLower}:${propertyIdLower}`;
      if (seenPairs.has(pairKey)) {
        errors.push(
          `Properties tab row ${rowNum}: Duplicate Entity ID + Property ID pair "${entityIdLower}:${propertyIdLower}"`
        );
      } else {
        seenPairs.add(pairKey);

        // Only add the item if all three IDs are valid
        if (spaceIdLower) {
          items.push({
            entityId: entityIdLower,
            propertyId: propertyIdLower,
            spaceId: spaceIdLower,
          });
        }
      }
    }
  }

  return { items, spaceIds, errors };
}

/**
 * Parse an Excel file with optional "Relations" and "Properties" tabs.
 *
 * Behavior:
 * - Both tabs are optional, but at least one must contain data
 * - Validates all IDs via isValidGeoId() (32-char hex format)
 * - Rejects duplicate Relation IDs and duplicate Entity+Property pairs
 * - Enforces exactly one unique space ID across both tabs
 * - Accumulates all errors (does not fail on first)
 *
 * @param filePath - Path to the Excel (.xlsx) file
 * @returns Parsed relations, properties, single space ID, and accumulated errors
 */
export function parseTriplesFile(filePath: string): TriplesParseResult {
  const workbook = XLSX.readFile(filePath);

  const relationsSheet = workbook.Sheets['Relations'];
  const propertiesSheet = workbook.Sheets['Properties'];

  // Parse each tab independently
  const relations = relationsSheet
    ? parseRelationsTab(relationsSheet)
    : { items: [], spaceIds: new Set<string>(), errors: [] };

  const properties = propertiesSheet
    ? parsePropertiesTab(propertiesSheet)
    : { items: [], spaceIds: new Set<string>(), errors: [] };

  // Combine errors from both tabs
  const errors: string[] = [...relations.errors, ...properties.errors];

  // Check that at least one tab has data
  if (relations.items.length === 0 && properties.items.length === 0 && errors.length === 0) {
    errors.push(
      "No 'Relations' or 'Properties' tab found, or both are empty. At least one must contain data."
    );
    return { relations: [], properties: [], spaceId: '', errors };
  }

  // Collect ALL space IDs from both tabs into a single Set
  const allSpaceIds = new Set<string>([...relations.spaceIds, ...properties.spaceIds]);

  // Enforce exactly ONE unique space ID across both tabs
  if (allSpaceIds.size === 0 && (relations.items.length > 0 || properties.items.length > 0)) {
    errors.push('No valid Space ID found across Relations and Properties tabs');
  }
  if (allSpaceIds.size > 1) {
    errors.push(
      `Multiple Space IDs found across tabs: ${[...allSpaceIds].join(', ')}. All entries must target a single space.`
    );
  }

  const spaceId = [...allSpaceIds][0] ?? '';

  return {
    relations: relations.items,
    properties: properties.items,
    spaceId,
    errors,
  };
}
