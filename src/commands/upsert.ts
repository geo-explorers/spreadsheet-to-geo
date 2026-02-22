/**
 * Upsert command handler - Create or link entities from an Excel spreadsheet
 *
 * Extracted from the monolithic src/index.ts to support subcommand CLI architecture.
 * Full upsert pipeline: parse -> validate -> build entity map -> build relations -> build ops -> publish
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import { parseExcelFile, checkRequiredTabs } from '../parsers/excel-parser.js';
import { validateSpreadsheet, formatValidationErrors } from '../parsers/validators.js';
import { buildEntityMap } from '../processors/entity-processor.js';
import { buildRelations } from '../processors/relation-builder.js';
import { buildOperationsBatch, formatBatchSummary } from '../processors/batch-builder.js';
import { publishToGeo, validatePrivateKey } from '../publishers/publisher.js';
import {
  generatePublishReport,
  printReportSummary,
  printPrePublishSummary,
} from '../publishers/publish-report.js';
import { saveOperationReport } from '../publishers/report.js';
import { logger, setVerbose } from '../utils/logger.js';
import type { PublishOptions } from '../config/types.js';

interface UpsertOptions {
  network?: string;
  dryRun: boolean;
  output: string;
  verbose: boolean;
  yes: boolean;
}

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
 * Interactive yes/no confirmation prompt using Node.js readline.
 * Throws if stdin is not a TTY (pipe, CI) -- use --yes to skip in those environments.
 */
async function confirmAction(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive confirmation required. Use --yes to skip confirmation in non-interactive environments.');
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

export async function upsertCommand(file: string, options: UpsertOptions): Promise<void> {
  // Set verbose mode
  setVerbose(options.verbose);

  const network = resolveNetwork(options.network);

  logger.section('Geo Publish - Upsert');
  logger.keyValue('File', file);
  logger.keyValue('Network', network);
  logger.keyValue('Dry Run', options.dryRun.toString());

  try {
    // Validate file exists
    if (!fs.existsSync(file)) {
      logger.error(`File not found: ${file}`);
      process.exit(1);
    }

    // Get absolute path
    const filePath = path.resolve(file);

    // Check required tabs
    logger.section('Checking Structure');
    const { missing, found } = checkRequiredTabs(filePath);

    if (missing.length > 0) {
      logger.error('Missing required tabs:');
      for (const tab of missing) {
        logger.listItem(tab);
      }
      process.exit(1);
    }

    logger.success(`All required tabs found: ${found.join(', ')}`);

    // Parse spreadsheet
    logger.section('Parsing Spreadsheet');
    const data = parseExcelFile(filePath);

    // Validate data
    logger.section('Validating Data');
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

    // Build entity map (queries Geo API for existing entities)
    logger.section('Building Entity Map');
    logger.info('Querying Geo API for existing entities, types, and properties...');
    const entityMap = await buildEntityMap(data, network, (current, total, label) => {
      logger.progress(current, total, `Processing ${current}/${total} ${label}...`);
    });

    // Build relations
    logger.section('Building Relations');
    const relations = buildRelations(data, entityMap);

    // Build operations batch
    logger.section('Building Operations Batch');
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
      const report = generatePublishReport(data, entityMap, relations, result, network, true);
      report.transactionHash = '(dry-run)';
      const reportPath = saveOperationReport(report, options.output);

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
      const confirmed = await confirmAction('About to publish to Geo. This action cannot be undone. Continue?');
      if (!confirmed) {
        logger.info('Publish cancelled by user.');
        process.exit(0);
      }
    }

    // Publish
    logger.section('Publishing');
    const publishOptions: PublishOptions = {
      network,
      dryRun: false,
      verbose: options.verbose,
      outputDir: options.output,
    };

    const result = await publishToGeo(batch, data.metadata, privateKey, publishOptions);

    // Generate and save report
    const report = generatePublishReport(data, entityMap, relations, result, network, false);
    const reportPath = saveOperationReport(report, options.output);

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
