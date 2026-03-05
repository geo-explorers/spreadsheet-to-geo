/**
 * Delete-triples command handler - Delete specific relations and unset specific properties
 *
 * Full pipeline: parse Excel (Relations + Properties tabs) -> validate relation IDs ->
 * validate entity IDs -> dry-run OR (confirm -> publish -> report)
 *
 * Unlike the `delete` command (which blanks entire entities), this command targets
 * individual relations and properties by ID.
 */

import * as fs from 'fs';
import * as path from 'path';

import { parseTriplesFile } from '../parsers/triples-parser.js';
import { fetchRelationById, fetchEntityDetails } from '../api/geo-client.js';
import { buildDeleteTriplesOps } from '../processors/delete-triples-builder.js';
import { publishToGeo, validatePrivateKey } from '../publishers/publisher.js';
import { saveOperationReport } from '../publishers/report.js';
import { resolveNetwork, confirmAction } from '../utils/cli-helpers.js';
import { logger, setVerbose } from '../utils/logger.js';
import type { DeleteTriplesOptions } from '../config/delete-triples-types.js';
import type { DeleteTriplesReport, Metadata, PublishOptions } from '../config/types.js';
import type { OperationsBatch, BatchSummary } from '../config/upsert-types.js';

/**
 * Delete-triples command handler - main pipeline.
 *
 * Pipeline: parse -> validate relations -> validate entities ->
 *           dry-run OR (confirm -> publish -> report)
 */
