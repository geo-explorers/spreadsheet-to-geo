/**
 * Delete command handler - Delete entities listed in an Excel spreadsheet
 *
 * Full delete pipeline: parse entity IDs -> validate existence -> fetch details ->
 * snapshot -> build ops -> dry-run OR (confirm -> publish -> report)
 *
 * Safety features: confirmation prompt (--force to skip), dry-run preview,
 * pre-deletion snapshot to .snapshots/, fail-stop with remaining-entities CSV.
 *
 * CRITICAL: Graph.deleteEntity() is NOT used -- the Indexer ignores it.
 * Instead we use deleteRelation + updateEntity({ unset }) to blank entities.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import { parseEntityIds } from '../parsers/entity-id-parser.js';
import { fetchEntityDetails } from '../api/geo-client.js';
import type { EntityDetails } from '../api/geo-client.js';
import { buildDeleteOps } from '../processors/delete-builder.js';
import { publishToGeo, validatePrivateKey } from '../publishers/publisher.js';
import { saveOperationReport } from '../publishers/report.js';
import { logger, setVerbose } from '../utils/logger.js';
import type { DeleteOptions } from '../config/delete-types.js';
import type { DeleteReport, Metadata, PublishOptions } from '../config/types.js';
import type { OperationsBatch, BatchSummary } from '../config/upsert-types.js';

/**
 * Resolve network from --network flag, GEO_NETWORK env var, or default to TESTNET.
 * Flag takes precedence over env var, env var over default.
 */
function resolveNetwork(flagValue?: string): 'TESTNET' | 'MAINNET' {
  const network = (flagValue || process.env.GEO_NETWORK || 'TESTNET').toUpperCase();
  if (network !== 'TESTNET' && network !== 'MAINNET') {
    throw new Error(`Invalid network: "${network}". Must be TESTNET or MAINNET.`);
  }
  return network as 'TESTNET' | 'MAINNET';
}

/**
 * Interactive confirmation prompt for entity deletion.
 * Shows entity count and first 5 entity names as preview.
 * Default is N (abort) -- requires explicit 'y' to proceed.
 * Throws if stdin is not a TTY -- use --force for CI/scripts.
 */
async function confirmDeletion(entities: EntityDetails[]): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Interactive confirmation required. Use --force to skip confirmation in non-interactive environments.'
    );
  }

  const preview = entities.slice(0, 5).map(e => e.name || e.id).join(', ');
  const suffix = entities.length > 5 ? '...' : '';
  const message = [
    `About to delete ${entities.length} entities. This will remove all properties, relations, and type assignments.`,
    `Entities: ${preview}${suffix}`,
    `Proceed? (y/N): `,
  ].join('\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Save pre-deletion snapshot of entity data to .snapshots/ directory.
 * Creates the directory if it doesn't exist. Uses timestamped filename.
 * Returns the filepath for error messages.
 */
function saveSnapshot(entities: EntityDetails[]): string {
  const snapshotsDir = path.resolve('.snapshots');
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = `delete-snapshot-${timestamp}.json`;
  const filepath = path.join(snapshotsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(entities, null, 2));
  logger.success(`Pre-deletion snapshot saved: ${filepath}`);

  return filepath;
}

/**
 * Write remaining (unprocessed) entity IDs to a CSV file on failure.
 * Header row: entity_id, one ID per line.
 * Returns the filepath for logging.
 */
function writeRemainingCsv(entityIds: string[], outputDir: string): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = `remaining-entities-${timestamp}.csv`;
  const filepath = path.join(outputDir, filename);

  const content = ['entity_id', ...entityIds].join('\n');
  fs.writeFileSync(filepath, content);
  logger.info(`Remaining entities written to: ${filepath}`);

  return filepath;
}

/**
 * Delete command handler - main pipeline.
 *
 * Pipeline: parse -> validate existence -> fetch details -> snapshot ->
 *           build ops -> dry-run OR (confirm -> publish -> report)
 */
