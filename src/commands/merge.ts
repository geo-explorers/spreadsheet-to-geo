/**
 * Merge command handler - Merge duplicate entities from an Excel template
 *
 * Four-phase pipeline (per CONTEXT.md locked decision):
 *   1. VALIDATE: Parse merge template, resolve all entity names upfront
 *   2. DIFF: Fetch entity details, compute per-pair diffs
 *   3. CONFIRM: Show diff, prompt for confirmation (unless --yes)
 *   4. PUBLISH: Build ops per pair, publish each pair atomically, report
 *
 * --dry-run stops cleanly after DIFF phase (validate + diff both ran, nothing writes).
 * Each merge pair is published as a separate atomic transaction via publishToGeo().
 */

import * as fs from 'fs';
import * as path from 'path';

import { parseMergeTemplate } from '../parsers/merge-parser.js';
import { fetchEntityDetails, fetchEntityNamesByIds } from '../api/geo-client.js';
import type { EntityDetails } from '../api/geo-client.js';
import { computeMergePairDiff, buildMergeOps } from '../processors/merge-diff.js';
import { resolveNetwork, confirmAction } from '../utils/cli-helpers.js';
import {
  generateMergeReport,
  printMergeDiffOutput,
  printMergeSummary,
} from '../publishers/merge-report.js';
import { saveOperationReport } from '../publishers/report.js';
import { validatePrivateKey, publishToGeo } from '../publishers/publisher.js';
import { logger, setVerbose } from '../utils/logger.js';
import type { MergeOptions, MergePairDiff, MergeSummary } from '../config/merge-types.js';
import type { Metadata, PublishOptions } from '../config/types.js';
import type { OperationsBatch, BatchSummary } from '../config/upsert-types.js';

/**
 * Save pre-merge snapshot of keeper and merger entity states to .snapshots/.
 * Creates the directory if it doesn't exist. Uses timestamped filename.
 * Returns the filepath for error messages.
 */
function saveSnapshot(
  snapshotData: Array<{ keeper: EntityDetails | null; merger: EntityDetails | null }>
): string {
  const snapshotsDir = path.resolve('.snapshots');
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = `merge-snapshot-${timestamp}.json`;
  const filepath = path.join(snapshotsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(snapshotData, null, 2));
  logger.success(`Pre-merge snapshot saved: ${filepath}`);

  return filepath;
}

