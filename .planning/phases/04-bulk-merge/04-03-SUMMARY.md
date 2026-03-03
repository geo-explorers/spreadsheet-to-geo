---
phase: 04-bulk-merge
plan: 03
subsystem: api
tags: [typescript, merge, command-handler, cli, pipeline, atomic-publish, dry-run]

# Dependency graph
requires:
  - phase: 04-bulk-merge
    provides: "parseMergeTemplate() from merge-parser.ts, MergeOptions/MergePairDiff/MergeSummary from merge-types.ts"
  - phase: 04-bulk-merge
    provides: "computeMergePairDiff() and buildMergeOps() from merge-diff.ts"
  - phase: 01-restructure
    provides: "CLI router pattern, publishToGeo(), saveOperationReport(), resolveNetwork(), confirmAction()"
provides:
  - "mergeCommand() four-phase pipeline: validate -> diff -> confirm -> publish"
  - "generateMergeReport() producing MergeReport for OperationReport union"
  - "printMergeDiffOutput() colored terminal diff with transfers, conflicts, re-points"
  - "printMergeSummary() aggregate counts and per-pair publish results"
  - "CLI merge subcommand with --dry-run, --network, --output, --verbose, --yes"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["Per-pair atomic publishing via separate publishToGeo() calls", "Pre-merge snapshot saving keeper+merger states", "Zeroed BatchSummary adapter for OperationsBatch compatibility"]

key-files:
  created:
    - src/commands/merge.ts
    - src/publishers/merge-report.ts
  modified:
    - src/cli.ts

key-decisions:
  - "Per-pair atomic publishing: each merge pair is a separate publishToGeo() call, matching MERGE-06 and CONTEXT.md locked decision"
  - "Pre-merge snapshot saves both keeper and merger entity states to .snapshots/ before any modifications"
  - "Publish failures are logged but do not abort remaining pairs (already-published pairs are committed on-chain)"
  - "Multi-way merges use pre-computed diffs with a comment noting the re-fetch limitation for maximum correctness"

patterns-established:
  - "Merge pipeline: validate (parse + resolve names) -> diff (fetch details + compute) -> confirm (print + prompt) -> publish (per-pair atomic)"
  - "Merge report follows same generateXxxReport/printXxxOutput/printXxxSummary pattern as update-report.ts"

requirements-completed: [MERGE-02, MERGE-06, MERGE-07, MERGE-09]

# Metrics
duration: 4min
completed: 2026-03-03
---

# Phase 4 Plan 3: Merge Command & CLI Summary

**Four-phase merge pipeline with per-pair atomic publishing, dry-run diff preview, pre-merge snapshots, and CLI subcommand registration**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-03T21:01:07Z
- **Completed:** 2026-03-03T21:05:48Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Built complete merge command handler implementing the four-phase pipeline (validate -> diff -> confirm -> publish) consistent with update.ts patterns
- Created merge-specific report module with generateMergeReport(), printMergeDiffOutput(), and printMergeSummary() following update-report.ts patterns
- Registered merge CLI subcommand with all five options (--dry-run, --network, --output, --verbose, --yes) using dynamic import pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Create merge report generation and dry-run output** - `1b9023c` (feat)
2. **Task 2: Build merge command handler and register CLI subcommand** - `46dab94` (feat)

## Files Created/Modified
- `src/publishers/merge-report.ts` - Merge report generation (generateMergeReport), colored diff output (printMergeDiffOutput), and final summary (printMergeSummary)
- `src/commands/merge.ts` - Complete merge command handler with four-phase pipeline, per-pair atomic publishing, pre-merge snapshots, and dry-run support
- `src/cli.ts` - Added merge subcommand registration with all options following the update/delete pattern

## Decisions Made
- Per-pair atomic publishing: each merge pair gets its own publishToGeo() call, ensuring one pair's failure does not roll back others (already committed on-chain)
- Pre-merge snapshot saves both keeper and merger full EntityDetails to .snapshots/ for recovery, following delete.ts's saveSnapshot() pattern
- Publish failures log errors and continue to next pair rather than aborting the entire run, since already-published pairs cannot be reverted
- Multi-way merges (multiple mergers into same keeper) use pre-computed diffs; a code comment documents that re-fetching keeper state between publishes would improve correctness for edge cases

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 4 (Bulk Merge) is now complete with all three plans executed
- The merge pipeline is fully functional: parser (Plan 01) -> diff engine (Plan 02) -> command handler (Plan 03)
- CLI supports `geo-publish merge template.xlsx` with all options

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 04-bulk-merge*
*Completed: 2026-03-03*
