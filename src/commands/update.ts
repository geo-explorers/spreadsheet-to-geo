/**
 * Update command handler - Bulk-update entity properties from an Excel spreadsheet
 *
 * Four-phase pipeline (per CONTEXT.md locked decision):
 *   1. VALIDATE: Parse spreadsheet, resolve all entity + relation target names upfront
 *   2. DIFF: Query current state from Geo, compute per-entity diffs
 *   3. CONFIRM: Show diff, prompt for confirmation (unless --yes)
 *   4. PUBLISH: Build ops from diffs, send to Geo in single atomic publishEdit
 *
 * --dry-run stops cleanly after DIFF phase (validate + diff both ran, nothing writes).
 */

import * as fs from 'fs';
import * as path from 'path';

import { parseExcelFile, checkRequiredTabs } from '../parsers/excel-parser.js';
import { validateSpreadsheet, formatValidationErrors } from '../parsers/validators.js';
import { searchEntitiesByNames, searchPropertiesByNames } from '../api/geo-client.js';
import { computeEntityDiffs } from '../processors/update-diff.js';
import { Graph, SystemIds, type Op } from '@geoprotocol/geo-sdk';
import { resolveNetwork, confirmAction } from '../utils/cli-helpers.js';
import {
  generateUpdateReport,
  printDiffOutput,
  printUpdateSummary,
} from '../publishers/update-report.js';
import { saveOperationReport } from '../publishers/report.js';
import { validatePrivateKey, publishToGeo } from '../publishers/publisher.js';
import { normalizeEntityName } from '../utils/cell-parsers.js';
import { logger, setVerbose } from '../utils/logger.js';
import type { PublishOptions } from '../config/types.js';
import type { OperationsBatch, BatchSummary } from '../config/upsert-types.js';

interface UpdateCommandOptions {
  network?: string;
  dryRun: boolean;
  output: string;
  verbose: boolean;
  quiet: boolean;
  yes: boolean;
  additive: boolean;
}

