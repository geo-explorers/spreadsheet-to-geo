/**
 * Utility functions for parsing spreadsheet cell values
 */

import { randomUUID } from 'crypto';
import type { TypedValue } from '@geoprotocol/geo-sdk';

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
 * Parse time value to ISO 8601 time format with UTC timezone (HH:MM:SSZ)
 * Handles: "14:30:00", "14:30", "2:30 PM", Excel time serials (fraction of day)
 */
export function parseTime(value: string | number | Date | undefined | null): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  let hours: number;
  let minutes: number;
  let seconds: number;

  if (typeof value === 'number') {
    // Excel time serial: fraction of day (0.5 = noon = 12:00:00)
    const totalSeconds = Math.round(value * 86400);
    hours = Math.floor(totalSeconds / 3600);
    minutes = Math.floor((totalSeconds % 3600) / 60);
    seconds = totalSeconds % 60;
  } else {
    let date: Date;

    if (value instanceof Date) {
      date = value;
    } else {
      const trimmed = value.trim();
      if (!trimmed) return undefined;

      // Try pure time format: HH:MM or HH:MM:SS (optionally with AM/PM)
      const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i);
      if (timeMatch) {
        hours = parseInt(timeMatch[1]);
        minutes = parseInt(timeMatch[2]);
        seconds = timeMatch[3] ? parseInt(timeMatch[3]) : 0;
        const meridiem = timeMatch[4]?.toUpperCase();
        if (meridiem === 'PM' && hours < 12) hours += 12;
        if (meridiem === 'AM' && hours === 12) hours = 0;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}Z`;
      }

      // Fall back to full date parse and extract time component
      date = new Date(trimmed);
      if (isNaN(date.getTime())) return undefined;
    }

    hours = date.getHours();
    minutes = date.getMinutes();
    seconds = date.getSeconds();
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}Z`;
}

/**
 * Parse datetime value to ISO 8601 combined format (YYYY-MM-DDTHH:MM:SSZ)
 * Handles: "2024-01-15T14:30:00", "2024-01-15 14:30:00", Excel datetime serials
 */
export function parseDatetime(value: string | number | Date | undefined | null): string | undefined {
  if (!value) return undefined;

  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    // Excel datetime serial: integer part = date, fractional part = time
    date = excelSerialToDate(value);
  } else {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    date = new Date(trimmed);
    if (isNaN(date.getTime())) return undefined;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
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

/**
 * Convert a spreadsheet string value to SDK TypedValue format.
 * Shared by both the upsert (batch-builder) and update (diff) pipelines.
 */
export function convertToTypedValue(
  value: string,
  dataType: string
): TypedValue | undefined {
  switch (dataType) {
    case 'TEXT':
      return { type: 'text', value };

    case 'INTEGER': {
      const intVal = parseInt(value, 10);
      if (isNaN(intVal)) return undefined;
      return { type: 'integer', value: intVal };
    }

    case 'FLOAT': {
      const floatVal = Number.parseFloat(value);
      if (isNaN(floatVal)) return undefined;
      return { type: 'float', value: floatVal };
    }

    case 'DATE': {
      const dateVal = parseDate(value);
      if (!dateVal) return undefined;
      return { type: 'date', value: dateVal };
    }

    case 'TIME': {
      const timeVal = parseTime(value);
      if (!timeVal) return undefined;
      return { type: 'time', value: timeVal };
    }

    case 'DATETIME': {
      const datetimeVal = parseDatetime(value);
      if (!datetimeVal) return undefined;
      return { type: 'datetime', value: datetimeVal };
    }

    case 'BOOLEAN': {
      const lower = value.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(lower)) return { type: 'boolean', value: true };
      if (['false', 'no', 'n', '0'].includes(lower)) return { type: 'boolean', value: false };
      return undefined;
    }

    case 'POINT': {
      const parts = value.split(',').map(p => Number.parseFloat(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { type: 'point', lat: parts[0], lon: parts[1] };
      }
      return undefined;
    }

    case 'SCHEDULE':
      return { type: 'schedule', value };

    default:
      return { type: 'text', value };
  }
}
