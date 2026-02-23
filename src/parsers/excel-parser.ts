/**
 * Excel/XLSX spreadsheet parser
 *
 * Updated for new spreadsheet format:
 * - No "Related entities" tab (each type has its own tab)
 * - No "Geo ID" columns (use API search for deduplication)
 * - Any non-special tab is an entity tab (tab name = entity type)
 */

import XLSX from 'xlsx';
import { SPECIAL_TABS, REQUIRED_TABS } from '../config/types.js';
import type {
  ParsedSpreadsheet,
  TypeDefinition,
  PropertyDefinition,
  SpreadsheetEntity,
} from '../config/upsert-types.js';
import type { Metadata } from '../config/types.js';
import {
  parseSemicolonList,
  parseMultiValueList,
  cleanString,
} from '../utils/cell-parsers.js';
import { logger } from '../utils/logger.js';

/**
 * Parse an Excel file and return structured data
 */
export function parseExcelFile(filePath: string): ParsedSpreadsheet {
  logger.info('Parsing spreadsheet', { file: filePath });

  const workbook = XLSX.readFile(filePath);
  const sheetNames = workbook.SheetNames;

  logger.debug('Found sheets', { sheets: sheetNames });

  // Parse each tab
  const metadata = parseMetadataTab(workbook);
  const types = parseTypesTab(workbook);
  const properties = parsePropertiesTab(workbook);
  const entities = parseEntityTabs(workbook, properties);

  logger.success('Spreadsheet parsed successfully', {
    types: types.length,
    properties: properties.length,
    entities: entities.length,
  });

  return {
    metadata,
    types,
    properties,
    entities,
  };
}

/**
 * Get sheet data as array of objects
 */
function getSheetData(workbook: XLSX.WorkBook, sheetName: string): Record<string, unknown>[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return [];
  }

  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

/**
 * Find a sheet by name (case-insensitive)
 */
function findSheet(workbook: XLSX.WorkBook, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  return workbook.SheetNames.find(s => s.toLowerCase() === lowerName);
}

/**
 * Get all entity tabs (any tab that's not a special tab)
 */
function getEntityTabs(workbook: XLSX.WorkBook): string[] {
  const specialTabsLower = SPECIAL_TABS.map(t => t.toLowerCase());
  return workbook.SheetNames.filter(
    name => !specialTabsLower.includes(name.toLowerCase())
  );
}

/**
 * Normalize column name for matching
 */
function normalizeColumnName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Get cell value by column name (case-insensitive)
 */
function getCellValue(row: Record<string, unknown>, columnName: string): unknown {
  const normalizedTarget = normalizeColumnName(columnName);

  for (const [key, value] of Object.entries(row)) {
    if (normalizeColumnName(key) === normalizedTarget) {
      return value;
    }
  }

  return undefined;
}

/**
 * Get string cell value
 */
function getStringCell(row: Record<string, unknown>, columnName: string): string | undefined {
  const value = getCellValue(row, columnName);
  if (value === undefined || value === null) {
    return undefined;
  }
  return cleanString(String(value));
}

/**
 * Get boolean cell value
 */
function getBooleanCell(row: Record<string, unknown>, columnName: string): boolean | undefined {
  const value = getCellValue(row, columnName);
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const strValue = String(value).toLowerCase();
  if (['true', 'yes', '1'].includes(strValue)) {
    return true;
  }
  if (['false', 'no', '0'].includes(strValue)) {
    return false;
  }
  return undefined;
}

/**
 * Parse Metadata tab
 */
