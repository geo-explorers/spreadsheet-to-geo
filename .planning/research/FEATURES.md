# Feature Research: Bulk Operations (Delete, Update, Merge)

**Domain:** Bulk data operations for knowledge graph entity management CLI
**Researched:** 2026-02-19
**Confidence:** HIGH (primary source is the actual SDK and codebase)

## Context

This tool already has a working `publish` (upsert/create) command. This research covers the features needed for three new commands: `delete`, `update`, and `merge`. The tool processes spreadsheets/CSVs prepared by editors and run by engineers against the Geo protocol's GRC-20 knowledge graph.

**Key constraint:** Geo stores data as triples. An "entity" is not a single row -- it is a collection of triples: property values (entity-property-value), relations (entity-relation-entity), and type assignments (entity-types-type). Deleting an entity means deleting ALL of these triples. Merging means transferring triples from one entity to another.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these means the operation is broken or dangerous.

#### Delete Command

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| CSV input of entity IDs | Engineers have entity IDs from Geo browser; simplest possible input | LOW | Single column CSV, one ID per row |
| Validate entity IDs exist before deleting | Deleting a non-existent entity wastes a transaction and confuses the operator | MEDIUM | Requires GraphQL query per entity to confirm existence |
| Delete all property triples for entity | Orphan property values pollute the graph; partial delete is worse than no delete | MEDIUM | Must query entity's valuesList to discover all properties, then unset each |
| Delete all outgoing relations | Relations FROM the entity must be removed or they point from nothing | MEDIUM | Must query entity's relations where entity is `from`, then deleteRelation for each |
| Delete all incoming relations | Relations TO the entity must be removed or they point to nothing | HIGH | This is the hard part: must find relations where this entity is the `to` target. The GraphQL API returns relations grouped by `from` entity, not `to` entity. Need a reverse lookup strategy. |
| Delete type assignment relations | Type assignments are relations (entity -> type via TYPES_PROPERTY); must be cleaned up | MEDIUM | These are outgoing relations with a specific relation type ID |
| Delete the entity itself | The actual `deleteEntity` op | LOW | `Graph.deleteEntity({ id })` -- trivial |
| Dry-run mode | Engineers must preview what will be deleted before committing an irreversible action | LOW | Already exists for publish; same pattern |
| Deletion summary report | Operator needs to verify counts: X entities deleted, Y relations removed, Z properties unset | LOW | Follow existing report pattern |
| Space-scoped deletion | Entities live in spaces; must target the correct space | LOW | Already handled by publish flow (spaceId from env or argument) |

#### Update Command

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Same spreadsheet format as publish | Editors already know the format; retraining is expensive and error-prone | LOW | Reuse existing Excel parser with Metadata/Types/Properties/Entity tabs |
| Overwrite existing property values | The core purpose of update -- set new values on existing entities | MEDIUM | Use `Graph.updateEntity({ id, values })` with set semantics |
| Resolve entities by ID (not name) | Updates MUST target the right entity; name matching is ambiguous for updates | MEDIUM | Entity tabs need an "Entity ID" or "Geo ID" column. This is a deliberate departure from publish (which uses name matching) because updates on the wrong entity are destructive. |
| Type-aware value conversion | Values in spreadsheet (strings) must be converted to typed SDK values (text, integer, float, date, etc.) | LOW | Already implemented in batch-builder.ts `convertToTypedValue()` |
| Validate entity IDs exist before updating | Updating a non-existent entity silently fails or creates garbage | MEDIUM | GraphQL lookup per entity ID |
| Property ID resolution | Spreadsheet uses property names; SDK needs property IDs | LOW | Already implemented in entity-processor.ts |
| Dry-run mode | Preview changes before committing | LOW | Existing pattern |
| Update summary report | Show what was changed: X entities updated, Y properties set | LOW | Follow existing pattern |

