# Phase 4: Delete Relations and Properties - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Delete specific relations and/or properties from entities without deleting the entities themselves. Users provide an Excel spreadsheet with relation IDs to delete and/or entity+property ID pairs to unset. The tool validates existence, builds deleteRelation and updateEntity(unset) ops, and publishes atomically.

</domain>

<decisions>
## Implementation Decisions

### Input Format
- Excel file (.xlsx) with separate tabs: one for relations, one for properties
- Reuses existing entity-id-parser pattern for reading Excel files via XLSX library

### Relations Tab
- Column: 'Relation ID' (32-char hex) — user provides the exact relation row ID
- Column: 'Space ID' (32-char hex) — same single-space-per-file constraint as delete command
- Each row = one relation to delete
- No name resolution needed — IDs are provided directly

### Properties Tab
- Columns: 'Entity ID' (32-char hex), 'Property ID' (32-char hex)
- Column: 'Space ID' (32-char hex)
- Each row unsets one property from one entity
- Uses Graph.updateEntity({ id, unset: [{ property }] }) — same as entity delete pipeline

### Scope
- Single command handles both relation deletions AND property unsets in one run
- Both tabs read, all ops (deleteRelation + updateEntity unset) published as one atomic transaction
- Empty/missing tabs are allowed — if user only wants to delete relations, properties tab can be absent

### Validation
- Validate-everything-first pattern (matches DEL-02 from entity delete)
- Verify all relation IDs exist before building ops
- Verify all entity IDs exist before building unset ops
- Fail-fast: report all invalid IDs and abort before any publishing

### CLI Design
- Subcommand name: `delete-triples` — distinct from `delete` (whole entities), accurate in knowledge-graph terminology
- Follows established pattern: dynamic import for command handler, same flag conventions
- Standard flags: --dry-run, --force, --network, --space, --output, --verbose

### Error Handling & Recovery
- Atomic publish: all ops succeed or all fail — no partial state
- No remaining-items output file needed (unlike entity delete) — atomic means nothing to retry
- No pre-operation snapshot — entities aren't being deleted, input Excel serves as the record of what was attempted
- Always save JSON report on success (consistent with delete and update commands) — includes counts and transaction hash

### Claude's Discretion
- Dry-run preview table layout and detail level
- How to validate relation ID existence via API (may need new GraphQL query)
- Report format and detail level
- Whether to create an Excel template file
- Error retry strategy (retry vs stop immediately on API failure)

</decisions>

<specifics>
## Specific Ideas

- Should feel consistent with existing delete command — same confirmation prompt pattern, same report output, same progress indicators
- Excel template similar to "Geo delete template.xlsx" but with the two-tab structure

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `entity-id-parser.ts`: parseEntityIds() reads Excel tabs with ID columns — can be extended or a new parser created alongside it
- `delete-builder.ts`: buildDeleteOps() — shows pattern for Graph.deleteRelation() and Graph.updateEntity({ unset })
- `geo-client.ts`: fetchEntityDetails() — validates entity existence, returns relations/properties
- `publisher.ts`: publishToGeo() with OperationsBatch compatibility shim pattern
- `report.ts`: saveOperationReport() — generalized report saving
- `cli-helpers.ts`: resolveNetwork(), confirmAction() — shared CLI utilities

### Established Patterns
- CLI router in cli.ts: Commander.js subcommand with dynamic import for handler
- OperationsBatch shim: zeroed BatchSummary to satisfy publishToGeo type
- Fail-fast validation: check all IDs exist before any mutations
- --force flag for non-interactive confirmation bypass
- Network resolution: flag > env > TESTNET default

### Integration Points
- cli.ts: register new subcommand alongside upsert/delete/update
- config/: new types file for command options and batch types
- processors/: new builder for constructing delete-relation and unset-property ops
- commands/: new command handler following delete.ts pattern

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-delete-relations-and-properties*
*Context gathered: 2026-03-04, updated: 2026-03-04*
