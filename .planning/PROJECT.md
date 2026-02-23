# Geo Bulk Operations Tool

## What This Is

A CLI tool for performing bulk data operations on the Geo protocol. Engineers use it to process spreadsheets/CSVs prepared by editors in the Geo Curator Program, executing bulk upserts, updates, deletes, and merges against the Geo blockchain.

## Core Value

Editors can fix data quality issues at scale through standardized spreadsheet-driven bulk operations, without needing custom scripts for each use case.

## Requirements

### Validated

<!-- Existing capabilities confirmed from current codebase -->

- ✓ Bulk entity upsert from Excel spreadsheets — existing
- ✓ Excel parsing with structured tabs (Metadata, Types, Properties, entity tabs) — existing
- ✓ Data validation with error/warning collection — existing
- ✓ Entity deduplication via Geo API lookups (CREATE/LINK decisions) — existing
- ✓ Relation building between entities — existing
- ✓ SDK operation batch construction (properties → types → entities → relations) — existing
- ✓ Blockchain publishing (personal and DAO spaces) — existing
- ✓ Dry-run mode for previewing operations — existing
- ✓ Publication reporting — existing

### Active

<!-- New scope being built toward -->

- [ ] Restructure codebase from single pipeline to multi-operation CLI with subcommands
- [ ] Bulk delete entities from CSV (entity IDs) — removes all triples (properties, relations in both directions, type assignments), then entity
- [ ] Bulk update entities from Excel — same spreadsheet format as upsert but overwrites existing property values
- [ ] Bulk merge entities from CSV (keeper_entity_id, merger_entity_id) — appends properties/relations from merger to keeper without overwriting, then deletes merger

### Out of Scope

- Editor-facing UI or web interface — engineers run the CLI on editors' behalf
- Real-time data quality monitoring — this is a batch operations tool
- Undo/rollback of published operations — blockchain transactions are final
- Custom scripting per use case — the whole point is standardized operations

## Context

- **Curator Program:** Ongoing program where people submit datasets to Geo; generates data quality issues that editors flag and report to engineers
- **Existing tool:** Current repo handles bulk upsert only, designed as a single-pipeline CLI
- **Geo Protocol:** Entities are stored as triples on a blockchain via the Geo SDK; operations are published as transactions
- **SDK:** Geo SDK (submodule at `submodules/geo-sdk`) handles operation creation and transaction building; delete operations need research
- **API:** Hypergraph API (submodule at `submodules/hypergraph`) used for querying existing entities; MCP available
- **Team workflow:** Editors prepare spreadsheets/CSVs → hand off to engineers → engineers run CLI tool
- **Batch sizes:** Range from 1-50 (targeted fixes) to 500+ (mass operations across collections)

## Constraints

- **Tech stack**: TypeScript/Node.js — matches existing codebase
- **SDK dependency**: Must use @geoprotocol/geo-sdk for all blockchain operations
- **Spreadsheet input**: Editors are comfortable with spreadsheets/CSVs — keep this as the interface
- **Delete ordering**: Geo requires removing all relations and properties before deleting an entity
- **Merge semantics**: Keeper's existing data takes precedence — merger data only appended if not already present

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Restructure this repo (not separate repos) | Shared infrastructure (parsing, API client, publishing) across all operations | — Pending |
| Subcommand-based CLI | Each operation is a subcommand (e.g., `geo-publish upsert`, `geo-publish delete`) | — Pending |
| Delete first priority | Bad data needs to come out before other corrections | — Pending |
| Incremental delivery | Each operation ships independently as ready | — Pending |

---
*Last updated: 2026-02-19 after initialization*