export async function mergeCommand(file: string, options: MergeOptions): Promise<void> {
  // Preamble
  setVerbose(options.verbose);

  const network = resolveNetwork(options.network);

  logger.section('Geo Publish - Merge');
  logger.keyValue('File', file);
  logger.keyValue('Network', network);
  logger.keyValue('Dry Run', options.dryRun.toString());

  let snapshotPath: string | undefined;

  try {
    // Validate file exists
    if (!fs.existsSync(file)) {
      logger.error(`File not found: ${file}`);
      process.exit(1);
    }

    const filePath = path.resolve(file);

    // ========================================================================
    // PHASE 1: VALIDATE
    // ========================================================================
    logger.section('Phase 1: Validate');

    // Parse template
    logger.info('Parsing merge template...');
    const { pairs, spaceId, spaceType, author, operationType, errors } = parseMergeTemplate(filePath);

    if (errors.length > 0) {
      logger.error('Merge template parsing errors:');
      for (const err of errors) {
        logger.listItem(err);
      }
      process.exit(1);
    }

    if (pairs.length === 0) {
      logger.error('No merge pairs found in the template.');
      process.exit(1);
    }

    // Warn if operationType is not MERGE
    if (operationType && operationType !== 'MERGE') {
      logger.warn(
        `Template Operation type is '${operationType}' but running merge command. Proceeding.`
      );
    }

    logger.success(`Parsed ${pairs.length} merge pair(s) from template`);
    logger.keyValue('Space', spaceId);

    // Log pair details
    for (const pair of pairs) {
      const keeperLabel = pair.keeperName ? `${pair.keeperName} (${pair.keeperId})` : pair.keeperId;
      const mergerLabel = pair.mergerName ? `${pair.mergerName} (${pair.mergerId})` : pair.mergerId;
      logger.info(`  ${keeperLabel} <- ${mergerLabel}`);
    }

    // ========================================================================
    // PHASE 2: DIFF
    // ========================================================================
    logger.section('Phase 2: Diff');

    const keeperDetailsMap = new Map<string, EntityDetails>();
    const mergerDetailsMap = new Map<string, EntityDetails>();

    // Fetch all entity details by ID (no name resolution needed)
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const keeperLabel = pair.keeperName || pair.keeperId;
      const mergerLabel = pair.mergerName || pair.mergerId;
      logger.info(`Fetching pair ${i + 1}/${pairs.length}: ${keeperLabel} <- ${mergerLabel}`);

      const keeperDetails = await fetchEntityDetails(pair.keeperId, spaceId, network);
      const mergerDetails = await fetchEntityDetails(pair.mergerId, spaceId, network);

      if (!keeperDetails) {
        logger.error(`Keeper entity ${pair.keeperId} not found in space ${spaceId}`);
        process.exit(1);
      }

      if (!mergerDetails) {
        logger.error(`Merger entity ${pair.mergerId} not found in space ${spaceId}`);
        process.exit(1);
      }

      // Cross-validate names if provided in template
      if (pair.keeperName && keeperDetails.name && pair.keeperName !== keeperDetails.name) {
        logger.warn(
          `Keeper name mismatch at row ${pair.rowNumber}: template="${pair.keeperName}" vs Geo="${keeperDetails.name}"`
        );
      }
      if (pair.mergerName && mergerDetails.name && pair.mergerName !== mergerDetails.name) {
        logger.warn(
          `Merger name mismatch at row ${pair.rowNumber}: template="${pair.mergerName}" vs Geo="${mergerDetails.name}"`
        );
      }

      keeperDetailsMap.set(keeperDetails.id, keeperDetails);
      mergerDetailsMap.set(mergerDetails.id, mergerDetails);
    }

    logger.success(`All ${pairs.length} pair(s) fetched successfully`);

    // Collect all unique IDs (property IDs, type IDs, relation type IDs) for name resolution
    const allEntityIds = new Set<string>();
    for (const details of [...keeperDetailsMap.values(), ...mergerDetailsMap.values()]) {
      for (const val of details.values) allEntityIds.add(val.propertyId);
      for (const typeId of details.typeIds) allEntityIds.add(typeId);
      for (const rel of details.relations) allEntityIds.add(rel.typeId);
      for (const bl of details.backlinks) allEntityIds.add(bl.typeId);
    }

    // Batch-resolve IDs to human-readable names
    logger.info(`Resolving ${allEntityIds.size} property/type names...`);
    const nameMap = await fetchEntityNamesByIds([...allEntityIds], network);
    logger.success(`Resolved ${nameMap.size}/${allEntityIds.size} names`);

    // Compute diffs with name resolution
    const diffs: MergePairDiff[] = [];
    for (const pair of pairs) {
      const keeperDetails = keeperDetailsMap.get(pair.keeperId)!;
      const mergerDetails = mergerDetailsMap.get(pair.mergerId)!;

      const diff = computeMergePairDiff(keeperDetails, mergerDetails, nameMap);
      diffs.push(diff);
    }

    // Compute MergeSummary
    const summary: MergeSummary = {
      totalPairs: diffs.length,
      propertiesTransferred: diffs.reduce((sum, d) => sum + d.propertiesToTransfer.length, 0),
      conflictsDetected: diffs.reduce((sum, d) => sum + d.conflicts.length, 0),
      relationsRepointed: diffs.reduce((sum, d) => sum + d.relationsToRepoint.length, 0),
      relationsSkipped: diffs.reduce((sum, d) => sum + d.relationsSkipped.length, 0),
      typesTransferred: diffs.reduce((sum, d) => sum + d.typesToTransfer.length, 0),
      mergersDeleted: diffs.length,
    };

    // --dry-run gate: stop after diff phase
    if (options.dryRun) {
      printMergeDiffOutput(diffs, summary, { verbose: options.verbose });
      const report = generateMergeReport(diffs, summary, spaceId, network, true);
      saveOperationReport(report, options.output);
      logger.info('Dry run complete -- no changes were made.');
      process.exit(0);
    }

    // ========================================================================
    // PHASE 3: CONFIRM
    // ========================================================================
    logger.section('Phase 3: Confirm');

    printMergeDiffOutput(diffs, summary, { verbose: options.verbose });

    // Check if any work to do
    if (
      summary.propertiesTransferred === 0 &&
      summary.relationsRepointed === 0 &&
      summary.typesTransferred === 0 &&
      summary.mergersDeleted === 0
    ) {
      logger.info('No changes to merge -- nothing to publish.');
      process.exit(0);
    }

    // Prompt for confirmation
    if (!options.yes) {
      const confirmed = await confirmAction(
        'Merge these entities? This action cannot be undone.'
      );
      if (!confirmed) {
        logger.info('Merge cancelled by user.');
        process.exit(0);
      }
    }

    // ========================================================================
    // PHASE 4: PUBLISH
    // ========================================================================
    logger.section('Phase 4: Publish');

    // Check for private key
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      logger.error('PRIVATE_KEY environment variable is required');
      logger.info('Set it in .env file or export it:');
      logger.info('  export PRIVATE_KEY=0x...');
      process.exit(1);
    }

    if (!validatePrivateKey(privateKey)) {
      logger.error('Invalid PRIVATE_KEY format');
      logger.info('Private key must be 66 characters starting with 0x');
      process.exit(1);
    }

    // Save pre-merge snapshot of ALL keeper and merger entity details
    logger.info('Saving pre-merge snapshot...');
    const snapshotData = diffs.map(d => ({
      keeper: keeperDetailsMap.get(d.keeperId) ?? null,
      merger: mergerDetailsMap.get(d.mergerId) ?? null,
    }));
    snapshotPath = saveSnapshot(snapshotData);

    // Per-pair atomic publishing (MERGE-06, CONTEXT.md locked)
    const publishResults: Array<{ success: boolean; transactionHash?: string; error?: string }> = [];

    // NOTE: Multi-way merges use pre-computed diffs. For maximum correctness
    // with many merger-to-one-keeper scenarios, consider re-fetching keeper state
    // between publishes. Current approach is sufficient for typical use (tens of pairs).

    for (let i = 0; i < diffs.length; i++) {
      const diff = diffs[i];
      logger.info(`Publishing pair ${i + 1}/${diffs.length}: ${diff.keeperName} <- ${diff.mergerName}`);

      // Build ops for this pair
      const ops = buildMergeOps(diff, diff.keeperId);

      if (ops.length === 0) {
        logger.warn(`Pair ${i + 1}: No operations to publish (skipping).`);
        publishResults.push({ success: true });
        continue;
      }

      // Build OperationsBatch with zeroed BatchSummary adapter
      const batchSummary: BatchSummary = {
        typesCreated: 0,
        typesLinked: 0,
        propertiesCreated: 0,
        propertiesLinked: 0,
        entitiesCreated: 0,
        entitiesLinked: 0,
        relationsCreated: 0,
        imagesUploaded: 0,
        multiTypeEntities: [],
      };

      const batch: OperationsBatch = {
        ops,
        summary: batchSummary,
      };

      const metadata: Metadata = {
        spaceId,
        spaceType: (spaceType === 'DAO' ? 'DAO' : 'Personal') as 'Personal' | 'DAO',
        author: author || undefined,
      };

      const publishOptions: PublishOptions = {
        network,
        dryRun: false,
        verbose: options.verbose,
        outputDir: options.output,
      };

      const result = await publishToGeo(batch, metadata, privateKey, publishOptions);
      publishResults.push(result);

      if (result.success) {
        logger.success(`Pair ${i + 1} published successfully`);
        if (result.transactionHash) {
          logger.keyValue('Transaction', result.transactionHash);
        }
      } else {
        // Log error but continue to next pair -- pairs already published
        // are already committed on-chain
        logger.error(`Pair ${i + 1} publish failed: ${result.error || 'Unknown error'}`);
      }
    }

    // Generate and save report for live run
    const report = generateMergeReport(diffs, summary, spaceId, network, false);
    const successResults = publishResults.filter(r => r.success);
    if (successResults.length > 0) {
      report.success = true;
      // Use first successful transaction hash for report
      const firstTx = publishResults.find(r => r.transactionHash);
      if (firstTx?.transactionHash) {
        report.transactionHash = firstTx.transactionHash;
      }
    } else {
      report.success = false;
      report.error = 'All pair publishes failed';
    }
    saveOperationReport(report, options.output);

    // Print final summary
    printMergeSummary(summary, publishResults);

    // Log completion section with transaction links
    const successCount = publishResults.filter(r => r.success).length;
    const failureCount = publishResults.filter(r => !r.success).length;

    if (failureCount === 0) {
      logger.section('Merge Complete');
      logger.success('All pairs merged successfully!');

      for (const result of publishResults) {
        if (result.transactionHash) {
          const explorerUrl =
            network === 'TESTNET'
              ? `https://testnet.geobrowser.io/tx/${result.transactionHash}`
              : `https://geobrowser.io/tx/${result.transactionHash}`;
          logger.info(`View transaction: ${explorerUrl}`);
        }
      }

      process.exit(0);
    } else {
      logger.section('Merge Partially Failed');
      logger.warn(`${successCount} pairs succeeded, ${failureCount} pairs failed.`);
      logger.info(`Pre-merge snapshot available at: ${snapshotPath}`);
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Unexpected error: ${message}`);

    if (snapshotPath) {
      logger.info(`Pre-merge snapshot available at: ${snapshotPath}`);
    }

    if (options.verbose && error instanceof Error && error.stack) {
      console.error(error.stack);
    }

    process.exit(1);
  }
}
