---
phase: 03-bulk-update
plan: 01
subsystem: processors
tags: [diff-engine, update, typescript, geo-api]

# Dependency graph
requires:
  - phase: 01-cli-restructure-and-shared-infrastructure
    provides: CLI router, shared types, entity detail fetching, cell parsers
provides:
  - Diff engine (computeEntityDiffs, diffScalarProperty, diffRelationProperty)
  - Update-specific types (EntityDiff, PropertyDiff, RelationDiff, DiffSummary, UpdateOptions)
  - Shared CLI helpers (resolveNetwork, confirmAction) extracted from upsert
  - operationType metadata field for spreadsheet-driven operation routing
affects: [03-bulk-update]

# Tech tracking
tech-stack:
  added: []
  patterns: [canonical-value-normalization, batch-fetch-with-concurrency, additive-relation-mode]

key-files:
  created:
    - src/processors/update-diff.ts
    - src/config/update-types.ts
    - src/utils/cli-helpers.ts
  modified:
    - src/commands/upsert.ts
    - src/config/types.ts
    - src/parsers/excel-parser.ts

key-decisions:
  - "Re-implemented convertToTypedValue in update-diff.ts rather than extracting from batch-builder.ts to avoid coupling update pipeline to upsert internals"
  - "Canonical value normalization for diff comparison (both spreadsheet and API values normalized before comparing) to avoid false diffs"

patterns-established:
  - "Canonical normalization: both sides normalized to canonical form before comparison (DATE->YYYY-MM-DD, BOOLEAN->true/false, FLOAT->epsilon comparison)"
  - "Hard-error on partial data: fetchEntityDetails failure halts diff computation rather than proceeding with incomplete state"

requirements-completed: [UPD-01, UPD-03, UPD-04]

# Metrics
duration: 3min
completed: 2026-02-24
---

# Phase 3 Plan 1: Update Infrastructure Summary

**Diff engine with canonical value normalization, additive relation mode, and shared CLI helpers extracted from upsert**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-24T20:32:04Z
- **Completed:** 2026-02-24T20:35:27Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Diff engine computes per-entity scalar and relation diffs by comparing spreadsheet values against live Geo entity state
- Blank cells always skipped (UPD-04: blank = no opinion, never produces diff or op)
- Additive mode flag respected in relation diffs (only add, never remove)
- Shared CLI helpers (resolveNetwork, confirmAction) extracted from upsert without breaking import chain
- Update-specific types defined: UpdateOptions, PropertyDiff, RelationDiff, EntityDiff, DiffSummary

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract shared CLI helpers and define update types** - `34b0029` (feat)
2. **Task 2: Build the diff engine** - `ffde7d2` (feat)

## Files Created/Modified
- `src/processors/update-diff.ts` - Diff engine: scalar comparison, relation reconciliation, batch entity detail fetching (571 lines)
- `src/config/update-types.ts` - Update-specific type definitions (59 lines)
- `src/utils/cli-helpers.ts` - Shared CLI helpers extracted from upsert (39 lines)
- `src/commands/upsert.ts` - Updated to import shared helpers instead of defining inline
- `src/config/types.ts` - Added optional operationType to Metadata interface
- `src/parsers/excel-parser.ts` - Parse Operation type metadata field

## Decisions Made
- Re-implemented convertToTypedValue in update-diff.ts rather than extracting it as a shared utility from batch-builder.ts. Rationale: avoids coupling the update pipeline to upsert internals; the function is small and self-contained.
- Used canonical value normalization for diff comparison (both spreadsheet and API values normalized to the same form before comparing). This prevents false diffs from format differences (e.g., "2024-01-15" vs "2024-01-15T00:00:00.000Z").

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Diff engine ready for Plan 02 to build the update command handler that orchestrates: parse -> resolve -> diff -> build ops -> publish
- All update-specific types exported and ready for use
- Shared CLI helpers available for the update command

## Self-Check: PASSED

All created files verified present. All commit hashes verified in git log.

---
*Phase: 03-bulk-update*
*Completed: 2026-02-24*
