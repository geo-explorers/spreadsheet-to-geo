/**
 * Publish report generation
 *
 * Updated for new spreadsheet format:
 * - No geoId columns - use action from EntityMap
 * - Types and properties now have action='CREATE' or 'LINK'
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ParsedSpreadsheet,
  EntityMap,
  PublishResult,
  BatchSummary,
} from '../config/schema.js';
import type { RelationToCreate } from '../processors/relation-builder.js';
import { logger } from '../utils/logger.js';
import { normalizeEntityName } from '../utils/cell-parsers.js';

/**
 * Full publish report data
 */
export interface PublishReport {
  timestamp: string;
  success: boolean;
  spaceId: string;
  spaceType: string;
  network: string;
  editId?: string;
  cid?: string;
  transactionHash?: string;
  error?: string;
  summary: BatchSummary;
  details: {
    typesCreated: Array<{ name: string; id: string }>;
    typesLinked: Array<{ name: string; id: string }>;
    propertiesCreated: Array<{ name: string; id: string; dataType: string }>;
    propertiesLinked: Array<{ name: string; id: string }>;
    entitiesCreated: Array<{ name: string; id: string; types: string[] }>;
    entitiesLinked: Array<{ name: string; id: string }>;
    relationsCreated: Array<{
      from: string;
      to: string;
      property: string;
    }>;
    multiTypeEntities: Array<{ name: string; types: string[] }>;
  };
}

/**
 * Generate publish report
 */
export function generatePublishReport(
  data: ParsedSpreadsheet,
  entityMap: EntityMap,
  relations: RelationToCreate[],
  result: PublishResult,
  network: string
): PublishReport {
  const report: PublishReport = {
    timestamp: new Date().toISOString(),
    success: result.success,
    spaceId: data.metadata.spaceId,
    spaceType: data.metadata.spaceType,
    network,
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

  // Populate entities
  for (const [name, entity] of entityMap.entities) {
    if (entity.action === 'LINK') {
      report.details.entitiesLinked.push({ name: entity.name, id: entity.id });
    } else {
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
 * Save report to file
 */
export function saveReport(report: PublishReport, outputDir: string): string {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate filename with timestamp
  const timestamp = report.timestamp.replace(/[:.]/g, '-');
  const status = report.success ? 'success' : 'failed';
  const filename = `publish-report-${timestamp}-${status}.json`;
  const filepath = path.join(outputDir, filename);

  // Write report
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

  logger.success(`Report saved to ${filepath}`);

  return filepath;
}

/**
 * Print report summary to console
 */
export function printReportSummary(report: PublishReport): void {
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
  relations: RelationToCreate[]
): void {
  logger.section('Pre-Publish Summary');

  logger.keyValue('Space ID', data.metadata.spaceId);
  logger.keyValue('Space Type', data.metadata.spaceType);

  // Count actions from resolved maps
  let typesCreate = 0,
    typesLink = 0;
  for (const resolved of entityMap.types.values()) {
    if (resolved.action === 'CREATE') typesCreate++;
    else typesLink++;
  }

  let propsCreate = 0,
    propsLink = 0;
  for (const resolved of entityMap.properties.values()) {
    if (resolved.action === 'CREATE') propsCreate++;
    else propsLink++;
  }

  let entitiesCreate = 0,
    entitiesLink = 0;
  for (const entity of entityMap.entities.values()) {
    if (entity.action === 'CREATE') entitiesCreate++;
    else entitiesLink++;
  }

  console.log();
  logger.subsection('Actions to be taken');

  logger.table(
    ['Category', 'Will Create', 'Will Link'],
    [
      ['Types', String(typesCreate), String(typesLink)],
      ['Properties', String(propsCreate), String(propsLink)],
      ['Entities', String(entitiesCreate), String(entitiesLink)],
      ['Relations', String(relations.length), '-'],
    ]
  );

  // Multi-type entities
  const multiType = Array.from(entityMap.entities.values()).filter(
    e => e.types.length > 1
  );

  if (multiType.length > 0) {
    console.log();
    logger.subsection('Multi-Type Entities');
    for (const entity of multiType) {
      logger.listItem(`${entity.name}: ${entity.types.join(', ')}`);
    }
  }

  // Entities to create
  const toCreate = Array.from(entityMap.entities.values()).filter(
    e => e.action === 'CREATE'
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
