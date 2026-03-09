---
phase: 04-bulk-merge
plan: 01
subsystem: api
tags: [typescript, xlsx, excel-parser, merge, types]

# Dependency graph
requires:
  - phase: 01-restructure
    provides: "Shared types (ReportBase, OperationReport union), cell-parsers utilities, entity-id-parser BOM-tolerant pattern"
provides:
  - "MergeOptions, MergePair, MergeConflict, MergePairDiff, MergeSummary, MergeBatch type definitions"
  - "MergeReport in OperationReport discriminated union"
  - "parseMergeTemplate() Excel parser for Merge tab"
affects: [04-02-PLAN, 04-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Merge tab Field/Value metadata parsing", "BOM-tolerant Keeper/Merger column matching"]

key-files:
  created:
    - src/config/merge-types.ts
    - src/parsers/merge-parser.ts
  modified:
    - src/config/types.ts

key-decisions:
  - "Merge parser uses local getColumnValue BOM-tolerant helper (same self-contained pattern as entity-id-parser.ts)"
  - "cleanString from cell-parsers.js used for whitespace trimming rather than manual .trim()"
  - "Same-entity pair validation uses case-insensitive comparison"

patterns-established:
  - "Merge template format: Metadata tab (Field/Value) + Merge tab (Keeper/Merger columns)"
  - "Error accumulation pattern for merge parser matches entity-id-parser.ts"

requirements-completed: [MERGE-01, MERGE-08, MERGE-09]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 4 Plan 1: Merge Types & Parser Summary

**All merge type definitions (MergeOptions, MergePair, MergeConflict, MergePairDiff, MergeSummary, MergeBatch) plus Excel template parser for Merge tab with BOM-tolerant column matching and error accumulation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T20:49:37Z
- **Completed:** 2026-03-03T20:52:27Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Defined 6 merge-specific types in merge-types.ts covering the full merge pipeline (CLI options, parsing, diff engine, summary, batching)
- Added MergeReport to the OperationReport discriminated union in types.ts for consistent report handling
- Built parseMergeTemplate() Excel parser with Metadata tab and Merge tab parsing, BOM-tolerant column matching, and error accumulation

## Task Commits

Each task was committed atomically:

1. **Task 1: Define merge-specific types in merge-types.ts** - `e196fca` (feat)
2. **Task 2: Build Merge tab Excel parser in merge-parser.ts** - `e990534` (feat)

## Files Created/Modified
- `src/config/merge-types.ts` - All merge-specific type definitions (MergeOptions, MergePair, MergeConflict, MergePairDiff, MergeSummary, MergeBatch)
- `src/parsers/merge-parser.ts` - Excel template parser for Merge tab with parseMergeTemplate() function
- `src/config/types.ts` - Added MergeReport interface and updated OperationReport union

## Decisions Made
- Merge parser uses its own local getColumnValue helper rather than importing from a shared module, matching the self-contained pattern of entity-id-parser.ts
- Used cleanString from cell-parsers.js for whitespace trimming to stay consistent with existing parsers
- Same-entity pair validation (keeper === merger) uses case-insensitive comparison to catch "Entity A" vs "entity a" as the same entity

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 6 merge types are in place and compile -- Plan 02 (merge diff engine) and Plan 03 (merge command handler) can import them directly
- MergeReport is part of the OperationReport union -- report saving infrastructure already supports merge reports
- Excel parser ready for Plan 03's command handler to call parseMergeTemplate()

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 04-bulk-merge*
*Completed: 2026-03-03*
