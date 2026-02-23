/**
 * Upsert-specific report generation
 *
 * Generates UpsertReport instances conforming to the OperationReport discriminated union.
 * Report saving is handled by the generalized saveOperationReport() in report.ts.
 */

import type {
  ParsedSpreadsheet,
  EntityMap,
  PublishResult,
  BatchSummary,
} from '../config/upsert-types.js';
import type { UpsertReport } from '../config/types.js';
import type { RelationToCreate } from '../processors/relation-builder.js';
import { logger } from '../utils/logger.js';
import { normalizeEntityName } from '../utils/cell-parsers.js';

/**
 * Generate upsert report conforming to the OperationReport discriminated union.
 *
 * The caller must set `dryRun` on the returned report if this is a dry-run invocation.
 */
export function generatePublishReport(
  data: ParsedSpreadsheet,
  entityMap: EntityMap,
  relations: RelationToCreate[],
  result: PublishResult,
  network: string,
  dryRun: boolean = false
): UpsertReport {
  const report: UpsertReport = {
    operationType: 'upsert',
    timestamp: new Date().toISOString(),
    success: result.success,
    network,
    spaceId: data.metadata.spaceId,
    spaceType: data.metadata.spaceType,
    dryRun,
    editId: result.editId,
    cid: result.cid,
    transactionHash: result.transactionHash,
    error: result.error,
    summary: result.summary,
    details: {
      typesCreated: [],
      typesLinked: [],
      propertiesCreated: [],
      propertiesLinked: [],
      entitiesCreated: [],
      entitiesLinked: [],
      relationsCreated: [],
      multiTypeEntities: result.summary.multiTypeEntities,
    },
  };

  // Populate types from entityMap (action determines CREATE vs LINK)
  for (const type of data.types) {
    const normalized = normalizeEntityName(type.name);
    const resolved = entityMap.types.get(normalized);
    if (!resolved) continue;

    if (resolved.action === 'LINK') {
      report.details.typesLinked.push({ name: type.name, id: resolved.id });
    } else {
      report.details.typesCreated.push({ name: type.name, id: resolved.id });
    }
  }

  // Populate properties from entityMap
  for (const prop of data.properties) {
    const normalized = normalizeEntityName(prop.name);
    const resolved = entityMap.properties.get(normalized);
    if (!resolved) continue;

    if (resolved.action === 'LINK') {
      report.details.propertiesLinked.push({ name: prop.name, id: resolved.id });
    } else {
      report.details.propertiesCreated.push({
        name: prop.name,
        id: resolved.id,
        dataType: prop.dataType,
      });
    }
  }

  // Populate entities -- only include created entities that actually got ops (have types)
  for (const entity of entityMap.entities.values()) {
    if (entity.action === 'LINK') {
      report.details.entitiesLinked.push({ name: entity.name, id: entity.id });
    } else if (entity.typeIds.length > 0) {
      report.details.entitiesCreated.push({
        name: entity.name,
        id: entity.id,
        types: entity.types,
      });
    }
  }

  // Populate relations
  for (const rel of relations) {
    report.details.relationsCreated.push({
      from: rel.fromEntityName,
      to: rel.toEntityName,
      property: rel.propertyName,
    });
  }

  return report;
}

/**
 * Print report summary to console
 */