export async function deleteCommand(file: string, options: DeleteOptions): Promise<void> {
  setVerbose(options.verbose);

  const network = resolveNetwork(options.network);

  logger.section('Geo Publish - Delete');
  logger.keyValue('File', file);
  logger.keyValue('Network', network);
  logger.keyValue('Dry Run', options.dryRun.toString());
  logger.keyValue('Force', options.force.toString());

  let snapshotPath: string | undefined;

  try {
    // Step a: Validate file exists
    if (!fs.existsSync(file)) {
      logger.error(`File not found: ${file}`);
      process.exit(1);
    }

    const filePath = path.resolve(file);

    // Step b: Parse entity IDs from Excel
    logger.section('Parsing Entity IDs');
    const { ids, spaceId: csvSpaceId, errors: parseErrors } = parseEntityIds(filePath, 'Entities to delete');

    if (parseErrors.length > 0) {
      logger.error('Entity ID parsing errors:');
      for (const err of parseErrors) {
        logger.listItem(err);
      }
      process.exit(1);
    }

    if (ids.length === 0) {
      logger.error('No entity IDs found in the spreadsheet.');
      process.exit(1);
    }

    logger.success(`Parsed ${ids.length} entity IDs`);

    // Resolve space ID: CLI flag overrides CSV, but conflict = error
    let spaceId: string;
    if (options.space && csvSpaceId && options.space !== csvSpaceId) {
      logger.error(`Space ID mismatch: --space flag "${options.space}" differs from CSV Space ID column "${csvSpaceId}"`);
      process.exit(1);
    }
    if (options.space) {
      spaceId = options.space;
    } else if (csvSpaceId) {
      spaceId = csvSpaceId;
    } else {
      logger.error('No space ID found. Provide --space flag or include a "Space ID" column in the CSV.');
      process.exit(1);
    }

    logger.keyValue('Space', spaceId);

    // Step c: Validate ALL entity IDs exist (fail-fast: DEL-02)
    logger.section('Validating Entities');
    const entityDetailsList: EntityDetails[] = [];
    const invalidIds: string[] = [];
    const batchSize = 5;

    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((id) => fetchEntityDetails(id, spaceId, network))
      );

      for (let j = 0; j < batch.length; j++) {
        const result = results[j];
        if (result === null) {
          invalidIds.push(batch[j]);
        } else {
          entityDetailsList.push(result);
        }
      }

      const processed = Math.min(i + batchSize, ids.length);
      logger.progress(processed, ids.length, `Validating entities ${processed}/${ids.length}`);
    }

    if (invalidIds.length > 0) {
      logger.error(`${invalidIds.length} entity ID(s) not found in space ${spaceId}:`);
      for (const id of invalidIds) {
        logger.listItem(id);
      }
      logger.error('All entity IDs must exist. Aborting.');
      process.exit(1);
    }

    logger.success(`All ${entityDetailsList.length} entities validated`);

    // Step d: Dry-run branch (DEL-08)
    if (options.dryRun) {
      logger.section('Dry Run Preview');
      logger.table(
        ['Entity Name', 'Properties', 'Relations', 'Backlinks'],
        entityDetailsList.map((e) => [
          e.name || '(unnamed)',
          String(new Set(e.values.map((v) => v.propertyId)).size),
          String(e.relations.length),
          String(e.backlinks.length),
        ])
      );

      // Build ops to get summary counts
      const deleteBatch = buildDeleteOps(entityDetailsList);

      const report: DeleteReport = {
        operationType: 'delete',
        timestamp: new Date().toISOString(),
        success: true,
        network,
        spaceId: spaceId,
        dryRun: true,
        summary: {
          entitiesDeleted: entityDetailsList.length,
          relationsDeleted: deleteBatch.summary.relationsToDelete + deleteBatch.summary.backlinksToDelete,
          triplesDeleted: deleteBatch.ops.length,
        },
        details: {
          entities: entityDetailsList.map((e) => ({ name: e.name || '(unnamed)', id: e.id })),
          relations: [],
        },
      };

      saveOperationReport(report, options.output);
      logger.section('Dry Run Complete');
      logger.info('No changes were made. Remove --dry-run flag to execute.');
      process.exit(0);
    }

    // Step e: Save pre-deletion snapshot (DEL-09)
    logger.section('Saving Pre-Deletion Snapshot');
    snapshotPath = saveSnapshot(entityDetailsList);

    // Step f: Build delete operations
    logger.section('Building Delete Operations');
    const deleteBatch = buildDeleteOps(entityDetailsList);

    logger.keyValue('Entities', deleteBatch.summary.entitiesProcessed);
    logger.keyValue('Relations to delete', deleteBatch.summary.relationsToDelete);
    logger.keyValue('Backlinks to delete', deleteBatch.summary.backlinksToDelete);
    logger.keyValue('Properties to unset', deleteBatch.summary.propertiesToUnset);
    logger.keyValue('Total operations', deleteBatch.ops.length);

    if (deleteBatch.ops.length === 0) {
      logger.warn('No operations to publish — entities have no properties, relations, or backlinks to remove.');
      logger.info('These entities may already be blank or were never populated.');
      process.exit(0);
    }

    // Step g: Confirm deletion (unless --force)
    if (!options.force) {
      const confirmed = await confirmDeletion(entityDetailsList);
      if (!confirmed) {
        logger.info('Delete cancelled by user.');
        process.exit(0);
      }
    }

    // Step h: Validate PRIVATE_KEY
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

    // Step i: Publish
    logger.section('Publishing Delete Operations');

    const metadata: Metadata = {
      spaceId: spaceId,
      spaceType: 'Personal',
      author: options.author,
    };

    // Create OperationsBatch-compatible object for the publisher
    const emptyBatchSummary: BatchSummary = {
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

    const publishBatch: OperationsBatch = {
      ops: deleteBatch.ops,
      summary: emptyBatchSummary,
    };

    const publishOptions: PublishOptions = {
      network,
      dryRun: false,
      verbose: options.verbose,
      outputDir: options.output,
    };

    const result = await publishToGeo(publishBatch, metadata, privateKey, publishOptions);

    if (!result.success) {
      throw new Error(result.error || 'Publish failed with unknown error');
    }

    // Step j: Generate and save report
    const report: DeleteReport = {
      operationType: 'delete',
      timestamp: new Date().toISOString(),
      success: true,
      network,
      spaceId: spaceId,
      dryRun: false,
      transactionHash: result.transactionHash,
      summary: {
        entitiesDeleted: deleteBatch.summary.entitiesProcessed,
        relationsDeleted: deleteBatch.summary.relationsToDelete + deleteBatch.summary.backlinksToDelete,
        triplesDeleted: deleteBatch.ops.length,
      },
      details: {
        entities: entityDetailsList.map((e) => ({ name: e.name || '(unnamed)', id: e.id })),
        relations: [],
      },
    };

    saveOperationReport(report, options.output);

    // Step k: Print final summary
    logger.section('Delete Complete');
    logger.keyValue('Entities deleted', deleteBatch.summary.entitiesProcessed);
    logger.keyValue('Relations removed', deleteBatch.summary.relationsToDelete + deleteBatch.summary.backlinksToDelete);
    logger.keyValue('Properties unset', deleteBatch.summary.propertiesToUnset);
    if (result.transactionHash) {
      const explorerUrl =
        network === 'TESTNET'
          ? `https://testnet.geobrowser.io/tx/${result.transactionHash}`
          : `https://geobrowser.io/tx/${result.transactionHash}`;
      logger.info(`View transaction: ${explorerUrl}`);
    }
    logger.success('Entities deleted successfully!');

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Delete failed: ${message}`);

    if (snapshotPath) {
      logger.info(`Pre-deletion snapshot available at: ${snapshotPath}`);
    }

    // Write remaining entities CSV for re-run
    // All entity IDs that were parsed but may not have been processed
    try {
      const filePath = path.resolve(file);
      const { ids } = parseEntityIds(filePath, 'Entities to delete');
      if (ids.length > 0) {
        writeRemainingCsv(ids, options.output);
      }
    } catch {
      // If we can't even re-parse, just log the error
      logger.warn('Could not write remaining-entities CSV');
    }

    if (options.verbose && error instanceof Error && error.stack) {
      console.error(error.stack);
    }

    process.exit(1);
  }
}
