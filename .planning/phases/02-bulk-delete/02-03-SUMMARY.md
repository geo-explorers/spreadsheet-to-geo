---
phase: 02-bulk-delete
plan: 03
subsystem: api
tags: [csv-parser, named-columns, space-id, cli]

# Dependency graph
requires:
  - phase: 02-bulk-delete (plan 02)
    provides: Delete command handler and CLI wiring
provides:
  - Named-column CSV parser reading Entity ID and Space ID by header name
  - Space ID sourced from CSV (not CLI flag), with optional --space override
  - Single space per CSV enforcement
  - Mismatch detection between CLI --space flag and CSV Space ID
affects: [02-bulk-delete]

# Tech tracking
tech-stack:
  added: []
  patterns: [BOM-tolerant header matching, CSV-primary space ID resolution]

key-files:
  created: []
  modified:
    - src/parsers/entity-id-parser.ts
    - src/config/delete-types.ts
    - src/cli.ts
    - src/commands/delete.ts

key-decisions:
  - "BOM-tolerant getColumnValue helper for CSV header matching (handles UTF-8 BOM prefix)"
  - "CSV is primary source for space ID; --space flag is optional override"
  - "Mismatch between --space flag and CSV space ID exits with explicit error"

patterns-established:
  - "Named column access: use getColumnValue() helper for BOM-tolerant header matching instead of Object.values index"

requirements-completed: [DEL-01]

# Metrics
duration: 3min
completed: 2026-02-25
---

# Phase 2 Plan 3: CSV Parser Column Fix Summary

**Named-column CSV parser reading Entity ID and Space ID by header name, with CSV-primary space resolution and optional --space override**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-25T12:40:32Z
- **Completed:** 2026-02-25T12:43:45Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Parser reads Entity ID and Space ID by column header name instead of positional index
- CSV is primary source for space ID; --space CLI flag demoted to optional override
- Single space ID per CSV enforced with clear error on multiple distinct spaces
- BOM-tolerant header matching handles UTF-8 BOM prefix in CSV files

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix entity-id-parser to read named columns and return spaceId** - `3c8fe20` (feat)
2. **Task 2: Update CLI and delete command to use CSV-parsed spaceId** - `ceff1c3` (feat)

## Files Created/Modified
- `src/parsers/entity-id-parser.ts` - Named-column parser with spaceId return, BOM handling, single-space validation
- `src/config/delete-types.ts` - DeleteOptions.space changed to optional
- `src/cli.ts` - --space changed from requiredOption to option, type annotation updated
- `src/commands/delete.ts` - Space ID resolution from CSV with flag override, all options.space refs replaced

## Decisions Made
- Added BOM-tolerant getColumnValue() helper function to handle CSV files with UTF-8 BOM prefix on first header
- CSV is primary source for space ID; CLI --space flag is optional override (per user decision)
- When both --space flag and CSV Space ID are present but differ, command exits with explicit mismatch error

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added BOM-tolerant column header matching**
- **Found during:** Task 1 (parser update)
- **Issue:** CSV files may have UTF-8 BOM (\uFEFF) prepended to first header, causing `row['Space ID']` to not match `\uFEFFSpace ID`
- **Fix:** Added `getColumnValue()` helper that strips BOM prefix when doing header name lookup
- **Files modified:** src/parsers/entity-id-parser.ts
- **Verification:** Dry-run with user's CSV successfully parses both Space ID and Entity ID columns
- **Committed in:** 3c8fe20 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** BOM handling necessary for correct CSV parsing. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CSV parser column fix resolves UAT tests 2 and 4 (entity ID parsed from correct column, space ID from CSV)
- Delete command fully functional with CSV-based space ID resolution
- Ready for re-run of UAT validation

## Self-Check: PASSED

All files exist. All commits verified (3c8fe20, ceff1c3).

---
*Phase: 02-bulk-delete*
*Completed: 2026-02-25*
