---
phase: 01-cli-restructure-and-shared-infrastructure
plan: 02
subsystem: infra
tags: [typescript, types, discriminated-union, report-infrastructure]

# Dependency graph
requires:
  - phase: 01-01
    provides: Extracted upsert command and CLI router structure
provides:
  - Shared type definitions in src/config/types.ts (Metadata, PublishOptions, ValidationError, etc.)
  - Upsert-specific type definitions in src/config/upsert-types.ts (ParsedSpreadsheet, EntityMap, etc.)
  - OperationReport discriminated union (UpsertReport | DeleteReport | UpdateReport)
  - Generalized report save infrastructure in src/publishers/report.ts
affects: [02-delete-operations, 03-update-operations]

# Tech tracking
tech-stack:
  added: []
  patterns: [discriminated-union-for-operation-reports, shared-vs-domain-type-separation, generalized-report-naming]

key-files:
  created:
    - src/config/types.ts
    - src/config/upsert-types.ts
    - src/publishers/report.ts
  modified:
    - src/commands/upsert.ts
    - src/parsers/excel-parser.ts
    - src/parsers/validators.ts
    - src/processors/entity-processor.ts
    - src/processors/relation-builder.ts
    - src/processors/batch-builder.ts
    - src/publishers/publish-report.ts
    - src/publishers/publisher.ts

key-decisions:
  - "PublishResult and BatchSummary kept in upsert-types.ts (reference each other), not in shared types"
  - "UpsertReport summary field mirrors BatchSummary inline rather than importing it -- avoids shared-to-upsert dependency"
  - "Report naming convention: {operation}-{timestamp}.json with optional -dryrun suffix"
  - "generatePublishReport() takes explicit dryRun parameter instead of inferring from result"

patterns-established:
  - "Type separation: shared types in types.ts, domain-specific in {domain}-types.ts"
  - "OperationReport discriminated union: narrow on operationType field"
  - "Report saving: centralized saveOperationReport() for all operations"

requirements-completed: [STRUC-05, CLI-03]

# Metrics
duration: 3min
completed: 2026-02-22
---

# Phase 1 Plan 2: Shared Types and Report Infrastructure Summary

**Split monolithic schema.ts into shared/upsert-specific type modules with OperationReport discriminated union and generalized report save infrastructure**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22T13:02:50Z
- **Completed:** 2026-02-22T13:06:21Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Clean separation of shared types (types.ts) from upsert-specific types (upsert-types.ts) with no circular dependencies
- OperationReport discriminated union defined with upsert, delete, and update variants ready for Phases 2 and 3
- Generalized saveOperationReport() replaces old saveReport() with operation-aware naming convention
- All 8 consumer files migrated from config/schema.js imports to the new split modules

## Task Commits

Each task was committed atomically:

1. **Task 1: Split schema.ts into shared and upsert-specific type modules** - `73464d4` (feat)
2. **Task 2: Create generalized report infrastructure** - `a2387e5` (feat)

## Files Created/Modified
- `src/config/types.ts` - Shared types (Metadata, PublishOptions, ValidationError, OperationReport union)
- `src/config/upsert-types.ts` - Upsert-specific types (ParsedSpreadsheet, EntityMap, BatchSummary, PublishResult)
- `src/publishers/report.ts` - Generalized saveOperationReport() for all operation types
- `src/publishers/publish-report.ts` - Now returns UpsertReport, removed local PublishReport and saveReport()
- `src/commands/upsert.ts` - Uses saveOperationReport() and passes dryRun flag
- `src/parsers/excel-parser.ts` - Updated imports to types.ts + upsert-types.ts
- `src/parsers/validators.ts` - Updated imports to types.ts + upsert-types.ts
- `src/processors/entity-processor.ts` - Updated imports to upsert-types.ts
- `src/processors/relation-builder.ts` - Updated imports to upsert-types.ts
- `src/processors/batch-builder.ts` - Updated imports to upsert-types.ts
- `src/publishers/publisher.ts` - Updated imports split between types.ts and upsert-types.ts

## Decisions Made
- **PublishResult stays in upsert-types.ts:** It references BatchSummary directly, so moving it to shared types would create a shared-to-upsert dependency. Future operations will have their own result types.
- **UpsertReport inlines summary shape:** Rather than importing BatchSummary, the UpsertReport interface defines its summary structure inline. This keeps types.ts independent of upsert-types.ts.
- **Explicit dryRun parameter:** generatePublishReport() takes a `dryRun: boolean` parameter rather than inferring it from the result object, making the contract explicit.
- **Report naming:** Files are named `{operation}-{timestamp}.json` (e.g., `upsert-2026-02-22T13-02-50-000Z.json`) with optional `-dryrun` suffix.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Shared types ready for Phase 2 (delete) and Phase 3 (update) to import from types.ts
- DeleteReport and UpdateReport placeholders defined -- implementers fill in details
- saveOperationReport() ready to handle any OperationReport variant
- No blockers for subsequent plans

## Self-Check: PASSED

All created files verified present. All commits verified in git log. schema.ts deletion confirmed.

---
*Phase: 01-cli-restructure-and-shared-infrastructure*
*Completed: 2026-02-22*
