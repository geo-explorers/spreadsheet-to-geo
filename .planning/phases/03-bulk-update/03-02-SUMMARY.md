---
phase: 03-bulk-update
plan: 02
subsystem: commands
tags: [update-command, cli, diff-output, report, chalk, geo-sdk]

# Dependency graph
requires:
  - phase: 03-bulk-update
    provides: Diff engine (computeEntityDiffs), update-specific types, shared CLI helpers
  - phase: 01-cli-restructure-and-shared-infrastructure
    provides: CLI router, shared types, publisher, report infrastructure, parsers
provides:
  - Update command handler (geo-publish update) with four-phase pipeline
  - Update-specific report generation (generateUpdateReport, printDiffOutput, printUpdateSummary)
  - Full CLI registration with --additive, --quiet, --dry-run, --yes, --verbose flags
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [four-phase-pipeline, minimal-batch-adapter, atomic-multi-op-publish]

key-files:
  created:
    - src/commands/update.ts
    - src/publishers/update-report.ts
  modified:
    - src/cli.ts

key-decisions:
  - "Minimal BatchSummary adapter: zeroed upsert-specific fields to satisfy publishToGeo's OperationsBatch type, avoiding a refactor of the publisher interface"
  - "All update ops (updateEntity + createRelation + deleteRelation) collected into single flat Op[] array for atomic single-publishEdit call"

patterns-established:
  - "Four-phase pipeline: validate -> diff -> confirm -> publish with --dry-run gate after diff"
  - "Upfront name resolution: all entity AND relation target names resolved before any diff or publish work"

requirements-completed: [UPD-01, UPD-02, UPD-03, UPD-04, UPD-05, UPD-06]

# Metrics
duration: 2min
completed: 2026-02-24
---

# Phase 3 Plan 2: Update Command and Reporting Summary

**Complete `geo-publish update` command with four-phase pipeline (validate/diff/confirm/publish), terminal diff output with chalk coloring, and JSON report generation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-24T20:38:33Z
- **Completed:** 2026-02-24T20:41:11Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Full `geo-publish update spreadsheet.xlsx` command with --dry-run, --yes, --additive, --verbose, --quiet flags
- Four-phase pipeline: validate (upfront name resolution) -> diff -> confirm -> publish
- Upfront validation of ALL entity names and relation targets (hard error on unresolved)
- Atomic publish: all ops (updateEntity + createRelation + deleteRelation) in single publishEdit call
- Color-coded terminal diff output (SET/ADD/DEL with chalk) with quiet and verbose modes
- JSON report saved via existing saveOperationReport infrastructure

## Task Commits

Each task was committed atomically:

1. **Task 1: Create update command handler with four-phase pipeline** - `f47f394` (feat)
2. **Task 2: Create update report generation and terminal output formatting** - `8e43177` (feat)

## Files Created/Modified
- `src/commands/update.ts` - Update command handler: four-phase pipeline with upfront name resolution, op building from diffs, atomic publish (272 lines)
- `src/publishers/update-report.ts` - Update-specific report generation, terminal diff formatting with chalk, post-publish summary (176 lines)
- `src/cli.ts` - Updated CLI router: replaced update stub with full subcommand registration including --additive and --quiet flags

## Decisions Made
- Used a minimal BatchSummary adapter with zeroed upsert-specific fields to satisfy publishToGeo's OperationsBatch type. This avoids refactoring the shared publisher interface while allowing the update command to use the existing publish pipeline. The adapter is clean and explicit about what fields are irrelevant to updates.
- All update ops (updateEntity, createRelation, deleteRelation) are collected into a single flat Op[] array for a single atomic publishEdit call, consistent with the research recommendation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 (Bulk Update) is now complete: diff engine (Plan 01) + command handler/reporting (Plan 02)
- The `geo-publish update` command is fully wired and ready for use
- All six UPD requirements satisfied

## Self-Check: PASSED

All created files verified present. All commit hashes verified in git log.

---
*Phase: 03-bulk-update*
*Completed: 2026-02-24*
