/**
 * Update-specific report generation and terminal diff formatting
 *
 * Generates UpdateReport instances conforming to the OperationReport discriminated union.
 * Report saving is handled by the generalized saveOperationReport() in report.ts.
 */

import type { EntityDiff, DiffSummary } from '../config/update-types.js';
import type { UpdateReport, Metadata } from '../config/types.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

/**
 * Generate an UpdateReport from diffs and summary.
 *
 * Produces a report compatible with saveOperationReport() and the OperationReport
 * discriminated union. Entities with zero changes appear as "skipped" (not omitted).
 */
export function generateUpdateReport(
  diffs: EntityDiff[],
  summary: DiffSummary,
  metadata: Metadata,
  network: string,
  dryRun: boolean
): UpdateReport {
  const entityDetails: Array<{ name: string; id: string; changes: string[] }> = [];

  for (const diff of diffs) {
    const changes: string[] = [];

    if (diff.status === 'skipped') {
      changes.push('(no changes)');
    } else {
      // Scalar changes
      for (const sc of diff.scalarChanges) {
        if (sc.type === 'set') {
          changes.push(
            `Set '${sc.propertyName}' = '${sc.newValue}' (was '${sc.oldValue ?? '(not set)'}')`
          );
        }
      }

      // Relation additions
      for (const rc of diff.relationChanges) {
        for (const rel of rc.toAdd) {
          changes.push(`Add relation '${rc.propertyName}' -> '${rel.entityName}'`);
        }
        for (const rel of rc.toRemove) {
          changes.push(`Remove relation '${rc.propertyName}' -> '${rel.entityName}'`);
        }
      }
    }

    entityDetails.push({
      name: diff.entityName,
      id: diff.entityId,
      changes,
    });
  }

  return {
    operationType: 'update',
    timestamp: new Date().toISOString(),
    success: true,
    network,
    spaceId: metadata.spaceId,
    dryRun,
    summary: {
      entitiesUpdated: summary.entitiesWithChanges,
      propertiesUpdated: summary.totalScalarChanges,
      relationsAdded: summary.totalRelationsAdded,
      relationsRemoved: summary.totalRelationsRemoved,
    },
    details: {
      entities: entityDetails,
    },
  };
}

/**
 * Print per-entity diff output to the terminal.
 *
 * - If quiet: only print summary counts (skip per-entity details).
 * - Otherwise: per-entity color-coded diff lines.
 * - If verbose: also print unchanged relation targets.
 */
export function printDiffOutput(
  diffs: EntityDiff[],
  summary: DiffSummary,
  options: { verbose: boolean; quiet: boolean }
): void {
  if (!options.quiet) {
    for (const diff of diffs) {
      // Entity header
      const statusTag =
        diff.status === 'updated'
          ? chalk.yellow('[UPDATED]')
          : chalk.gray('[SKIPPED]');

      console.log(`\n  ${statusTag} ${chalk.bold(diff.entityName)}`);

      if (diff.status === 'skipped') {
        console.log(chalk.gray('    (no changes)'));
        continue;
      }

      // Scalar changes
      for (const sc of diff.scalarChanges) {
        if (sc.type === 'set') {
          console.log(
            `    SET ${chalk.yellow(sc.propertyName)}: ${chalk.red(`"${sc.oldValue ?? '(not set)'}"`)} -> ${chalk.green(`"${sc.newValue}"`)}`
          );
        }
      }

      // Relation changes
      for (const rc of diff.relationChanges) {
        for (const rel of rc.toAdd) {
          console.log(
            chalk.green(`    ADD ${rc.propertyName} -> ${rel.entityName}`)
          );
        }
        for (const rel of rc.toRemove) {
          console.log(
            chalk.red(`    DEL ${rc.propertyName} -> ${rel.entityName}`)
          );
        }

        // Verbose: show unchanged relation targets
        if (options.verbose) {
          for (const rel of rc.unchanged) {
            console.log(
              chalk.gray(`    ~   ${rc.propertyName} -> ${rel.entityName}`)
            );
          }
        }
      }
    }

    console.log();
    console.log(chalk.gray('  ' + '-'.repeat(50)));
  }

  // Summary counts (always printed, even in quiet mode)
  console.log();
  logger.subsection('Diff Summary');
  logger.keyValue('Entities with changes', summary.entitiesWithChanges);
  logger.keyValue('Entities skipped', summary.entitiesSkipped);
  logger.keyValue('Properties to set', summary.totalScalarChanges);
  logger.keyValue('Relations to add', summary.totalRelationsAdded);
  logger.keyValue('Relations to remove', summary.totalRelationsRemoved);
}

/**
 * Print final summary after publish.
 */
export function printUpdateSummary(
  summary: DiffSummary,
  publishResult?: { success: boolean; transactionHash?: string }
): void {
  logger.section('Update Summary');

  logger.keyValue('Entities updated', summary.entitiesWithChanges);
  logger.keyValue('Entities skipped', summary.entitiesSkipped);
  logger.keyValue('Properties set', summary.totalScalarChanges);
  logger.keyValue('Relations added', summary.totalRelationsAdded);
  logger.keyValue('Relations removed', summary.totalRelationsRemoved);

  if (publishResult) {
    console.log();
    logger.keyValue('Publish status', publishResult.success ? 'SUCCESS' : 'FAILED');
    if (publishResult.transactionHash) {
      logger.keyValue('Transaction hash', publishResult.transactionHash);
    }
  }
}
