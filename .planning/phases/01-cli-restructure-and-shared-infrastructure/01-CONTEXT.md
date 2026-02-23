# Phase 1: CLI Restructure and Shared Infrastructure - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract monolithic `src/index.ts` into subcommand CLI (`geo-publish upsert|delete|update`) with shared infrastructure ready for Phases 2 and 3. Existing upsert behavior must work identically through the new architecture. Shared modules include entity detail queries, Excel parsing (all operations use Excel), and generalized reporting.

</domain>

<decisions>
## Implementation Decisions

### CLI output and feedback
- Unnumbered section headers (not "Step 1:", "Step 2:") — each operation has different step counts, numbering adds noise
- Inline counter for progress on longer operations ("Processing 12/100 entities..." on a single line)
- Structured summary block on completion — multi-line with labeled counts, transaction hash, report path
- --verbose flag stays as single toggle (no -v/-vv levels)

### Input format — all operations use Excel
- All operations (upsert, delete, update) use Excel files — no standalone CSV parser needed
- Delete takes an Excel file with Metadata tab + entity IDs tab (consistent with upsert/update pattern)
- Metadata tab provides space configuration for all operations
- Entity IDs are 32-char hex strings (e.g., `b064a55953f843af903e43b6cb75c88e`)
- Header row required in entity ID tab
- Duplicate entity IDs reject the file (validation failure, not silent dedup)
- Whitespace trimmed, blank rows silently skipped

### Flag design
- Flags are selective per subcommand — each command only gets flags that make sense for it
- Network config: GEO_NETWORK env var for default, --network flag to override
- Confirmation: interactive yes/no prompt replaces the 5-second delay
- --yes / -y flag skips confirmation (current convention kept)
- File input: positional argument (`geo-publish upsert <file>`)
- Space ID comes from Metadata tab in the Excel file (not a --space flag)

### Report format
- JSON reports saved to disk for all operations (consistent audit trail)
- Common base structure + operation-specific extensions (shared: operation type, timestamp, network, tx hash, space; per-operation: specific counts and details)
- Dry-run reports also saved to disk, clearly marked as dry-run
- Report naming: `{operation}-{timestamp}.json` (e.g., `upsert-2026-02-19T14-30-00.json`)

### Claude's Discretion
- Exact subcommand help text content and formatting
- Internal module boundaries and file organization during restructure
- GraphQL query structure for entity detail fetching
- Error message wording and formatting
- Which flags apply to which subcommands (selective per command)

</decisions>

<specifics>
## Specific Ideas

- Entity IDs look like `b064a55953f843af903e43b6cb75c88e` (32-char hex, no prefix) — use this for format validation
- "Metadata, Properties, Types tab should be added to all sheets that require it" — the spreadsheet-driven pattern is the standard, not CLI flags for config
- Delete Excel file needs: Metadata tab (space config) + entity IDs tab

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-cli-restructure-and-shared-infrastructure*
*Context gathered: 2026-02-19*