function parseMetadataTab(workbook: XLSX.WorkBook): Metadata {
  const sheetName = findSheet(workbook, 'Metadata');
  if (!sheetName) {
    throw new Error('Missing required tab: Metadata');
  }

  const rows = getSheetData(workbook, sheetName);
  const metadata: Partial<Metadata> = {};

  // Metadata is in Field/Value format
  for (const row of rows) {
    const field = getStringCell(row, 'Field');
    const value = getStringCell(row, 'Value');
    const boolValue = getBooleanCell(row, 'Value');

    if (!field) continue;

    const normalizedField = field.toLowerCase().replace(/\s+/g, '');

    switch (normalizedField) {
      case 'spaceid':
        metadata.spaceId = value;
        break;
      case 'spacetype':
        if (value?.toLowerCase() === 'dao') {
          metadata.spaceType = 'DAO';
        } else {
          metadata.spaceType = 'Personal';
        }
        break;
      case 'author':
        metadata.author = value;
        break;
      case 'sourcedate':
        metadata.sourceDate = value;
        break;
      case 'preparedby':
        metadata.preparedBy = value;
        break;
      case 'reviewedby':
        metadata.reviewedBy = value;
        break;
      case 'publishedby':
        metadata.publishedBy = value;
        break;
      case 'publishdate':
        metadata.publishDate = value;
        break;
      case 'notes':
        metadata.notes = value;
        break;
      case 'readyforpublishing':
        metadata.readyForPublishing = boolValue;
        break;
    }
  }

  if (!metadata.spaceId) {
    // Generate a placeholder for dry-run mode
    metadata.spaceId = 'placeholder_space_id_for_dry_run';
    logger.warn('Space ID not set in Metadata tab - using placeholder for dry-run');
  }

  if (!metadata.spaceType) {
    metadata.spaceType = 'Personal';
  }

  logger.debug('Parsed metadata', {
    spaceId: metadata.spaceId,
    spaceType: metadata.spaceType,
    author: metadata.author,
  });

  return metadata as Metadata;
}

/**
 * Parse Types tab
 */
function parseTypesTab(workbook: XLSX.WorkBook): TypeDefinition[] {
  const sheetName = findSheet(workbook, 'Types');
  if (!sheetName) {
    throw new Error('Missing required tab: Types');
  }

  const rows = getSheetData(workbook, sheetName);
  const types: TypeDefinition[] = [];

  for (const row of rows) {
    const name = getStringCell(row, 'Type name');
    if (!name) continue;

    const type: TypeDefinition = {
      name,
      space: getStringCell(row, 'Space'),
      description: getStringCell(row, 'Description'),
      defaultProperties: getStringCell(row, 'Default properties'),
    };

    types.push(type);
  }

  logger.debug('Parsed types', { count: types.length });

  return types;
}

/**
 * Parse Properties tab
 */
function parsePropertiesTab(workbook: XLSX.WorkBook): PropertyDefinition[] {
  const sheetName = findSheet(workbook, 'Properties');
  if (!sheetName) {
    throw new Error('Missing required tab: Properties');
  }

  const rows = getSheetData(workbook, sheetName);
  const properties: PropertyDefinition[] = [];

  for (const row of rows) {
    const name = getStringCell(row, 'Property name');
    if (!name) continue;

    const dataTypeRaw = getStringCell(row, 'Data type') || 'TEXT';
    // Normalize common aliases to canonical SDK type names
    const DATA_TYPE_ALIASES: Record<string, PropertyDefinition['dataType']> = {
      INT64: 'INTEGER',
      INT: 'INTEGER',
      FLOAT64: 'FLOAT',
      DOUBLE: 'FLOAT',
      DECIMAL: 'FLOAT',
      BOOL: 'BOOLEAN',
    };
    const upper = dataTypeRaw.toUpperCase();
    let dataType = (DATA_TYPE_ALIASES[upper] ?? upper) as PropertyDefinition['dataType'];

    const property: PropertyDefinition = {
      name,
      dataType,
      renderableType: getStringCell(row, 'Renderable type'),
      pointsToTypes: getStringCell(row, 'Points to type(s)'),
      description: getStringCell(row, 'Description'),
    };

    properties.push(property);
  }

  logger.debug('Parsed properties', { count: properties.length });

  return properties;
}

/**
 * Parse all entity tabs (any non-special tab)
 */
function parseEntityTabs(
  workbook: XLSX.WorkBook,
  properties: PropertyDefinition[]
): SpreadsheetEntity[] {
  const entitySheets = getEntityTabs(workbook);

  if (entitySheets.length === 0) {
    logger.warn('No entity tabs found');
    return [];
  }

  logger.debug('Found entity tabs', { tabs: entitySheets });

  // Build property lookup for relation detection
  const propertyMap = new Map<string, PropertyDefinition>();
  for (const prop of properties) {
    propertyMap.set(normalizeColumnName(prop.name), prop);
  }

  const entities: SpreadsheetEntity[] = [];

  for (const sheetName of entitySheets) {
    const sheetEntities = parseEntityTab(workbook, sheetName, propertyMap);
    entities.push(...sheetEntities);
  }

  logger.debug('Parsed entities', { count: entities.length });

  return entities;
}