#### Merge Command

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| CSV input with keeper_id and merger_id columns | Two-column CSV is the simplest way to express merge pairs | LOW | Simple CSV parse |
| Validate both entities exist | Merging non-existent entities is nonsensical | MEDIUM | GraphQL lookup for both keeper and merger |
| Copy properties from merger to keeper (no overwrite) | Merge means "combine information"; overwriting the keeper's existing data defeats the purpose | HIGH | Must query both entities' properties, diff them, and only set values where keeper has no value for that property |
| Copy relations from merger to keeper | Relations pointing to/from merger should be re-pointed to keeper | HIGH | Must discover all relations (incoming and outgoing) on merger, create equivalent relations on keeper, delete originals |
| Delete merger entity after transfer | The merger ceases to exist once its data is transferred | MEDIUM | Same as delete command, but runs after transfer |
| Dry-run mode | Preview the merge: what properties will transfer, what relations will re-point | LOW | Existing pattern |
| Merge summary report | Show: X properties transferred, Y relations re-pointed, Z merger entities deleted | LOW | Follow existing pattern |

### Differentiators (Competitive Advantage)

Not required for the operations to work, but significantly improve the experience for operators.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Batch operation progress reporting | For 500+ entity deletes, silence is terrifying; show "Processing 47/523..." | LOW | Simple counter in the processing loop |
| Entity name display in confirmations | "Deleting entity abc123" means nothing; "Deleting entity 'Sam Altman' (abc123)" helps the operator verify | MEDIUM | Requires querying entity names during validation, but dramatically improves trust |
| Relation impact preview for deletes | "This delete will also remove 14 relations from 8 other entities" prevents surprise collateral damage | MEDIUM | Count relations during the pre-delete query phase |
| Merge conflict detection | "Keeper already has 'Date of Birth' = 1985-05-22; merger has 'Date of Birth' = 1985-06-22 -- SKIPPING (keeper wins)" | MEDIUM | Property-level diff during merge; log conflicts for human review |
| Undo report generation | Generate a CSV/report that could theoretically reverse the operation (entity IDs + their data before deletion) | MEDIUM | Snapshot entity data before delete/merge; write to report file. Not automatic undo, but an audit trail. |
| Entity ID validation format check | Reject obviously malformed IDs (wrong length, non-hex) before hitting the API | LOW | `Id()` from geo-sdk already validates format; use `assertValid()` |
| Colorized CLI output for destructive ops | Red warnings for delete, yellow for merge, green for dry-run safe | LOW | Already using chalk in the existing tool |
| Batch transaction splitting | If a batch has 500 entities worth of ops, the IPFS payload or transaction may be too large; split into multiple transactions | HIGH | Need to understand Geo's transaction size limits. The existing publish sends all ops in one transaction. |
| Idempotent re-runs | If a delete/update/merge partially fails, re-running should skip already-processed entities | HIGH | Would require tracking state between runs (e.g., a checkpoint file). Complex but valuable for large batches. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Recursive/cascade delete | "Delete this entity and everything it relates to" | Cascade logic in a knowledge graph is unbounded -- one entity may relate to thousands of others through chains. Accidentally cascading through "Country" could delete half the graph. | Delete only the specified entities. Let the operator prepare the full list of entity IDs explicitly. |
| Undo/rollback command | "I made a mistake, reverse this" | Geo is blockchain-based (onchain transactions). There is no native rollback. Generating reverse operations is theoretically possible but extremely fragile -- the graph may have changed between the original operation and the undo attempt. | Generate pre-operation snapshots as reports. If something goes wrong, the operator can manually reconstruct using the snapshot data. |
| Update by entity name (fuzzy matching) | "Just find 'Sam Altman' and update it" | Name matching is inherently ambiguous. There could be multiple entities named "Sam Altman" in different spaces. For a destructive operation like update, ambiguity = data corruption. | Require entity IDs for updates. IDs are unambiguous. Editors can get IDs from the Geo browser. |
| Merge by name matching | "Merge all entities named the same thing" | Same ambiguity problem as above, but worse: automatic name-based merging could merge entities that happen to share a name but represent different things (e.g., two different people named "John Smith"). | Require explicit keeper_id/merger_id pairs. A human must decide which entities to merge. |
| Auto-detect merge candidates | "Find duplicate entities for me" | Deduplication is a complex NLP/heuristic problem. False positives cause data loss. This is a completely different tool (entity resolution / record linkage) with its own research area. | Out of scope. If needed, build a separate deduplication tool that outputs a CSV of merge candidates for human review, which then feeds into this merge command. |
| Selective property delete | "Delete only the 'Date of Birth' property from these entities" | This is actually an update (unset) operation, not a delete. Conflating the two confuses operators. | Use the update command with blank/empty values, or add an `unset` sub-command later if demand warrants it. |
| GUI/interactive mode | "Show me the entity and let me pick what to delete" | This is a CLI tool run by engineers in batch mode. Interactive UIs belong in the Geo browser, which already exists. | Keep the CLI batch-oriented. The Geo browser handles interactive editing. |
| Cross-space operations | "Delete this entity from all spaces" | Entities exist in specific spaces with specific governance (personal vs DAO). Cross-space operations bypass governance and violate space ownership. | One space per command invocation. The operator must run separate commands for separate spaces. |

