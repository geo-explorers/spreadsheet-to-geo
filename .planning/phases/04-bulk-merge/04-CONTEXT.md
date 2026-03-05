# Phase 4: Bulk Merge - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

CLI command to bulk-merge duplicate entities from an Excel template of keeper/merger pairs. Unique properties and relations from each merger are copied onto the keeper (never overwriting existing keeper data), then the merger entity is deleted. Reuses existing delete pipeline for entity removal.

</domain>

<decisions>
## Implementation Decisions

### Input format & template
- Excel template (`.xlsx`) — consistent with upsert/update commands
- Metadata tab specifies `Operation type: MERGE` and space ID
- Merge tab has two columns: keeper entity name, merger entity name
- Entity names resolved to IDs internally (same pattern as update command)
- Multi-way merges expressed as multiple rows with the same keeper (e.g., row 1: A/B, row 2: A/C)
- Rows processed in file order
- Terminology throughout codebase: **keeper** (survives) and **merger** (gets absorbed)

### Conflict behavior
- Keeper's existing property values are never overwritten
- When keeper and merger have the same property with different values: keep keeper's value, log as conflict in report (showing both values)
- When keeper and merger have the same property with the same value: skip silently (not a conflict)
- Transfer all unique properties from merger to keeper EXCEPT the entity name — keeper's name is canonical
- Multi-value properties (e.g., "Related topics"): union the sets — add merger's unique values to keeper's existing set, skip duplicates

### Relation transfer rules
- Incoming relations (backlinks) pointing at merger are re-pointed to keeper
- Outgoing relations from merger are added to keeper
- Duplicate relation check: if keeper already has the same relation type to the same target entity, skip (never create duplicate relations) — applies to both outgoing and incoming
- Type assignments: union — add merger's types that keeper doesn't already have

### Dry-run & reporting
- Dry-run (`--dry-run`): full per-pair diff showing properties to transfer, conflicting properties (with both values), relations to re-point, duplicate relations to skip, and merger entity to be deleted
- Summary report (after execution): aggregate counts — total pairs merged, properties transferred, relations re-pointed, conflicts skipped, entities deleted (consistent with delete/update report pattern)
- Conflict details shown in console output only — no separate file
- Pre-merge snapshot: save both keeper and merger full entity state before merge (audit trail, same pattern as delete command's pre-deletion snapshot)

### Claude's Discretion
- Exact Excel template column headers and layout
- Dry-run output formatting and spacing
- Snapshot file format and location
- Internal ordering of merge operations (property transfer vs relation re-pointing)
- Error handling for partial failures within a pair

</decisions>

<specifics>
## Specific Ideas

- Multi-way merge example from roadmap: Entity A (keeper) absorbs Entity B and Entity C. Two rows in the template. A's description stays. Related topics from B and C that aren't on A get added. B and C are deleted.
- Merge should reuse the existing delete pipeline for the final merger entity deletion (Phase 2 infrastructure)
- Each merge pair published as a single atomic transaction

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-bulk-merge*
*Context gathered: 2026-03-03*
