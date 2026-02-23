---
phase: 01-cli-restructure-and-shared-infrastructure
plan: 03
subsystem: api, infra
tags: [graphql, xlsx, entity-details, parser, geo-api]

# Dependency graph
requires:
  - phase: none
    provides: existing geo-client.ts and cell-parsers.ts
provides:
  - fetchEntityDetails() for querying entity properties, relations, backlinks, and types
  - parseEntityIds() for reading validated entity ID lists from Excel files
affects: [02-delete-entities, 03-update-entities]

# Tech tracking
tech-stack:
  added: []
  patterns: [connection-pattern-for-relation-ids, excel-entity-id-parsing-with-validation]

key-files:
  created:
    - src/parsers/entity-id-parser.ts
  modified:
    - src/api/geo-client.ts

key-decisions:
  - "Used relations connection pattern (not relationsList) to expose relation row IDs needed for deleteRelation()"
  - "Entity ID parser accumulates all errors rather than failing on first -- caller decides rejection policy"

patterns-established:
  - "Connection pattern: Use relations(filter:) { nodes { id } } not relationsList when relation row IDs are needed"
  - "Parser pattern: Return { ids, errors } and let caller decide on rejection vs partial acceptance"

requirements-completed: [INFRA-01, INFRA-02, INFRA-03, CLI-02]

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 1 Plan 3: Entity Detail Queries and ID Parser Summary

**Entity detail GraphQL query with connection-pattern relation IDs, plus Excel entity ID parser with duplicate rejection**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T12:56:29Z
- **Completed:** 2026-02-22T12:58:19Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added fetchEntityDetails() to GraphQL client for full entity introspection (properties, relations with IDs, backlinks with IDs, type assignments)
- Used correct `relations` connection pattern (not `relationsList`) to expose relation row IDs needed for delete operations
- Created entity ID parser that reads, validates, and deduplicates IDs from Excel tabs with comprehensive error reporting

## Task Commits

Each task was committed atomically:

1. **Task 1: Add entity detail query functions to GraphQL client** - `75072c2` (feat)
2. **Task 2: Create entity ID parser for Excel input** - `a4db83e` (feat)

## Files Created/Modified
- `src/api/geo-client.ts` - Added EntityDetails interface, ENTITY_DETAILS_QUERY constant, and fetchEntityDetails() function
- `src/parsers/entity-id-parser.ts` - New file with EntityIdParseResult interface and parseEntityIds() function

## Decisions Made
- Used `relations` connection pattern (not `relationsList`) to get relation row's own ID for deletion -- `relationsList` does not expose this field
- Entity ID parser accumulates all validation errors (invalid format, duplicates) rather than failing on first error, letting the caller decide rejection policy

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- fetchEntityDetails() is ready for Phase 2 (delete) to query all triples before removal
- fetchEntityDetails() is ready for Phase 3 (update) to compare current vs desired state
- parseEntityIds() is ready for both delete and update CLI commands to accept Excel-based entity ID lists
- Backlinks field availability in production API should be verified during Phase 2 implementation (existing blocker from STATE.md)

## Self-Check: PASSED

All files exist and all commits verified:
- src/api/geo-client.ts: FOUND
- src/parsers/entity-id-parser.ts: FOUND
- 01-03-SUMMARY.md: FOUND
- Commit 75072c2: FOUND
- Commit a4db83e: FOUND

---
*Phase: 01-cli-restructure-and-shared-infrastructure*
*Completed: 2026-02-22*
