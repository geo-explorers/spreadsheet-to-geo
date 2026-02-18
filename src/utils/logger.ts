/**
 * Structured logging utility
 */

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

let verboseMode = false;

export function setVerbose(verbose: boolean): void {
  verboseMode = verbose;
}

export function isVerbose(): boolean {
  return verboseMode;
}

function formatMessage(level: LogLevel, message: string, details?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  let prefix: string;

  switch (level) {
    case 'debug':
      prefix = chalk.gray('[DEBUG]');
      break;
    case 'info':
      prefix = chalk.blue('[INFO]');
      break;
    case 'warn':
      prefix = chalk.yellow('[WARN]');
      break;
    case 'error':
      prefix = chalk.red('[ERROR]');
      break;
    case 'success':
      prefix = chalk.green('[OK]');
      break;
  }

  let output = `${prefix} ${message}`;

  if (details && Object.keys(details).length > 0) {
    const detailStr = Object.entries(details)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');
    output += ` ${chalk.gray(detailStr)}`;
  }

  return output;
}

export function debug(message: string, details?: Record<string, unknown>): void {
  if (verboseMode) {
    console.log(formatMessage('debug', message, details));
  }
}

export function info(message: string, details?: Record<string, unknown>): void {
  console.log(formatMessage('info', message, details));
}

export function warn(message: string, details?: Record<string, unknown>): void {
  console.log(formatMessage('warn', message, details));
}

export function error(message: string, details?: Record<string, unknown>): void {
  console.error(formatMessage('error', message, details));
}

export function success(message: string, details?: Record<string, unknown>): void {
  console.log(formatMessage('success', message, details));
}

/**
 * Log a section header
 */
export function section(title: string): void {
  console.log();
  console.log(chalk.bold.cyan(`=== ${title} ===`));
}

/**
 * Log a subsection header
 */
export function subsection(title: string): void {
  console.log(chalk.cyan(`--- ${title} ---`));
}

/**
 * Log a list item
 */
export function listItem(item: string, indent = 0): void {
  const indentStr = '  '.repeat(indent);
  console.log(`${indentStr}${chalk.gray('•')} ${item}`);
}

/**
 * Log a key-value pair
 */
export function keyValue(key: string, value: string | number | boolean | undefined, indent = 0): void {
  const indentStr = '  '.repeat(indent);
  const displayValue = value === undefined ? chalk.gray('(not set)') : String(value);
  console.log(`${indentStr}${chalk.gray(key + ':')} ${displayValue}`);
}

/**
 * Log a table
 */
export function table(headers: string[], rows: string[][]): void {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxDataWidth = Math.max(...rows.map(row => (row[i] || '').length));
    return Math.max(h.length, maxDataWidth);
  });

  // Print header
  const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
  console.log(chalk.bold(headerRow));
  console.log(widths.map(w => '-'.repeat(w)).join('-+-'));

  // Print rows
  for (const row of rows) {
    const rowStr = row.map((cell, i) => (cell || '').padEnd(widths[i])).join(' | ');
    console.log(rowStr);
  }
}

/**
 * Create a progress indicator
 */
export function progress(current: number, total: number, label: string): void {
  const percent = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
  process.stdout.write(`\r${chalk.gray('[')}${chalk.cyan(bar)}${chalk.gray(']')} ${percent}% ${label}`);

  if (current === total) {
    console.log(); // New line when complete
  }
}

/**
 * Logger object for convenience
 */
export const logger = {
  debug,
  info,
  warn,
  error,
  success,
  section,
  subsection,
  listItem,
  keyValue,
  table,
  progress,
  setVerbose,
  isVerbose,
};
