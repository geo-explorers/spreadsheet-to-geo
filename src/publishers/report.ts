/**
 * Generalized report save/load infrastructure
 *
 * Supports all operation types via the OperationReport discriminated union.
 * Naming convention: {operation}-{timestamp}.json or {operation}-dryrun-{timestamp}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import type { OperationReport } from '../config/types.js';
import { logger } from '../utils/logger.js';

/**
 * Save an operation report to disk.
 *
 * Filename follows the pattern:
 *   {operationType}-{timestamp}.json
 *   {operationType}-dryrun-{timestamp}.json  (when dryRun is true)
 *
 * @returns The absolute path to the saved report file.
 */
export function saveOperationReport(report: OperationReport, outputDir: string): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = report.timestamp
    .replace(/:/g, '-')
    .replace(/\./g, '-');
  const dryRunSuffix = report.dryRun ? '-dryrun' : '';
  const filename = `${report.operationType}${dryRunSuffix}-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  logger.success(`Report saved: ${filepath}`);

  return filepath;
}
