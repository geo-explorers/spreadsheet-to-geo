/**
 * Merge-specific report generation and terminal diff formatting
 *
 * Generates MergeReport instances conforming to the OperationReport discriminated union.
 * Report saving is handled by the generalized saveOperationReport() in report.ts.
 */

import type { MergePairDiff, MergeSummary } from '../config/merge-types.js';
import type { MergeReport } from '../config/types.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

/**
 * Generate a MergeReport from diffs and summary.
 *
 * Produces a report compatible with saveOperationReport() and the OperationReport
 * discriminated union.
 */
export function generateMergeReport(
  diffs: MergePairDiff[],
  summary: MergeSummary,
  spaceId: string,
  network: string,
  dryRun: boolean
): MergeReport {
  return {
    operationType: 'merge',
    timestamp: new Date().toISOString(),
    success: true,
    network,
    spaceId,
    dryRun,
    summary: {
      pairsMerged: summary.totalPairs,
      propertiesTransferred: summary.propertiesTransferred,
      relationsRepointed: summary.relationsRepointed,
      conflictsSkipped: summary.conflictsDetected,
      mergersDeleted: summary.mergersDeleted,
    },
    details: {
      pairs: diffs.map(d => ({
        keeperName: d.keeperName,
        keeperId: d.keeperId,
        mergerName: d.mergerName,
        mergerId: d.mergerId,
        propertiesTransferred: d.propertiesToTransfer.length,
        relationsRepointed: d.relationsToRepoint.length,
        conflicts: d.conflicts.length,
      })),
    },
  };
}

/**
 * Print per-pair colored diff output to the terminal.
 *
 * Shows property transfers, conflicts, relation re-points, type transfers,
 * and merger deletion for each pair. Verbose mode shows skipped relations.
 */
export function printMergeDiffOutput(
  diffs: MergePairDiff[],
  summary: MergeSummary,
  options: { verbose: boolean }
): void {
  for (const diff of diffs) {
    // Pair header
    console.log();
    console.log(`  ${chalk.yellow('[MERGE]')} ${chalk.bold(diff.keeperName)} ${chalk.gray('<-')} ${chalk.bold(diff.mergerName)}`);

    // Properties to transfer
    for (const prop of diff.propertiesToTransfer) {
      console.log(
        chalk.green(`    TRANSFER ${prop.propertyName} = "${prop.mergerValue}"`)
      );
    }

    // Conflicts (keeper wins)
    for (const conflict of diff.conflicts) {
      console.log(
        `    CONFLICT ${conflict.propertyName}: ${chalk.red(`keeper="${conflict.keeperValue}"`)} / ${chalk.yellow(`merger="${conflict.mergerValue}"`)}`
      );
    }

    // Relations to re-point
    for (const rel of diff.relationsToRepoint) {
      console.log(
        chalk.green(`    REPOINT [${rel.direction}] ${rel.typeId} -> ${rel.otherEntityName}`)
      );
    }

    // Relations skipped (verbose only)
    if (options.verbose) {
      for (const rel of diff.relationsSkipped) {
        console.log(
          chalk.gray(`    ~ SKIP [${rel.direction}] ${rel.typeId} -> ${rel.otherEntityName}`)
        );
      }
    }

    // Types to transfer (show type ID since we only have IDs)
    for (const typeId of diff.typesToTransfer) {
      console.log(chalk.green(`    ADD TYPE ${typeId}`));
    }

    // Merger deletion
    console.log(chalk.red(`    DELETE ${diff.mergerName} (${diff.mergerId})`));

    // Separator between pairs
    console.log(chalk.gray('  ' + '-'.repeat(50)));
  }

  // Summary section
  console.log();
  logger.subsection('Merge Summary');
  logger.keyValue('Pairs to merge', summary.totalPairs);
  logger.keyValue('Properties to transfer', summary.propertiesTransferred);
  logger.keyValue('Conflicts (skipped)', summary.conflictsDetected);
  logger.keyValue('Relations to re-point', summary.relationsRepointed);
  logger.keyValue('Relations skipped (dupes)', summary.relationsSkipped);
  logger.keyValue('Types to transfer', summary.typesTransferred);
  logger.keyValue('Mergers to delete', summary.mergersDeleted);
}

/**
 * Print final summary after all publishes complete.
 *
 * Shows aggregate merge counts and per-pair publish results if available.
 */
export function printMergeSummary(
  summary: MergeSummary,
  publishResults?: Array<{ success: boolean; transactionHash?: string }>
): void {
  logger.section('Merge Summary');

  logger.keyValue('Pairs merged', summary.totalPairs);
  logger.keyValue('Properties transferred', summary.propertiesTransferred);
  logger.keyValue('Relations re-pointed', summary.relationsRepointed);
  logger.keyValue('Conflicts skipped', summary.conflictsDetected);
  logger.keyValue('Mergers deleted', summary.mergersDeleted);

  if (publishResults) {
    const successCount = publishResults.filter(r => r.success).length;
    const failureCount = publishResults.filter(r => !r.success).length;

    console.log();
    logger.keyValue('Successful publishes', successCount);
    if (failureCount > 0) {
      logger.keyValue('Failed publishes', failureCount);
    }

    for (let i = 0; i < publishResults.length; i++) {
      const result = publishResults[i];
      if (result.transactionHash) {
        logger.keyValue(`  Pair ${i + 1} tx`, result.transactionHash);
      }
    }
  }
}