/**
 * Parse a single entity tab
 * Tab name becomes the default entity type
 */
function parseEntityTab(
  workbook: XLSX.WorkBook,
  sheetName: string,
  propertyMap: Map<string, PropertyDefinition>
): SpreadsheetEntity[] {
  const rows = getSheetData(workbook, sheetName);
  const entities: SpreadsheetEntity[] = [];

  // Tab name is the default type for entities in this tab
  const defaultType = sheetName;

  // Get column names from first row
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const columnNames: string[] = [];

  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    const cell = sheet[cellAddress];
    columnNames.push(cell?.v ? String(cell.v) : '');
  }

  for (const row of rows) {
    const name = getStringCell(row, 'Entity name');
    if (!name) continue;

    // Check for explicit Types column, otherwise use tab name as type
    const typesRaw = getStringCell(row, 'Types') || getStringCell(row, 'Type');
    const types = typesRaw ? parseSemicolonList(typesRaw) : [defaultType];

    // Extract optional image URLs
    const avatarUrl = getStringCell(row, 'Avatar URL') || getStringCell(row, 'Avatar url') || undefined;
    const coverUrl = getStringCell(row, 'Cover URL') || getStringCell(row, 'Cover url') || undefined;

    const entity: SpreadsheetEntity = {
      name,
      types,
      properties: {},
      relations: {},
      sourceTab: sheetName,
      ...(avatarUrl && { avatarUrl }),
      ...(coverUrl && { coverUrl }),
    };

    // Process each column
    for (const colName of columnNames) {
      const normalizedCol = normalizeColumnName(colName);

      // Skip standard columns and image columns
      if (
        normalizedCol === 'entity name' ||
        normalizedCol === 'types' ||
        normalizedCol === 'type' ||
        normalizedCol === 'avatar url' ||
        normalizedCol === 'cover url'
      ) {
        continue;
      }

      const value = getStringCell(row, colName);
      if (!value) continue;

      // Check if this is a relation column
      const propDef = propertyMap.get(normalizedCol);

      if (propDef?.dataType === 'RELATION') {
        // Check if this property points to location types (don't split by comma)
        const pointsToTypes = propDef.pointsToTypes?.toLowerCase() || '';
        const isLocationProperty =
          pointsToTypes.includes('city') ||
          pointsToTypes.includes('country') ||
          pointsToTypes.includes('place') ||
          pointsToTypes.includes('location');

        if (isLocationProperty) {
          // Don't split location values - keep as single entity name
          entity.relations[colName] = [value.trim()];
        } else {
          // Parse as semicolon or comma-separated entity names
          entity.relations[colName] = parseMultiValueList(value);
        }
      } else {
        // Store as regular property value
        entity.properties[colName] = value;
      }
    }

    entities.push(entity);
  }

  return entities;
}

/**
 * Get list of sheet names in workbook
 */
export function getSheetNames(filePath: string): string[] {
  const workbook = XLSX.readFile(filePath);
  return workbook.SheetNames;
}

/**
 * Check if required tabs exist
 */
export function checkRequiredTabs(filePath: string): { missing: string[]; found: string[] } {
  const sheetNames = getSheetNames(filePath);
  const lowerSheetNames = sheetNames.map(s => s.toLowerCase());

  const missing: string[] = [];
  const found: string[] = [];

  for (const required of REQUIRED_TABS) {
    if (lowerSheetNames.includes(required.toLowerCase())) {
      found.push(required);
    } else {
      missing.push(required);
    }
  }

  // Check for at least one entity tab (any non-special tab)
  const specialTabsLower = SPECIAL_TABS.map(t => t.toLowerCase());
  const hasEntityTab = sheetNames.some(
    s => !specialTabsLower.includes(s.toLowerCase())
  );
  if (!hasEntityTab) {
    missing.push('At least one entity tab (any tab other than Metadata, Types, Properties)');
  }

  return { missing, found };
}