export async function updateCommand(file: string, options: UpdateCommandOptions): Promise<void> {
  // Preamble: validate mutually exclusive flags
  if (options.verbose && options.quiet) {
    logger.error('--verbose and --quiet are mutually exclusive');
    process.exit(1);
  }

  // Set verbose mode
  setVerbose(options.verbose);

  const network = resolveNetwork(options.network);

  logger.section('Geo Publish - Update');
  logger.keyValue('File', file);
  logger.keyValue('Network', network);
  logger.keyValue('Dry Run', options.dryRun.toString());
  logger.keyValue('Additive Mode', options.additive.toString());

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

    // Check required tabs
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
    logger.info('Parsing spreadsheet...');
    const data = parseExcelFile(filePath);
    const metadata = data.metadata;

    // Check operation type field
    if (metadata.operationType && metadata.operationType.toUpperCase() !== 'UPDATE') {
      logger.warn(
        `Spreadsheet Operation type is '${metadata.operationType}' but running update command. Proceeding.`
      );
    }

    // Validate spreadsheet data
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

    // Collect ALL entity names from spreadsheet rows
    const entityRowNames = new Set<string>();
    for (const entity of data.entities) {
      entityRowNames.add(entity.name);
    }

    // Collect ALL relation target names from spreadsheet relation cells
    const relationTargetNames = new Set<string>();
    for (const entity of data.entities) {
      for (const [, targets] of Object.entries(entity.relations)) {
        for (const target of targets) {
          const trimmed = target.trim();
          if (trimmed) {
            relationTargetNames.add(trimmed);
          }
        }
      }
    }

    // Combine into one deduplicated list of names to resolve
    const allNames = [...new Set([...entityRowNames, ...relationTargetNames])];
    logger.info(`Resolving ${allNames.length} entity/relation target names...`);

    // Resolve all names via API
    const resolvedGeoEntities = await searchEntitiesByNames(allNames, metadata.spaceId, network);

    // Build resolved-entities map: normalized name -> { id, name }
    const resolvedEntities = new Map<string, { id: string; name: string }>();
    for (const [normalizedName, geoEntity] of resolvedGeoEntities) {
      resolvedEntities.set(normalizedName, { id: geoEntity.id, name: geoEntity.name });
    }

    // Check for unresolved entity row names (hard error)
    const unresolvedRowNames: string[] = [];
    for (const name of entityRowNames) {
      const normalized = normalizeEntityName(name);
      if (!resolvedEntities.has(normalized)) {
        unresolvedRowNames.push(name);
      }
    }
    if (unresolvedRowNames.length > 0) {
      logger.error(`Cannot resolve ${unresolvedRowNames.length} entity name(s):`);
      for (const name of unresolvedRowNames) {
        logger.listItem(name);
      }
      logger.error('All entities must exist in Geo before updating. Use "upsert" to create them first.');
      process.exit(1);
    }

    // Check for unresolved relation target names (hard error)
    const unresolvedTargetNames: string[] = [];
    for (const name of relationTargetNames) {
      const normalized = normalizeEntityName(name);
      if (!resolvedEntities.has(normalized)) {
        unresolvedTargetNames.push(name);
      }
    }
    if (unresolvedTargetNames.length > 0) {
      logger.error(`Cannot resolve ${unresolvedTargetNames.length} relation target(s):`);
      for (const name of unresolvedTargetNames) {
        logger.listItem(name);
      }
      logger.error('All relation targets must exist in Geo before updating.');
      process.exit(1);
    }

    logger.success(`All ${allNames.length} names resolved`);

    // Resolve property names + IDs (needed for diff engine to match property IDs)
    const propertyNames = data.properties.map(p => p.name);
    const resolvedGeoProperties = await searchPropertiesByNames(propertyNames, network, metadata.spaceId);

    // Build resolved-properties map: normalized name -> { id, dataType }
    // Combine spreadsheet PropertyDefinition with API-resolved property info
    const resolvedProperties = new Map<string, { id: string; dataType: string }>();
    for (const propDef of data.properties) {
      const normalized = normalizeEntityName(propDef.name);
      const geoProp = resolvedGeoProperties.get(normalized);
      if (geoProp) {
        resolvedProperties.set(normalized, {
          id: geoProp.id,
          dataType: propDef.dataType, // Use spreadsheet-declared dataType (canonical)
        });
      }
    }

    logger.success(`Resolved ${resolvedProperties.size}/${propertyNames.length} properties`);

    // ========================================================================
    // PHASE 2: DIFF
    // ========================================================================
    logger.section('Phase 2: Diff');

    const { diffs, summary } = await computeEntityDiffs(
      data.entities,
      resolvedEntities,
      resolvedProperties,
      metadata.spaceId,
      network,
      { additive: options.additive, verbose: options.verbose }
    );

    // --dry-run gate: stop after diff phase
    if (options.dryRun) {
      printDiffOutput(diffs, summary, { verbose: options.verbose, quiet: options.quiet });
      const report = generateUpdateReport(diffs, summary, metadata, network, true);
      saveOperationReport(report, options.output);
      logger.info('Dry run complete -- no changes were made.');
      process.exit(0);
    }

    // ========================================================================
    // PHASE 3: CONFIRM
    // ========================================================================
    logger.section('Phase 3: Confirm');

    printDiffOutput(diffs, summary, { verbose: options.verbose, quiet: options.quiet });

    // Zero changes: nothing to publish
    if (
      summary.totalScalarChanges === 0 &&
      summary.totalRelationsAdded === 0 &&
      summary.totalRelationsRemoved === 0
    ) {
      logger.info('No changes detected -- nothing to publish.');
      process.exit(0);
    }

    // Prompt for confirmation
    if (!options.yes) {
      const confirmed = await confirmAction(
        'Apply these changes to Geo? This action cannot be undone.'
      );
      if (!confirmed) {
        logger.info('Update cancelled by user.');
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

    // Build ops array from diffs
    const allOps: Op[] = [];
    for (const entityDiff of diffs) {
      if (entityDiff.status !== 'updated') continue;

      // Scalar property updates
      if (entityDiff.scalarChanges.length > 0) {
        // Separate description from regular property values
        const descChange = entityDiff.scalarChanges.find(
          c => c.propertyId === SystemIds.DESCRIPTION_PROPERTY
        );
        const values = entityDiff.scalarChanges
          .filter(c => c.typedValue && c.propertyId !== SystemIds.DESCRIPTION_PROPERTY)
          .map(c => ({
            property: c.propertyId,
            ...c.typedValue!,
          }));

        if (values.length > 0 || descChange) {
          allOps.push(
            ...Graph.updateEntity({
              id: entityDiff.entityId,
              values: values.length > 0 ? values : undefined,
              ...(descChange && { description: descChange.newValue }),
            }).ops
          );
        }
      }

      // Relation additions
      for (const relDiff of entityDiff.relationChanges) {
        for (const rel of relDiff.toAdd) {
          allOps.push(
            ...Graph.createRelation({
              fromEntity: entityDiff.entityId,
              toEntity: rel.entityId,
              type: relDiff.propertyId,
            }).ops
          );
        }

        // Relation removals
        for (const rel of relDiff.toRemove) {
          allOps.push(
            ...Graph.deleteRelation({
              id: rel.relationId,
            }).ops
          );
        }
      }
    }

    logger.keyValue('Total operations', allOps.length.toString());

    // Build a minimal OperationsBatch compatible with publishToGeo
    const batchSummary: BatchSummary = {
      typesCreated: 0,
      typesLinked: 0,
      propertiesCreated: 0,
      propertiesLinked: 0,
      entitiesCreated: 0,
      entitiesLinked: summary.entitiesWithChanges,
      relationsCreated: summary.totalRelationsAdded,
      imagesUploaded: 0,
      multiTypeEntities: [],
    };

    const batch: OperationsBatch = {
      ops: allOps,
      summary: batchSummary,
    };

    const publishOptions: PublishOptions = {
      network,
      dryRun: false,
      verbose: options.verbose,
      outputDir: options.output,
    };

    const result = await publishToGeo(batch, metadata, privateKey, publishOptions);

    // Generate and save report
    const report = generateUpdateReport(diffs, summary, metadata, network, false);
    if (result.transactionHash) {
      report.transactionHash = result.transactionHash;
    }
    report.success = result.success;
    if (result.error) {
      report.error = result.error;
    }
    saveOperationReport(report, options.output);

    // Print final summary
    printUpdateSummary(summary, {
      success: result.success,
      transactionHash: result.transactionHash,
    });

    if (result.success) {
      logger.section('Update Complete');
      logger.success('Changes published successfully!');

      if (result.transactionHash) {
        const explorerUrl =
          network === 'TESTNET'
            ? `https://testnet.geobrowser.io/tx/${result.transactionHash}`
            : `https://geobrowser.io/tx/${result.transactionHash}`;
        logger.info(`View transaction: ${explorerUrl}`);
      }

      process.exit(0);
    } else {
      logger.section('Update Failed');
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