---

## Feature Dependencies

```
[Entity ID validation]
    +--requires--> [GraphQL entity lookup by ID]
                       +--requires--> [Extended geo-client.ts with ID-based queries]

[Delete command]
    +--requires--> [Entity ID validation]
    +--requires--> [Query all triples for entity]
    +--requires--> [Query incoming relations]  (HARDEST PART)
    +--requires--> [Batch op builder for delete ops]
    +--requires--> [Publisher (already exists)]

[Update command]
    +--requires--> [Entity ID validation]
    +--requires--> [Excel parser (already exists)]
    +--requires--> [Property ID resolution (already exists)]
    +--requires--> [Value type conversion (already exists)]
    +--requires--> [Batch op builder for update ops]
    +--requires--> [Publisher (already exists)]

[Merge command]
    +--requires--> [Query all triples for entity]  (shared with delete)
    +--requires--> [Query incoming relations]  (shared with delete)
    +--requires--> [Property diff logic]  (new)
    +--requires--> [Relation transfer logic]  (new)
    +--requires--> [Delete command logic]  (for deleting merger after transfer)
    +--requires--> [Publisher (already exists)]
```

### Dependency Notes

- **Query incoming relations is the critical shared dependency.** Both delete and merge need to find all relations WHERE the entity is the `to` target. The current GraphQL API (as seen in geo-client.ts and hypergraph source) returns relations grouped by the `from` entity. Finding incoming relations requires either: (a) a GraphQL query that supports filtering relations by `to` entity, or (b) querying all relations in the space and filtering client-side. This needs investigation during implementation.
- **Update is the most independent command** -- it reuses the most existing code (parser, property resolution, value conversion) and adds the least new infrastructure.
- **Merge depends on delete** -- after transferring data, the merger entity is deleted using the same logic as the delete command.
- **Entity ID validation is shared by all three commands** -- build it once as a utility.

---

## MVP Definition

### Launch With (v1)

These are the operations that must work correctly or the tool cannot be used.

- [ ] **Delete command** with CSV input of entity IDs -- validates existence, removes all triples (properties, outgoing relations, type assignments), deletes entity. Dry-run mode.
- [ ] **Update command** with Excel input (same format as publish, plus entity ID column) -- validates entity existence, overwrites property values. Dry-run mode.
- [ ] **Merge command** with CSV input of keeper_id/merger_id pairs -- validates both exist, copies non-conflicting properties and relations from merger to keeper, deletes merger. Dry-run mode.
- [ ] **Entity ID-based GraphQL queries** -- look up entity by ID to get name, properties, relations (the query infrastructure all three commands need).
- [ ] **Summary reports** for all three operations (counts of what was affected).

