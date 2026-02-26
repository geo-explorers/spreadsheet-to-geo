# Roadmap: Geo Bulk Operations Tool

## Overview

Transform the existing upsert-only CLI into a multi-operation tool supporting bulk delete and update. Phase 1 restructures the monolithic codebase into a subcommand CLI with shared infrastructure (API queries, CSV parsing, generalized reporting). Phase 2 delivers bulk delete -- the foundational destructive operation that builds entity-detail query infrastructure. Phase 3 delivers bulk update, which reuses existing Excel parsing and adds overwrite/unset semantics. Merge is deferred to v2.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: CLI Restructure and Shared Infrastructure** - Extract monolithic index.ts into subcommand CLI with shared modules, CSV parser, entity detail queries, and generalized reporting
- [ ] **Phase 2: Bulk Delete** - Complete delete pipeline: CSV input, entity validation, triple removal (properties, relations, backlinks, types), entity deletion, dry-run, reporting
- [ ] **Phase 3: Bulk Update** - Complete update pipeline: Excel input with entity ID column, property overwrite via updateEntity, unset for cleared cells, dry-run, reporting

## Phase Details

### Phase 1: CLI Restructure and Shared Infrastructure
**Goal**: Engineers can run `geo-publish upsert <file>` and the existing upsert behavior works identically through the new subcommand architecture, with shared infrastructure ready for delete and update commands
**Depends on**: Nothing (first phase)
**Requirements**: STRUC-01, STRUC-02, STRUC-03, STRUC-04, STRUC-05, CLI-01, CLI-02, CLI-03, INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. Running `geo-publish upsert <file>` produces identical output to the current `geo-publish <file>` command
  2. CLI displays help text showing available subcommands (upsert, delete, update) with usage instructions
  3. Running `geo-publish delete` or `geo-publish update` without arguments shows command-specific help (not an error)
  4. Entity detail query returns properties, relation IDs, type assignments, and backlinks for a known entity ID
  5. CSV parser correctly reads a single-column file of entity IDs and rejects malformed IDs
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md -- CLI restructure and upsert extraction (wave 1)
- [x] 01-02-PLAN.md -- Type splitting and generalized reports (wave 2, depends on 01-01)
- [x] 01-03-PLAN.md -- Entity detail queries and entity ID parser (wave 1)

### Phase 2: Bulk Delete
**Goal**: Engineers can bulk-delete entities from a CSV of entity IDs, with all associated triples (properties, outgoing relations, incoming relations, type assignments) removed before entity deletion
**Depends on**: Phase 1
**Requirements**: DEL-01, DEL-02, DEL-03, DEL-04, DEL-05, DEL-06, DEL-07, DEL-08, DEL-09, DEL-10, DEL-11
**Success Criteria** (what must be TRUE):
  1. Running `geo-publish delete entities.csv --space <id>` deletes all listed entities and their associated triples from the space
  2. Running with `--dry-run` shows entity names, property counts, and relation counts for each entity without executing any deletions
  3. Tool refuses to proceed if any entity ID in the CSV does not exist, reporting which IDs are invalid
  4. After deletion, querying any deleted entity returns no properties, no relations, and no backlinks
  5. Summary report displays counts of entities deleted, relations removed, and properties unset
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD
- [ ] 02-03: TBD

### Phase 3: Bulk Update
**Goal**: Curators can bulk-update entity properties from an Excel spreadsheet
using the same template format as upsert, with `Operation type: UPDATE` in the
Metadata tab. Only filled cells are applied — blank cells are skipped entirely.
The script resolves entities by name, queries their current state from Geo,
diffs provided values against live data, and writes only what has changed.
**Depends on**: Phase 1 (entity detail queries for current-state resolution)
**Requirements**: UPD-01, UPD-02, UPD-03, UPD-04, UPD-05, UPD-06
**Success Criteria** (what must be TRUE):
  1. Running `geo-publish update spreadsheet.xlsx --space <id>` applies only the
     non-blank cells in each row, leaving all other properties on the entity untouched
  2. For scalar properties (TEXT, DATE, BOOL etc.), a filled cell overwrites the
     current value on the entity
  3. For relation properties, the filled cell expresses the desired final state
     (comma-separated list); the script diffs against existing relations and emits
     add ops for new targets and remove ops for dropped targets
  4. Blank cells are always skipped — there is no mechanism to unset a property
     via a blank cell; unsetting is out of scope for this phase
  5. If an entity name is not found in the space the tool hard-errors on that row,
     reports which names failed to resolve, and does not apply any changes from
     the batch
  6. Running with `--dry-run` prints a per-entity diff: which scalar values will
     be overwritten (old → new), which relation targets will be added, and which
     will be removed — without writing anything to Geo
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md -- Update infrastructure: shared CLI helpers, update types, diff engine (wave 1)
- [ ] 03-02-PLAN.md -- Update command pipeline, CLI wiring, report generation (wave 2)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3
Note: Phase 3 (Update) depends only on Phase 1, not Phase 2. If parallelization is used, Phases 2 and 3 could execute concurrently after Phase 1.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. CLI Restructure and Shared Infrastructure | 3/3 | Complete | 2026-02-22 |
| 2. Bulk Delete | 0/3 | Not started | - |
| 3. Bulk Update | 0/2 | Planned | - |
