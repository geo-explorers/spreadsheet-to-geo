/**
 * Upsert command handler - Create or link entities from an Excel spreadsheet
 *
 * Extracted from the monolithic src/index.ts to support subcommand CLI architecture.
 * Full upsert pipeline: parse → validate → build entity map → build relations → build ops → publish
 */

import * as fs from 'fs';
import * as path from 'path';

import { parseExcelFile, checkRequiredTabs } from '../parsers/excel-parser.js';
import { validateSpreadsheet, formatValidationErrors } from '../parsers/validators.js';
import { buildEntityMap } from '../processors/entity-processor.js';
import { buildRelations } from '../processors/relation-builder.js';
import { buildOperationsBatch, formatBatchSummary } from '../processors/batch-builder.js';
import { publishToGeo, validatePrivateKey } from '../publishers/publisher.js';
import {
  generatePublishReport,
  saveReport,
  printReportSummary,
  printPrePublishSummary,
} from '../publishers/publish-report.js';
import { logger, setVerbose } from '../utils/logger.js';
import type { PublishOptions } from '../config/schema.js';

interface UpsertOptions {
  network?: string;
  dryRun: boolean;
  output: string;
  verbose: boolean;
  yes: boolean;
}

export async function upsertCommand(file: string, options: UpsertOptions): Promise<void> {
  // Set verbose mode
  setVerbose(options.verbose);

  logger.section('Geo Publish');
  logger.keyValue('File', file);
  logger.keyValue('Network', options.network ?? 'TESTNET');
  logger.keyValue('Dry Run', options.dryRun.toString());

  try {
    // Validate file exists
    if (!fs.existsSync(file)) {
      logger.error(`File not found: ${file}`);
      process.exit(1);
    }

    // Get absolute path
    const filePath = path.resolve(file);

    // Step 1: Check required tabs
    logger.section('Step 1: Checking Structure');
    const { missing, found } = checkRequiredTabs(filePath);

    if (missing.length > 0) {
      logger.error('Missing required tabs:');
      for (const tab of missing) {
        logger.listItem(tab);
      }
      process.exit(1);
    }

    logger.success(`All required tabs found: ${found.join(', ')}`);

    // Step 2: Parse spreadsheet
    logger.section('Step 2: Parsing Spreadsheet');
    const data = parseExcelFile(filePath);

    // Step 3: Validate data
    logger.section('Step 3: Validating Data');
    const validation = validateSpreadsheet(data);

    if (!validation.isValid) {
      logger.error('Validation failed:');
      console.log(formatValidationErrors(validation.errors));
      process.exit(1);
    }

    if (validation.errors.length > 0) {
      logger.warn('Validation passed with warnings:');
      console.log(formatValidationErrors(validation.errors));
    } else {
      logger.success('Validation passed');
    }

    // Step 4: Build entity map (queries Geo API for existing entities)
    logger.section('Step 4: Building Entity Map');
    const network = (options.network ?? 'TESTNET').toUpperCase() as 'TESTNET' | 'MAINNET';
    logger.info('Querying Geo API for existing entities, types, and properties...');
    const entityMap = await buildEntityMap(data, network);

    // Step 5: Build relations
    logger.section('Step 5: Building Relations');
    const relations = buildRelations(data, entityMap);

    // Step 6: Build operations batch
    logger.section('Step 6: Building Operations Batch');
    const batch = buildOperationsBatch(data, entityMap, relations);
    console.log(formatBatchSummary(batch.summary));

    // Print pre-publish summary
    printPrePublishSummary(data, entityMap, batch.summary);

    // If dry run, stop here
    if (options.dryRun) {
      logger.section('Dry Run Complete');
      logger.info('No changes were made. Remove --dry-run flag to publish.');

      // Generate and save report even for dry run
      const result = {
        success: true,
        summary: batch.summary,
      };
      const report = generatePublishReport(data, entityMap, relations, result, network);
      report.transactionHash = '(dry-run)';
      const reportPath = saveReport(report, options.output);

      process.exit(0);
    }

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

    // Confirm before publishing
    if (!options.yes) {
      console.log();
      logger.warn('About to publish to Geo. This action cannot be undone.');
      logger.info('Press Ctrl+C to cancel, or wait 5 seconds to continue...');

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Step 7: Publish
    logger.section('Step 7: Publishing');
    const publishOptions: PublishOptions = {
      network,
      dryRun: false,
      verbose: options.verbose,
      outputDir: options.output,
    };

    const result = await publishToGeo(batch, data.metadata, privateKey, publishOptions);

    // Generate and save report
    const report = generatePublishReport(data, entityMap, relations, result, network);
    const reportPath = saveReport(report, options.output);

    // Print final summary
    printReportSummary(report);

    if (result.success) {
      logger.section('Publish Complete');
      logger.success('Data published successfully!');

      if (result.transactionHash) {
        const explorerUrl =
          network === 'TESTNET'
            ? `https://testnet.geobrowser.io/tx/${result.transactionHash}`
            : `https://geobrowser.io/tx/${result.transactionHash}`;
        logger.info(`View transaction: ${explorerUrl}`);
      }

      process.exit(0);
    } else {
      logger.section('Publish Failed');
      logger.error(result.error || 'Unknown error');
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Unexpected error: ${message}`);

    if (options.verbose && error instanceof Error && error.stack) {
      console.error(error.stack);
    }

    process.exit(1);
  }
}