### Add After Validation (v1.x)

Features to add once the core operations are proven correct on real data.

- [ ] **Merge conflict report** -- log when keeper already has a value that merger also has, showing both values. Triggered by real-world merge runs exposing ambiguous cases.
- [ ] **Batch progress reporting** -- add when operators run batches of 100+ and report that silence is stressful.
- [ ] **Entity name display** in all confirmations and reports -- add once the entity-by-ID query is stable and we can afford the extra API calls.
- [ ] **Pre-operation snapshot** (undo report) -- add when the team wants an audit trail for governance reviews.

### Future Consideration (v2+)

Features to defer until the tool is battle-tested on real datasets.

- [ ] **Batch transaction splitting** -- defer until we hit actual transaction size limits. The existing publish command sends everything in one transaction and it works for batches up to 500.
- [ ] **Idempotent re-runs** with checkpoint files -- defer until operators report partial failures on large batches.
- [ ] **Incoming relation discovery** improvements -- if the initial approach (querying relations by `to` entity) is too slow or incomplete, revisit with a more sophisticated strategy.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Delete: entity + all triples | HIGH | MEDIUM | P1 |
| Delete: dry-run | HIGH | LOW | P1 |
| Delete: validate IDs exist | HIGH | MEDIUM | P1 |
| Update: overwrite properties via spreadsheet | HIGH | MEDIUM | P1 |
| Update: entity ID column (not name matching) | HIGH | LOW | P1 |
| Update: dry-run | HIGH | LOW | P1 |
| Merge: copy properties (no overwrite) | HIGH | HIGH | P1 |
| Merge: transfer relations | HIGH | HIGH | P1 |
| Merge: delete merger after | HIGH | MEDIUM | P1 |
| Merge: dry-run | HIGH | LOW | P1 |
| Entity ID-based GraphQL queries | HIGH | MEDIUM | P1 |
| Summary reports (all commands) | MEDIUM | LOW | P1 |
| Query incoming relations | HIGH | HIGH | P1 |
| Entity name display in output | MEDIUM | LOW | P2 |
| Batch progress reporting | MEDIUM | LOW | P2 |
| Merge conflict detection/logging | MEDIUM | MEDIUM | P2 |
| Pre-operation snapshot/audit | LOW | MEDIUM | P3 |
| Batch transaction splitting | LOW | HIGH | P3 |
| Idempotent re-runs | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

This is a domain-specific tool for Geo protocol, not a general-purpose product with competitors. However, the patterns come from established domains:

| Feature | SPARQL triple stores (e.g., Blazegraph, Stardog) | ETL tools (e.g., dbt, Airbyte) | Our Approach |
|---------|---------------------------------------------------|----------------------------------|--------------|
| Bulk delete | `DELETE WHERE { ?s ?p ?o . FILTER(?s = <id>) }` -- deletes all triples for subject | N/A (row-based) | Query all triples via GraphQL, generate deleteRelation + deleteEntity ops |
| Bulk update | `DELETE/INSERT WHERE` pattern -- atomic replace | Upsert semantics, overwrite by key | `updateEntity` with set semantics (overwrite specified properties) |
| Entity merge | `CONSTRUCT` to copy + `DELETE` source -- manual multi-step | SCD Type 2, merge keys | Query both entities, diff properties, copy missing, re-point relations, delete source |
| Dry-run | SPARQL has `ASK` queries; no native dry-run | Most tools have `--dry-run` | Generate ops but skip publish step (existing pattern) |
| Incoming relation handling | `?x ?p <target>` query is native | Foreign key lookups | Need GraphQL query for relations with `toEntity` filter -- verify API supports this |

---

## SDK Operation Mapping (Source of Truth)

Based on reading the actual geo-sdk source at `submodules/geo-sdk/src/graph/`:

