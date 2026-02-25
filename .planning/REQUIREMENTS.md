# Requirements: Geo Bulk Operations Tool

**Defined:** 2026-02-19
**Core Value:** Editors can fix data quality issues at scale through standardized spreadsheet-driven bulk operations

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Restructuring

- [x] **STRUC-01**: Extract monolithic `src/index.ts` into thin CLI router + per-operation command handlers in `src/commands/`
- [x] **STRUC-02**: Move existing upsert pipeline into `src/commands/upsert.ts` without changing behavior
- [x] **STRUC-03**: Shared infrastructure (API client, publisher, logger, cell parsers) remains in common modules
- [x] **STRUC-04**: Operation-specific logic (validators, batch builders) isolated per operation in dedicated files
- [x] **STRUC-05**: Type definitions split into shared types + operation-specific types

### CLI Infrastructure

- [x] **CLI-01**: CLI uses subcommand structure (`geo-publish upsert|delete|update`)
- [x] **CLI-02**: CSV parser handles single-column (delete) and multi-column (future merge) inputs
- [x] **CLI-03**: Generalized report type covers all operation types

### Shared Infrastructure

- [x] **INFRA-01**: GraphQL client can fetch entity details by ID (properties, relation IDs, type assignments)
- [x] **INFRA-02**: GraphQL client can fetch incoming relations (backlinks) for an entity
- [x] **INFRA-03**: Entity ID validation rejects malformed IDs before API calls

### Delete Operation

- [x] **DEL-01**: User can provide CSV of entity IDs as delete input
- [x] **DEL-02**: Tool validates all entity IDs exist before executing any deletions
- [x] **DEL-03**: Tool deletes all property triples for each entity
- [x] **DEL-04**: Tool deletes all outgoing relations for each entity
- [x] **DEL-05**: Tool deletes all incoming relations (backlinks) for each entity
- [x] **DEL-06**: Tool deletes type assignment relations for each entity
- [x] **DEL-07**: Tool deletes the entity itself after all triples are removed
- [x] **DEL-08**: Dry-run mode shows entity names, property counts, and relation counts without executing
- [x] **DEL-09**: Pre-operation snapshot saves entity data before deletion as audit trail
- [x] **DEL-10**: Progress reporting shows "Processing X/Y..." for batches
- [x] **DEL-11**: Summary report shows counts of entities deleted, relations removed, properties unset

### Update Operation

- [ ] **UPD-01**: User can provide Excel spreadsheet in same format as upsert, plus entity ID column
- [ ] **UPD-02**: Tool validates all entity IDs exist before executing updates
- [ ] **UPD-03**: Tool overwrites existing property values using `updateEntity` set semantics
- [ ] **UPD-04**: Tool unsets properties for explicitly cleared/empty cells
- [ ] **UPD-05**: Dry-run mode shows what properties will be changed per entity
- [ ] **UPD-06**: Summary report shows counts of entities updated, properties set, properties unset

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Merge Operation

- **MERGE-01**: User can provide CSV with keeper_id/merger_id pairs as merge input
- **MERGE-02**: Tool validates both keeper and merger entities exist
- **MERGE-03**: Tool copies properties from merger to keeper without overwriting keeper's existing values
- **MERGE-04**: Tool re-points relations from merger to keeper
- **MERGE-05**: Tool deletes merger entity after transfer (using delete logic)
- **MERGE-06**: All ops for a merge pair published in single atomic transaction
- **MERGE-07**: Dry-run mode shows property transfers, relation re-points, and conflicts
- **MERGE-08**: Merge conflict detection logs when keeper already has a value merger also has
- **MERGE-09**: Summary report shows properties transferred, relations re-pointed, mergers deleted

### Enhancements

- **ENH-01**: Batch transaction splitting for operations exceeding transaction size limits
- **ENH-02**: Idempotent re-runs with checkpoint files for partially failed batches

## Out of Scope

| Feature | Reason |
|---------|--------|
| Backward compatibility (`geo-publish <file>` without subcommand) | Clean break to subcommand-based CLI; users adopt new syntax |
| Cascade delete (delete entity + everything it relates to) | Unbounded in knowledge graphs — could delete half the graph through chains |
| Update/delete by entity name | Names are not unique identifiers in Geo; ambiguity = data corruption |
| Undo/rollback command | Blockchain transactions are irreversible |
| Cross-space operations | Violates space governance model |
| Editor-facing UI or web interface | Engineers run CLI on editors' behalf |
| Auto-detect merge candidates | Complex NLP/heuristic problem; separate tool |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| STRUC-01 | Phase 1 | Complete |
| STRUC-02 | Phase 1 | Complete |
| STRUC-03 | Phase 1 | Complete |
| STRUC-04 | Phase 1 | Complete |
| STRUC-05 | Phase 1 | Complete |
| CLI-01 | Phase 1 | Complete |
| CLI-02 | Phase 1 | Complete |
| CLI-03 | Phase 1 | Complete |
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| DEL-01 | Phase 2 | Complete |
| DEL-02 | Phase 2 | Complete |
| DEL-03 | Phase 2 | Complete |
| DEL-04 | Phase 2 | Complete |
| DEL-05 | Phase 2 | Complete |
| DEL-06 | Phase 2 | Complete |
| DEL-07 | Phase 2 | Complete |
| DEL-08 | Phase 2 | Complete |
| DEL-09 | Phase 2 | Complete |
| DEL-10 | Phase 2 | Complete |
| DEL-11 | Phase 2 | Complete |
| UPD-01 | Phase 3 | Pending |
| UPD-02 | Phase 3 | Pending |
| UPD-03 | Phase 3 | Pending |
| UPD-04 | Phase 3 | Pending |
| UPD-05 | Phase 3 | Pending |
| UPD-06 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-02-19*
*Last updated: 2026-02-19 after roadmap creation*