export function printReportSummary(report: UpsertReport): void {
  logger.section('Publish Report');

  logger.keyValue('Timestamp', report.timestamp);
  logger.keyValue('Status', report.success ? 'SUCCESS' : 'FAILED');
  logger.keyValue('Space ID', report.spaceId);
  logger.keyValue('Space Type', report.spaceType);
  logger.keyValue('Network', report.network);

  if (report.editId) {
    logger.keyValue('Edit ID', report.editId);
  }

  if (report.cid) {
    logger.keyValue('IPFS CID', report.cid);
  }

  if (report.transactionHash) {
    logger.keyValue('Transaction', report.transactionHash);
  }

  if (report.error) {
    logger.keyValue('Error', report.error);
  }

  console.log();
  logger.subsection('Summary');

  logger.table(
    ['Category', 'Created', 'Linked'],
    [
      ['Types', String(report.summary.typesCreated), String(report.summary.typesLinked)],
      [
        'Properties',
        String(report.summary.propertiesCreated),
        String(report.summary.propertiesLinked),
      ],
      [
        'Entities',
        String(report.summary.entitiesCreated),
        String(report.summary.entitiesLinked),
      ],
      ['Relations', String(report.summary.relationsCreated), '-'],
    ]
  );

  if (report.details.multiTypeEntities.length > 0) {
    console.log();
    logger.subsection('Multi-Type Entities');
    for (const entity of report.details.multiTypeEntities) {
      logger.listItem(`${entity.name}: ${entity.types.join(', ')}`);
    }
  }

  if (report.details.entitiesCreated.length > 0) {
    console.log();
    logger.subsection(`Entities Created (${report.details.entitiesCreated.length})`);
    for (const entity of report.details.entitiesCreated.slice(0, 10)) {
      logger.listItem(`${entity.name} [${entity.id}]`);
    }
    if (report.details.entitiesCreated.length > 10) {
      logger.listItem(`... and ${report.details.entitiesCreated.length - 10} more`);
    }
  }
}

/**
 * Generate pre-publish summary (for dry run)
 */
export function printPrePublishSummary(
  data: ParsedSpreadsheet,
  entityMap: EntityMap,
  batchSummary: BatchSummary
): void {
  logger.section('Pre-Publish Summary');

  logger.keyValue('Space ID', data.metadata.spaceId);
  logger.keyValue('Space Type', data.metadata.spaceType);

  console.log();
  logger.subsection('Actions to be taken');

  // Use batchSummary counts -- these reflect what will actually get ops, not what was planned
  logger.table(
    ['Category', 'Will Create', 'Will Link'],
    [
      ['Types', String(batchSummary.typesCreated), String(batchSummary.typesLinked)],
      ['Properties', String(batchSummary.propertiesCreated), String(batchSummary.propertiesLinked)],
      ['Entities', String(batchSummary.entitiesCreated), String(batchSummary.entitiesLinked)],
      ['Relations', String(batchSummary.relationsCreated), '-'],
    ]
  );

  // Entities that will actually be created (have types resolved -- will get ops)
  const toCreate = Array.from(entityMap.entities.values()).filter(
    e => e.action === 'CREATE' && e.typeIds.length > 0
  );

  // Entities skipped due to no types (referenced but not in spreadsheet and not found in Geo)
  const skipped = Array.from(entityMap.entities.values()).filter(
    e => e.action === 'CREATE' && e.typeIds.length === 0
  );

  if (toCreate.length > 0) {
    console.log();
    logger.subsection(`Entities to Create (${toCreate.length})`);
    for (const entity of toCreate.slice(0, 15)) {
      logger.listItem(`${entity.name} → ${entity.id}`);
    }
    if (toCreate.length > 15) {
      logger.listItem(`... and ${toCreate.length - 15} more`);
    }
  }

  if (skipped.length > 0) {
    console.log();
    logger.subsection(`Entities Skipped -- no types (${skipped.length})`);
    for (const entity of skipped) {
      logger.listItem(`${entity.name} -- not in any entity tab and not found in Geo`);
    }
  }

  // Entities to link
  const toLink = Array.from(entityMap.entities.values()).filter(
    e => e.action === 'LINK'
  );

  if (toLink.length > 0) {
    console.log();
    logger.subsection(`Entities to Link (${toLink.length})`);
    for (const entity of toLink.slice(0, 10)) {
      logger.listItem(`${entity.name} → ${entity.id}`);
    }
    if (toLink.length > 10) {
      logger.listItem(`... and ${toLink.length - 10} more`);
    }
  }
}
