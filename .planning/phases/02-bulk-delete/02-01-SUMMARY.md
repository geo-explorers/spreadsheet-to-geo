---
phase: 02-bulk-delete
plan: 01
subsystem: processors
tags: [geo-sdk, delete-operations, graph-api, entity-blanking]

# Dependency graph
requires:
  - phase: 01-cli-restructure-and-shared-infrastructure
    provides: EntityDetails interface from geo-client.ts, Op type from geo-sdk
provides:
  - buildDeleteOps() function converting EntityDetails[] to Op[]
  - DeleteOptions, DeleteSummary, DeleteBatch, DeleteSnapshot type interfaces
affects: [02-02, delete-command, delete-report]

# Tech tracking
tech-stack:
  added: []
  patterns: [delete-via-unset-and-relation-removal, relation-dedup-via-set]

key-files:
  created:
    - src/config/delete-types.ts
    - src/processors/delete-builder.ts
  modified: []

key-decisions:
  - "Graph.deleteEntity() intentionally excluded -- Indexer ignores it; use updateEntity+unset and deleteRelation instead"
  - "Relation ID deduplication via Set<string> to handle overlapping outgoing/backlink relations across entities in the same batch"
  - "Property deduplication via Set on propertyId before unset -- single entity may have multiple values for same property"

patterns-established:
  - "Delete = deleteRelation for all relations + updateEntity({ unset }) for all properties; entity shell remains"
  - "DeleteBatch mirrors OperationsBatch from upsert: { ops: Op[], summary }"

requirements-completed: [DEL-03, DEL-04, DEL-05, DEL-06, DEL-07]

# Metrics
duration: 3min
completed: 2026-02-25
---

# Phase 02 Plan 01: Delete Operation Builder Summary

**buildDeleteOps() converts EntityDetails[] into Geo SDK Op[] using Graph.deleteRelation() for all relations and Graph.updateEntity({ unset }) for all properties, with cross-entity relation deduplication**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-25T11:23:28Z
- **Completed:** 2026-02-25T11:26:06Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- Created delete-specific type definitions (DeleteOptions, DeleteSummary, DeleteBatch, DeleteSnapshot)
- Implemented buildDeleteOps() that correctly blanks entities using the deleteEntity workaround
- Relation ID deduplication prevents duplicate deletion ops when the same relation appears as outgoing on one entity and backlink on another

## Task Commits

Each task was committed atomically:

1. **Task 1: Create delete-specific type definitions** - `40a3592` (feat)
2. **Task 2: Create delete operation builder** - `3ca8301` (feat)

## Files Created/Modified
- `src/config/delete-types.ts` - DeleteOptions, DeleteSummary, DeleteBatch, DeleteSnapshot interfaces for the delete pipeline
- `src/processors/delete-builder.ts` - buildDeleteOps() pure function that converts EntityDetails[] into Op[] using Graph.deleteRelation() and Graph.updateEntity({ unset })

## Decisions Made
- Graph.deleteEntity() is explicitly NOT used anywhere -- comments document this as intentional since the Indexer ignores deleteEntity ops
- Relation dedup uses a flat Set<string> of relation IDs rather than per-entity tracking, which correctly handles the cross-entity overlap case
- Property IDs are deduplicated per-entity before calling updateEntity({ unset }) -- a single property may have multiple values but only needs one unset entry

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - npm dependencies needed installation (node_modules was absent) but this is normal project setup, not a plan deviation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- buildDeleteOps() is ready to be consumed by the delete command handler (02-02-PLAN.md)
- Delete types are ready for import by the command handler and report generator
- No blockers for Plan 02

## Self-Check: PASSED

- [x] src/config/delete-types.ts exists
- [x] src/processors/delete-builder.ts exists
- [x] Commit 40a3592 (Task 1) found in git log
- [x] Commit 3ca8301 (Task 2) found in git log
- [x] TypeScript compiles with no errors
- [x] No usage of Graph.deleteEntity() in implementation code

---
*Phase: 02-bulk-delete*
*Completed: 2026-02-25*
