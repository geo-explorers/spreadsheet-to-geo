# Phase 2: Bulk Delete - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

CLI command to bulk-delete entities from a CSV of entity IDs, removing all associated triples (properties, outgoing relations, incoming relations, type assignments) before entity deletion. Includes dry-run mode, pre-deletion snapshots, progress reporting, and summary reports. Input validation ensures all entity IDs exist before any deletions execute.

</domain>

<decisions>
## Implementation Decisions

### Safety & confirmation flow
- Always show confirmation prompt before executing deletions
- Confirmation preview shows entity count + first few entity names as sanity check
- `--force` flag skips confirmation entirely (no prompt, no preview) for CI/scripts
- Require explicit `y` to proceed; default is `N` (abort)

### Pre-deletion snapshot
- JSON format capturing full entity data: all properties, all relations (outgoing + incoming), type assignments
- Saved to `.snapshots/` directory in the working directory
- Timestamped filenames (e.g., `delete-snapshot-2026-02-25T14-30-00.json`) to prevent overwrites across multiple runs

### Error handling mid-batch
- Stop immediately on any failure — do not continue deleting remaining entities
- Report what succeeded and what remains unprocessed
- Output a remaining-entities CSV file for easy re-run with unprocessed entities
- Partial entity failures (e.g., properties deleted but relations fail): report exact partial state, then halt
- Error output references the snapshot file path so user can quickly review what was lost

### Claude's Discretion
- Dry-run output format and verbosity
- Whether to suggest `--dry-run` in the confirmation prompt
- Progress reporting style (spinner, progress bar, line-by-line)
- Exact confirmation prompt wording
- Remaining-entities CSV naming convention and location

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-bulk-delete*
*Context gathered: 2026-02-25*