export async function deleteTriplesCommand(file: string, options: DeleteTriplesOptions): Promise<void> {
  setVerbose(options.verbose);

  const network = resolveNetwork(options.network);

  logger.section('Geo Publish - Delete Triples');
  logger.keyValue('File', file);
  logger.keyValue('Network', network);
  logger.keyValue('Dry Run', options.dryRun.toString());
  logger.keyValue('Force', options.force.toString());

  try {
    // Step a: Validate file exists
    if (!fs.existsSync(file)) {
      logger.error(`File not found: ${file}`);
      process.exit(1);
    }

    const filePath = path.resolve(file);

    // Step b: Parse Excel file
    logger.section('Parsing Triples File');
    const parseResult = parseTriplesFile(filePath);

    if (parseResult.errors.length > 0) {
      logger.error('Parse errors:');
      for (const err of parseResult.errors) {
        logger.listItem(err);
      }
      process.exit(1);
    }

    if (parseResult.relations.length === 0 && parseResult.properties.length === 0) {
      logger.error('No operations found in the spreadsheet.');
      process.exit(1);
    }

    logger.success(`Parsed ${parseResult.relations.length} relation(s) and ${parseResult.properties.length} property unset(s)`);

    // Step c: Resolve space ID
    let spaceId: string;
    if (options.space && parseResult.spaceId && options.space !== parseResult.spaceId) {
      logger.error(`Space ID mismatch: --space flag "${options.space}" differs from spreadsheet Space ID "${parseResult.spaceId}"`);
      process.exit(1);
    }
    if (options.space) {
      spaceId = options.space;
    } else if (parseResult.spaceId) {
      spaceId = parseResult.spaceId;
    } else {
      logger.error('No space ID found. Provide --space flag or include a "Space ID" column in the spreadsheet.');
      process.exit(1);
    }

    logger.keyValue('Space', spaceId);

    // Step d: Validate relation IDs (if any)
    if (parseResult.relations.length > 0) {
      logger.section('Validating Relations');
      const invalidRelationIds: string[] = [];
      const batchSize = 5;

      for (let i = 0; i < parseResult.relations.length; i += batchSize) {
        const batch = parseResult.relations.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((entry) => fetchRelationById(entry.relationId, spaceId, network))
        );

        for (let j = 0; j < batch.length; j++) {
          if (results[j] === null) {
            invalidRelationIds.push(batch[j].relationId);
          }
        }

        const processed = Math.min(i + batchSize, parseResult.relations.length);
        logger.progress(processed, parseResult.relations.length, `Validating relations ${processed}/${parseResult.relations.length}`);
      }

      if (invalidRelationIds.length > 0) {
        logger.error(`${invalidRelationIds.length} relation ID(s) not found in space ${spaceId}:`);
        for (const id of invalidRelationIds) {
          logger.listItem(id);
        }
        logger.error('All relation IDs must exist. Aborting.');
        process.exit(1);
      }

      logger.success(`All ${parseResult.relations.length} relation(s) validated`);
    }

    // Step e: Validate entity IDs for property unsets (if any)
    if (parseResult.properties.length > 0) {
      logger.section('Validating Entities');
      const uniqueEntityIds = [...new Set(parseResult.properties.map((p) => p.entityId))];
      const invalidEntityIds: string[] = [];
      const batchSize = 5;

      for (let i = 0; i < uniqueEntityIds.length; i += batchSize) {
        const batch = uniqueEntityIds.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((id) => fetchEntityDetails(id, spaceId, network))
        );

        for (let j = 0; j < batch.length; j++) {
          if (results[j] === null) {
            invalidEntityIds.push(batch[j]);
          }
        }

        const processed = Math.min(i + batchSize, uniqueEntityIds.length);
        logger.progress(processed, uniqueEntityIds.length, `Validating entities ${processed}/${uniqueEntityIds.length}`);
      }

      if (invalidEntityIds.length > 0) {
        logger.error(`${invalidEntityIds.length} entity ID(s) not found in space ${spaceId}:`);
        for (const id of invalidEntityIds) {
          logger.listItem(id);
        }
        logger.error('All entity IDs must exist. Aborting.');
        process.exit(1);
      }

      const entityWord = uniqueEntityIds.length === 1 ? 'entity' : 'entities';
      logger.success(`All ${uniqueEntityIds.length} ${entityWord} validated`);
    }

    // Step f: Build operations
    const batch = buildDeleteTriplesOps(parseResult.relations, parseResult.properties);

    // Step g: Dry-run branch
    if (options.dryRun) {
      logger.section('Dry Run Preview');
      logger.keyValue('Relations to delete', batch.summary.relationsToDelete);
      logger.keyValue('Properties to unset', batch.summary.propertiesToUnset);
      logger.keyValue('Entities affected', batch.summary.entitiesAffected);
      logger.keyValue('Total operations', batch.ops.length);

      if (parseResult.relations.length > 0) {
        logger.table(
          ['Relation ID'],
          parseResult.relations.map((r) => [r.relationId])
        );
      }

      if (parseResult.properties.length > 0) {
        logger.table(
          ['Entity ID', 'Property ID'],
          parseResult.properties.map((p) => [p.entityId, p.propertyId])
        );
      }

      const report: DeleteTriplesReport = {
        operationType: 'delete-triples',
        timestamp: new Date().toISOString(),
        success: true,
        network,
        spaceId,
        dryRun: true,
        summary: {
          relationsDeleted: batch.summary.relationsToDelete,
          propertiesUnset: batch.summary.propertiesToUnset,
          entitiesAffected: batch.summary.entitiesAffected,
          totalOps: batch.ops.length,
        },
        details: {
          relations: parseResult.relations.map((r) => ({ relationId: r.relationId })),
          properties: parseResult.properties.map((p) => ({ entityId: p.entityId, propertyId: p.propertyId })),
        },
      };

      saveOperationReport(report, options.output);
      logger.section('Dry Run Complete');
      logger.info('No changes were made. Remove --dry-run flag to execute.');
      process.exit(0);
    }

    // Step h: Confirm (unless --force)
    if (!options.force) {
      const relCount = batch.summary.relationsToDelete;
      const propCount = batch.summary.propertiesToUnset;
      const parts: string[] = [];
      if (relCount > 0) parts.push(`${relCount} relation(s)`);
      if (propCount > 0) parts.push(`${propCount} propert${propCount === 1 ? 'y' : 'ies'}`);
      const message = `About to delete ${parts.join(' and unset ')}. This cannot be undone.`;

      const confirmed = await confirmAction(message);
      if (!confirmed) {
        logger.info('Operation cancelled.');
        process.exit(0);
      }
    }

    // Step i: Validate PRIVATE_KEY
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

    // Step j: Publish
    logger.section('Publishing Delete-Triples Operations');

    const metadata: Metadata = {
      spaceId,
      spaceType: 'Personal',
      author: options.author || spaceId,
    };

    // Create OperationsBatch-compatible object for the publisher (zeroed BatchSummary shim)
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
      ops: batch.ops,
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

    // Step k: Report
    const report: DeleteTriplesReport = {
      operationType: 'delete-triples',
      timestamp: new Date().toISOString(),
      success: true,
      network,
      spaceId,
      dryRun: false,
      transactionHash: result.transactionHash,
      summary: {
        relationsDeleted: batch.summary.relationsToDelete,
        propertiesUnset: batch.summary.propertiesToUnset,
        entitiesAffected: batch.summary.entitiesAffected,
        totalOps: batch.ops.length,
      },
      details: {
        relations: parseResult.relations.map((r) => ({ relationId: r.relationId })),
        properties: parseResult.properties.map((p) => ({ entityId: p.entityId, propertyId: p.propertyId })),
      },
    };

    saveOperationReport(report, options.output);

    // Step l: Final summary
    logger.section('Delete Triples Complete');
    logger.keyValue('Relations deleted', batch.summary.relationsToDelete);
    logger.keyValue('Properties unset', batch.summary.propertiesToUnset);
    logger.keyValue('Entities affected', batch.summary.entitiesAffected);
    if (result.transactionHash) {
      const explorerUrl =
        network === 'TESTNET'
          ? `https://testnet.geobrowser.io/tx/${result.transactionHash}`
          : `https://geobrowser.io/tx/${result.transactionHash}`;
      logger.info(`View transaction: ${explorerUrl}`);
    }
    logger.success('Delete-triples completed successfully!');

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Delete-triples failed: ${message}`);

    if (options.verbose && error instanceof Error && error.stack) {
      console.error(error.stack);
    }

    process.exit(1);
  }
}
