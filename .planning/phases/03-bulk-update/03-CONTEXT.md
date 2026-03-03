# Phase 3: Bulk Update - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

CLI command (`geo-publish update spreadsheet.xlsx --space <id>`) that bulk-updates entity properties from an Excel spreadsheet using the same template format as upsert, with `Operation type: UPDATE` in the Metadata tab. Resolves entities by name, queries current state from Geo, diffs provided values against live data, and writes only what changed. Blank cells are skipped (no unset mechanism). Unsetting is out of scope for this phase.

</domain>

<decisions>
## Implementation Decisions

### Dry-run & reporting output
- Diff format is Claude's discretion — pick the most readable format based on data shape
- Build on existing `publish-report.ts` infrastructure for report generation
- Report includes both entity-level counts (X updated, Y skipped) AND property-level detail (properties overwritten, relations added/removed)
- Dry-run output behavior (terminal vs file) should match upsert's existing pattern
- Entities with zero changes appear in the report as "skipped" (not omitted silently)

### Relation handling
- Relation target format matches upsert's existing spreadsheet format
- Unresolvable relation target names hard-error the entire batch (consistent with entity name resolution)
- Relations treated as sets — order does not matter, only add/remove
- Default behavior: filled cell = complete desired final state (existing targets not listed get removed)
- `--additive` flag available to switch to additive-only mode (only add new targets, never remove)

### Error behavior & safety
- Always prompt for confirmation before applying changes (non-dry-run)
- `--yes` flag skips confirmation for CI/scripting use (`--yes` not `--force`)
- Intended scripting pattern: `--dry-run` to review, then `--yes` to apply
- Mid-batch API failures: retry 2-3 times, then stop. Align retry behavior with upsert pipeline
- All entity names AND relation targets validated upfront before any work begins
- Reuse existing upsert validation infrastructure (`validation.ts`, batch builder, etc.)

### Execution flow (four-phase pipeline)
- `validate()` — parse spreadsheet, resolve all entity names + relation targets, hard-error if anything fails
- `diff()` — query current state from Geo for all entities, compute all add/remove ops
- `confirm()` — show full per-entity diff then summary counts, prompt y/n (or `--yes` skips)
- `publish()` — send all ops to Geo
- `--dry-run` stops cleanly after `diff()` — validate and diff both ran, full output shown, nothing writes

### CLI flag surface
- `--dry-run` — run validate + diff, print output, stop before confirm/publish
- `--yes` — skip confirmation prompt (for CI/scripting)
- `--verbose` — show unchanged relation targets in diff output (~ lines, hidden by default)
- `--quiet` — suppress diff and progress, only show errors and final summary
- `--quiet` and `--verbose` are mutually exclusive — hard error if both passed
- `--additive` — relation cells only add new targets, never remove existing ones

### Claude's Discretion
- Diff output format (table, indented text, etc.) — pick most readable
- Exact progress output — match upsert behavior
- Internal batch sizing for API calls
- Retry count and backoff strategy (align with upsert)
- How the confirm step formats the diff for terminal readability

</decisions>

<specifics>
## Specific Ideas

- Pipeline mirrors upsert's phased architecture: validate → build_ops → publish, with diff as an additional phase between validate and publish
- "Whatever upsert does, update should do the same" — strong preference for consistency across commands
- The diff phase must be separate from validate because it does live API reads (querying Geo for current entity state); all reads complete before showing the curator the full picture
- Reuse existing infrastructure: `publish-report.ts`, `validation.ts`, batch builder, cell parsers

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-bulk-update*
*Context gathered: 2026-02-24*