| Operation | SDK Function | Inputs | Op Type Generated |
|-----------|-------------|--------|-------------------|
| Delete entity | `Graph.deleteEntity({ id })` | Entity ID | `deleteEntity` |
| Delete relation | `Graph.deleteRelation({ id })` | Relation ID | `deleteRelation` |
| Update entity properties | `Graph.updateEntity({ id, name?, description?, values?, unset? })` | Entity ID + property values | `updateEntity` (set + unset) |
| Create relation (for merge) | `Graph.createRelation({ fromEntity, toEntity, type })` | From ID, To ID, Relation type ID | `createRelation` |
| Update relation metadata | `Graph.updateRelation({ id, position?, fromSpace?, toSpace? })` | Relation ID + metadata | `updateRelation` |

**Critical finding:** The SDK's `deleteEntity` only generates one op that deletes the entity node itself. It does NOT automatically delete associated relations or property values. The tool must explicitly query for and delete all associated triples before calling `deleteEntity`. This is the standard pattern in triple-store systems where "delete entity" means "delete all triples where this entity is subject or object, then delete the entity."

**Critical finding for merge:** The SDK has no "move relation" primitive. To transfer a relation from merger to keeper, you must: (1) create a new relation on keeper with the same type and target, (2) delete the old relation on merger. This is a two-op replacement per relation.

---

## Open Questions Requiring Implementation-Time Research

1. **Can the GraphQL API query relations by `toEntity` (incoming relations)?** The current geo-client.ts only searches by entity name. The hypergraph source shows relations are queried by `from` entity. Need to test whether the API supports `filter: { toEntityId: { is: $id } }` or similar. If not, an alternative strategy is needed (query all relations in the space and filter client-side).

2. **What is the maximum number of ops per transaction?** The existing publish command sends all ops in one transaction. For a delete of an entity with 50 properties and 30 relations, that is 80+ ops just for one entity. For a batch of 100 such entities, that is 8000+ ops. Need to verify the transaction size limit.

3. **Are entity IDs hex UUIDs or base58?** The SDK uses `Id()` wrapper and `toGrcId()` conversion. The GraphQL API appears to use UUID format. Need to verify the exact format for CSV input validation.

---

## Sources

- `submodules/geo-sdk/src/graph/delete-entity.ts` -- deleteEntity SDK function (HIGH confidence)
- `submodules/geo-sdk/src/graph/delete-relation.ts` -- deleteRelation SDK function (HIGH confidence)
- `submodules/geo-sdk/src/graph/update-entity.ts` -- updateEntity SDK function with set/unset (HIGH confidence)
- `submodules/geo-sdk/src/graph/update-relation.ts` -- updateRelation SDK function (HIGH confidence)
- `submodules/geo-sdk/src/graph/create-relation.ts` -- createRelation SDK function (HIGH confidence)
- `submodules/geo-sdk/src/types.ts` -- All type definitions for params and results (HIGH confidence)
- `submodules/hypergraph/packages/hypergraph/src/entity/delete.ts` -- Hypergraph's local delete pattern (HIGH confidence)
- `submodules/hypergraph/packages/hypergraph/src/entity/find-one-public.ts` -- Entity query with valuesList and relations (HIGH confidence)
- `submodules/hypergraph/packages/hypergraph/src/entity/getEntityRelations.ts` -- Relation traversal from entity (HIGH confidence)
- `src/api/geo-client.ts` -- Current GraphQL query patterns (HIGH confidence)
- `src/processors/batch-builder.ts` -- Current op building patterns (HIGH confidence)
- `src/publishers/publisher.ts` -- Current publish flow (HIGH confidence)
- Knowledge graph bulk operation patterns from SPARQL/triple-store domain knowledge (MEDIUM confidence -- training data, not verified against current Geo docs)

---
*Feature research for: Geo protocol bulk operations (delete, update, merge)*
*Researched: 2026-02-19*
