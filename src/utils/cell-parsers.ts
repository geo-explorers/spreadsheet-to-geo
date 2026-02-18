/**
 * Utility functions for parsing spreadsheet cell values
 */

import { randomUUID } from 'crypto';

/**
 * Parse semicolon-separated values from a cell
 * Handles trimming and empty values
 */
export function parseSemicolonList(value: string | undefined | null): string[] {
  if (!value || typeof value !== 'string') {
    return [];
  }

  return value
    .split(';')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

/**
 * Parse comma-separated values from a cell (for backwards compatibility)
 */
export function parseCommaList(value: string | undefined | null): string[] {
  if (!value || typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

/**
 * Parse multi-value list - supports both semicolon and comma separators
 * Prefers semicolon if present, otherwise falls back to comma
 */
export function parseMultiValueList(value: string | undefined | null): string[] {
  if (!value || typeof value !== 'string') {
    return [];
  }

  // If semicolon is present, use it as separator
  if (value.includes(';')) {
    return parseSemicolonList(value);
  }

  // Otherwise use comma
  return parseCommaList(value);
}

/**
 * Normalize entity name for matching
 * - Lowercase
 * - Trim whitespace
 * - Normalize internal whitespace
 * - Normalize quotes
 */
export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"');
}

/**
 * Validate Geo ID format
 * Must be 32 hexadecimal characters (UUID without dashes)
 */
export function isValidGeoId(id: string | undefined | null): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }

  const trimmed = id.trim();
  return /^[a-f0-9]{32}$/i.test(trimmed);
}

/**
 * Clean and validate Geo ID
 * Returns cleaned ID or undefined if invalid
 */
export function cleanGeoId(id: string | undefined | null): string | undefined {
  if (!id || typeof id !== 'string') {
    return undefined;
  }

  const trimmed = id.trim().toLowerCase();

  // Remove dashes if present (convert from UUID format)
  const noDashes = trimmed.replace(/-/g, '');

  if (/^[a-f0-9]{32}$/.test(noDashes)) {
    return noDashes;
  }

  return undefined;
}

/**
 * Generate a new Geo ID (UUID v4 without dashes)
 */
export function generateGeoId(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Parse date string to ISO format (YYYY-MM-DD)
 * Handles various date formats
 */
export function parseDate(value: string | number | Date | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }

  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    // Excel serial date number
    date = excelSerialToDate(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    // Try parsing as ISO date first
    date = new Date(trimmed);

    // Check if valid
    if (isNaN(date.getTime())) {
      return undefined;
    }
  } else {
    return undefined;
  }

  // Format as YYYY-MM-DD
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Convert Excel serial date to JavaScript Date
 * Excel dates start from 1900-01-01 (serial = 1)
 */
function excelSerialToDate(serial: number): Date {
  // Excel incorrectly considers 1900 a leap year, so we need to adjust
  // Dates after Feb 28, 1900 need -1 day adjustment
  const adjustedSerial = serial > 59 ? serial - 1 : serial;

  // Excel epoch is December 30, 1899
  const excelEpoch = new Date(1899, 11, 30);
  const msPerDay = 24 * 60 * 60 * 1000;

  return new Date(excelEpoch.getTime() + adjustedSerial * msPerDay);
}

/**
 * Parse boolean value from cell
 */
export function parseBoolean(value: string | boolean | number | undefined | null): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const str = String(value).toLowerCase().trim();

  if (['true', 'yes', '1', 'y'].includes(str)) {
    return true;
  }

  if (['false', 'no', '0', 'n', ''].includes(str)) {
    return false;
  }

  return undefined;
}

/**
 * Parse integer value from cell
 */
export function parseInteger(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number') {
    return Math.floor(value);
  }

  const str = String(value).trim();
  if (!str) {
    return undefined;
  }

  const parsed = parseInt(str, 10);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse float value from cell
 */
export function parseFloat(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  const str = String(value).trim();
  if (!str) {
    return undefined;
  }

  const parsed = Number.parseFloat(str);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Clean string value - trim and handle empty
 */
export function cleanString(value: string | undefined | null): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Check if a cell value is empty
 */
export function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  return false;
}
