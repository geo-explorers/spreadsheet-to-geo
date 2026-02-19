# Pitfalls Research

**Domain:** Bulk data operations on Geo protocol knowledge graph (delete, update, merge)
**Researched:** 2026-02-19
**Confidence:** HIGH (derived from direct source code analysis of Geo SDK, Hypergraph API, and existing codebase)

## Critical Pitfalls

### Pitfall 1: Incomplete Entity Deletion Leaves Orphaned Triples

**What goes wrong:**
The Geo SDK's `deleteEntity()` generates a single `deleteEntity` op (see `submodules/geo-sdk/src/graph/delete-entity.ts:17-21`). However, Geo stores entities as a network of triples: property values, type assignments (via `TYPES_PROPERTY` relations), relations where the entity is the `from` node, and relations where the entity is the `to` node (backlinks). Calling `deleteEntity` alone does NOT automatically cascade-remove all associated triples. The entity node disappears but its relations, property values, and type assignments may persist as orphans in the knowledge graph -- permanently, since blockchain operations are irreversible.

**Why it happens:**
Developers see `Graph.deleteEntity({ id })` and assume it handles cleanup like a SQL `CASCADE DELETE`. The SDK's `deleteEntity` is deliberately atomic -- it deletes only the entity record itself. This is visible in the source: it produces exactly 1 op of type `deleteEntity` with just the entity ID. The Hypergraph local delete function (`submodules/hypergraph/packages/hypergraph/src/entity/delete.ts:7-26`) shows the correct pattern: it deletes the entity AND iterates `doc.relations` to remove all relations where `relation.from === id`. Even Hypergraph only handles outgoing relations, not incoming ones.

**How to avoid:**
Before generating the `deleteEntity` op, the tool must:
1. Query the Geo API for ALL relations where the entity is `from` (outgoing) -- these include type assignments (`TYPES_PROPERTY` = `8f151ba4de204e3c9cb499ddf96f48f1`), cover relations, and user-defined relations
2. Query for ALL relations where the entity is `to` (incoming/backlinks) -- other entities pointing to this one
3. Generate `deleteRelation` ops for every discovered relation (using `Graph.deleteRelation({ id: relationId })`)
4. Optionally generate `updateEntity` with `unset` ops for all property values (the SDK supports `unset` with `language: 'all'` as shown in `update-entity.test.ts:376-402`)
5. Generate the `deleteEntity` op LAST

The operation ordering within the batch matters: relation deletions must precede entity deletion.

**Warning signs:**
- Dry-run output shows entity delete ops without corresponding relation delete ops
- Delete operation count equals entity count (should be many times higher -- each entity typically has 2-10+ relations)
- After publishing, the Geo Browser still shows relations pointing to deleted entities

**Phase to address:**
Phase 1 (Delete implementation). This is the foundational correctness requirement for delete. Get this wrong and every delete permanently corrupts the knowledge graph.

---

### Pitfall 2: Missing Relation Discovery -- API Cannot Return All Relations for an Entity

**What goes wrong:**
The existing GraphQL API client (`src/api/geo-client.ts`) only supports searching entities by name. It does not have a query that returns all relations (both outgoing and incoming) for a given entity ID. The Hypergraph `find-one-public.ts` query fetches `valuesList` and typed relations, but only for relations whose types are known ahead of time via schema annotations. For delete, you need ALL relations regardless of type -- including backlinks (incoming relations from other entities). Without this, the delete operation will miss relations and leave orphans.

**Why it happens:**
The current tool was built for CREATE operations only -- it never needed to discover what already exists on an entity. The Geo API GraphQL schema supports `relations` and `backlinks` fields on entities (visible in `relation-query-helpers.ts:88-89` which shows both `relations` and `backlinks` connection fields), but the current `geo-client.ts` has no query for fetching these.

**How to avoid:**
Build a new API query function (e.g., `fetchEntityTriples(entityId, spaceId, network)`) that queries:
```graphql
query EntityTriples($id: UUID!, $spaceId: UUID!) {
  entity(id: $id) {
    id
    name
    valuesList(filter: {spaceId: {is: $spaceId}}) {
      propertyId
      text
      boolean
      float
      datetime
      point
      schedule
    }
    relations(filter: {spaceId: {is: $spaceId}}) {
      nodes {
        id
        typeId
        toEntity { id name }
        entity { id }
      }
    }
    backlinks(filter: {spaceId: {is: $spaceId}}) {
      nodes {
        id
        typeId
        fromEntity { id name }
        entity { id }
      }
    }
  }
}
```
This query returns outgoing relations, incoming relations (backlinks), and all property values. All of these must be removed before deleting the entity.

**Warning signs:**
- Delete dry-run for an entity shows 0 relations to delete (unlikely for any real entity)
- Entity has type assignments visible in Geo Browser but no type-removal ops in the batch
- After delete, searching the space still returns the entity name in relation target lists of other entities

**Phase to address:**
Phase 1 (Delete). This API enhancement is a prerequisite for correct delete. Must be built and tested before any delete operations ship.

---

### Pitfall 3: Merge Overwrites Keeper Data Instead of Preserving It

**What goes wrong:**
The merge operation must copy data from the "merger" entity to the "keeper" entity, but ONLY for properties/relations that the keeper does not already have. The SDK's `updateEntity()` uses a `set` operation that overwrites the property value regardless of what exists (`submodules/geo-sdk/src/graph/update-entity.ts:224-228`). If you naively set all merger properties onto the keeper, you will overwrite the keeper's existing values -- permanently and irreversibly. This violates the merge contract: "keeper's existing data takes precedence."

**Why it happens:**
The SDK `updateEntity` has a `set` array that sets values unconditionally. There is no "set if not exists" primitive. Developers may iterate merger's properties and call `updateEntity` with all of them, not realizing this overwrites the keeper's data.

**How to avoid:**
The merge operation must implement a 3-step process:
1. **Query keeper's current state** (all property values via `valuesList`) to discover what the keeper already has
2. **Query merger's current state** (all property values and relations)
3. **Diff**: For each property on the merger, check if the keeper already has a value for the same property ID. Only include the merger's value in the `set` array if the keeper does NOT have that property. For relations, check if the keeper already has an equivalent relation (same type and target entity) before creating a new one.

The critical insight: this diffing must happen at the property ID level (not property name level), since the same property might have different values per language slot.

**Warning signs:**
- Merge dry-run shows `updateEntity` ops with `set` values that include properties the keeper already has
- After merge, keeper's property values changed to merger's values (data loss)
- No API query step visible before the merge ops are generated

**Phase to address:**
Phase 3 (Merge). This requires both the API query from Pitfall 2 and correct diffing logic. Must have comprehensive test coverage with dry-run validation.

---

### Pitfall 4: Update Uses Append-Style Upsert Instead of Overwrite Semantics

**What goes wrong:**
The existing `buildOperationsBatch` in `src/processors/batch-builder.ts` uses `Graph.createEntity()` which creates new entities and adds property values. For update, the tool needs to use `Graph.updateEntity()` which has different semantics: it can `set` (overwrite) and `unset` (remove) property values. If the update implementation reuses the create path, it will attempt to create duplicate entities (failing or creating garbage data), or it will add new property values without removing old ones, resulting in stale data remaining on the entity alongside new data.

**Why it happens:**
The existing codebase has a single pipeline path through `buildOperationsBatch` designed for creation. Developers may try to adapt it for updates by changing a few flags, but the fundamental operation type must change from `createEntity` to `updateEntity`. The SDK's `updateEntity` requires an existing entity ID and uses `set`/`unset` semantics (visible in `update-entity.ts:56` and the test file showing `unset` operations).

**How to avoid:**
Build a separate `buildUpdateOperationsBatch()` that:
1. Takes entity IDs from the spreadsheet (update spreadsheet must include Geo IDs, unlike the create spreadsheet)
2. For each entity, calls `Graph.updateEntity({ id, values: [...], unset: [...] })` instead of `Graph.createEntity()`
3. For properties being changed: use `set` to overwrite with new value
4. For properties being removed (empty cell in spreadsheet): use `unset` with `language: 'all'` to clear the value
5. For properties not mentioned in the spreadsheet: leave them alone (do not unset)

The `unset` capability is critical -- it is how you remove a property value. Without it, "clearing" a field means leaving old data permanently. The SDK supports `unset` per property with language granularity (see `types.ts:120-124` for `UnsetPropertyParam`).

**Warning signs:**
- Update operations generate `createEntity` ops instead of `updateEntity` ops
- After update, entities have both old and new property values visible
- Empty cells in spreadsheet do not result in `unset` operations in the batch
- Spreadsheet format for updates lacks a Geo ID column

**Phase to address:**
Phase 2 (Update). This requires a new batch builder path and a modified spreadsheet format (entity IDs required for update, unlike create).

---

### Pitfall 5: Relation Entity IDs Not Retrieved -- Cannot Delete What You Cannot Reference

**What goes wrong:**
In Geo, each relation is itself an entity with its own ID (visible in `create-relation.ts:92-100` where both a `relationId` and an `entityId` are generated per relation). To delete a relation, you need the relation's ID, not the from/to entity IDs. The existing codebase never stores or queries relation IDs -- it only stores entity IDs in the entity map. For delete and merge operations, you need the actual relation IDs to generate `deleteRelation` ops.

**Why it happens:**
The create flow generates relation IDs at creation time but never records them. The API search queries return entity data but not the IDs of relations. Developers may assume they can reconstruct relation IDs from the from/to entity pair, but relation IDs are randomly generated UUIDs assigned at creation time -- they cannot be derived.

**How to avoid:**
The entity query for delete/merge must explicitly request relation node IDs:
```graphql
relations(filter: {spaceId: {is: $spaceId}}) {
  nodes {
    id          # THIS is the relation ID needed for deleteRelation
    typeId
    toEntity { id }
    entity { id }  # This is the relation's entity (the "junction" entity)
  }
}
```
Both the relation `id` and the relation's `entity.id` may need to be deleted. The `entity` field represents the "junction entity" that can hold metadata about the relationship (e.g., marriage date as described in `system.ts:126-133`).

Store these IDs in the pre-delete query results and use them to generate `deleteRelation` ops.

**Warning signs:**
- Code attempts to delete relations by constructing IDs from from/to entity pairs (IDs cannot be derived this way)
- `deleteRelation` ops reference entity IDs instead of relation IDs
- API query for entity data does not include relation node IDs

**Phase to address:**
Phase 1 (Delete). This is part of the same API enhancement as Pitfall 2. The relation discovery query must return relation IDs.

---

### Pitfall 6: Transaction Size Limits -- Large Batch Delete/Merge Exceeds IPFS or Chain Capacity

**What goes wrong:**
Deleting a single entity can generate 10-30+ ops (1 deleteEntity + N deleteRelation for each outgoing + incoming relation + property unsets). For a batch of 500 entities, this could mean 5,000-15,000+ ops in a single edit. The SDK's `publishEdit` (`src/ipfs.ts:54-89`) encodes all ops into a single protobuf binary, uploads to IPFS, and submits one transaction. There may be size limits on:
1. The IPFS upload endpoint (server may reject oversized blobs)
2. The protobuf binary encoding (memory usage during encoding)
3. The on-chain calldata (blockchain gas limits on transaction size)

The current codebase has NO size checking (confirmed in `CONCERNS.md`: "No size limits on operations batch").

**Why it happens:**
The existing tool was designed for create-only batches where each entity generates 3-5 ops. Delete generates far more ops per entity because each entity's entire triple graph must be dismantled. Developers may not anticipate this multiplication factor.

**How to avoid:**
1. After building the full ops array, check its length against a conservative limit (e.g., 1000 ops per batch -- this needs empirical testing)
2. If the batch exceeds the limit, automatically split into multiple sequential edits
3. For delete, each sub-batch must be self-consistent: do not split an entity's deletion across batches (all relation deletes + entity delete for one entity must be in the same batch)
4. For merge, the keeper update and merger delete should be in the same batch to maintain consistency
5. Implement a `--batch-size` CLI flag with a sensible default

The full-flow test in the SDK (`full-flow-test.test.ts`) shows a single edit with create + update ops. It uses a 60-second timeout, suggesting larger edits may take significant time.

**Warning signs:**
- Dry-run shows 5000+ ops in a single batch
- IPFS upload fails with timeout or size rejection
- Transaction submission fails with gas estimation errors
- Partial entity deletions (some relations deleted, entity not deleted) due to split batches

**Phase to address:**
Phase 1 (Delete), with refinement in Phase 3 (Merge). Implement batch splitting from the start. Do not defer this -- a single failed large transaction permanently executes partial operations.

---

### Pitfall 7: Merge Requires Both API Query AND Delete -- Broken Merge Is Worse Than No Merge

**What goes wrong:**
Merge is a compound operation: (1) copy merger's data to keeper, then (2) fully delete the merger entity. If step 1 succeeds but step 2 fails (e.g., batch split, transaction failure), you have duplicated data with both entities still alive. If step 2 succeeds but step 1 fails, you have deleted data without preserving it. Because blockchain operations are irreversible, a partial merge is permanent data corruption.

**Why it happens:**
Merge is the most complex operation: it requires querying two entities, diffing their data, generating update ops for the keeper, generating full delete ops for the merger (including all relation cleanup per Pitfall 1), and publishing all of these as a single atomic batch. Developers may try to implement it as two separate transactions for simplicity.

**How to avoid:**
1. **All merge ops for a single merge pair MUST be in the same edit batch.** This means the keeper update ops and the merger delete ops are published in a single `publishEdit` call, making them atomic at the blockchain level.
2. If the combined ops exceed batch size limits (Pitfall 6), the tool should refuse to merge those entities in a single run rather than splitting across transactions.
3. Implement an explicit validation step: after generating merge ops, verify that the keeper's final state (current values + merger values) is correct before publishing.
4. Dry-run must show BOTH the keeper updates AND the merger deletion, not just one.
5. Add a `--merge-max-batch-size` flag that errors out if a merge pair generates too many ops, rather than silently splitting.

**Warning signs:**
- Merge ops are split across multiple `publishEdit` calls
- Dry-run only shows keeper updates without merger deletion (or vice versa)
- Merge pair where merger has 50+ relations generates a batch that might exceed limits

**Phase to address:**
Phase 3 (Merge). This is the culmination of delete + update functionality. Merge should be the LAST operation implemented because it depends on both being correct.

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Reusing `createEntity` path for updates by wrapping it | Faster initial implementation | Wrong semantics (append vs overwrite), impossible to unset values, creates duplicate entity ops | Never -- `updateEntity` has fundamentally different op structure |
| Skipping backlink (incoming relation) cleanup on delete | Simpler API query (only outgoing relations) | Orphaned incoming relations permanently point to deleted entities, corrupting other entities' data | Never -- the Hypergraph delete function itself only handles outgoing relations (`delete.ts:17-19`), showing this is an easy trap |
| Not querying current entity state before merge | Fewer API calls | Silently overwrites keeper values with merger values (permanent data loss) | Never -- this violates the core merge contract |
| Hardcoding batch size limits without empirical testing | Ship faster | May be too conservative (slow) or too generous (failures) | Only as initial default with `--batch-size` override flag |
| Using entity name matching instead of entity ID for update/delete targets | Easier spreadsheet format (users don't need IDs) | Name collisions across spaces, wrong entity updated/deleted. Geo has many entities with identical names in different spaces | Never for delete/update. Names are not unique identifiers in Geo. |

## Integration Gotchas

Common mistakes when connecting to the Geo SDK and API.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `Graph.deleteEntity()` | Assuming it cascade-deletes relations | It generates 1 op (`deleteEntity`). You must explicitly generate `deleteRelation` ops for all relations first. |
| `Graph.updateEntity()` | Only using `set` without `unset` | Clearing a property requires an explicit `unset` op with `{ property: propId, language: 'all' }`. Empty `set` array does nothing. |
| `Graph.deleteRelation()` | Passing entity ID instead of relation ID | Relations have their own IDs separate from the entities they connect. Must query API for the actual relation IDs. |
| `personalSpace.publishEdit()` | Assuming empty ops array is a no-op | The SDK throws `'ops in publishEdit must not be empty'` (see `ipfs.ts:57-59`). Guard against empty batches. |
| GraphQL API `relations` field | Querying only `relations` and missing backlinks | `relations` returns outgoing relations only. Use `backlinks` field for incoming relations pointing to this entity. |
| GraphQL API `valuesList` | Querying without spaceId filter | `valuesList` returns values from all spaces unless filtered. For space-scoped operations, always filter by `spaceId`. |
| Relation creation in `createEntity` | Assuming types are properties on the entity | Types are actually relations (`TYPES_PROPERTY` = `8f151ba4de204e3c9cb499ddf96f48f1`) from entity to type entity. Deleting an entity's type means deleting this relation. |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| One API query per entity for delete pre-fetch | Delete of 500 entities takes 500 sequential API calls (minutes of wait time) | Batch API queries: fetch multiple entities' relations in parallel (batches of 20, like existing entity search) | At 50+ entities -- each query is ~200ms, so 50 entities = 10+ seconds, 500 = 100+ seconds |
| Single edit batch for all ops | IPFS upload timeout, gas limit exceeded on-chain | Split into sub-batches of 500-1000 ops each. Keep entity-level atomicity (all ops for one entity in same batch). | At 200+ entities with relations -- typical entity has 5-10 relations, so 200 entities = 1000-2000 ops |
| Synchronous relation discovery (query outgoing, then query incoming) | Double the query time | Use `Promise.all()` to query both `relations` and `backlinks` in parallel for each entity | Noticeable at 20+ entities |
| Re-querying already-fetched entities during merge | Merge queries both keeper and merger, but keeper may have been queried during earlier operations | Cache entity data within a session. The tool already does entity map caching for creates. | At 100+ merge pairs |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Deleting entities without user confirmation of entity contents | User provides list of IDs. Tool deletes them. But a typo in an entity ID means deleting the wrong entity permanently. | Dry-run must display entity names, types, and relation counts for EACH entity being deleted. Require explicit `--confirm-irreversible` flag for non-dry-run delete. |
| Merge without verifying both entities exist and are in the same space | Merge with a non-existent keeper ID creates orphan operations. Merge across spaces may violate permissions. | Validate both keeper and merger exist in the target space before generating any ops. Fail early. |
| Publishing delete batch to wrong network (testnet vs mainnet) | Permanently deleting production data when testing | Default to TESTNET (existing behavior). For MAINNET delete/merge, require explicit `--network MAINNET --confirm-irreversible` double flag. |
| Not validating entity IDs in CSV input | Malformed IDs (wrong length, non-hex) could generate invalid ops that fail on-chain but after IPFS upload | Use existing `assertValid()` from SDK (`id-utils.ts`) to validate every entity ID from CSV input before generating any ops. The SDK already validates in `deleteEntity()`, but validate earlier for better errors. |

## UX Pitfalls

Common user experience mistakes for CLI bulk operations.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Delete dry-run that only shows entity count, not details | User cannot verify they are deleting the right entities | Show entity name, ID, type, and relation count for each entity. For large batches, show first 20 + "and N more" with option to see full list. |
| Merge without showing what data will be copied vs preserved | User cannot verify merge will not overwrite keeper data | Dry-run must show a diff: "COPY from merger: [properties]" vs "KEEP on keeper: [properties]" vs "CONFLICT (keeper wins): [properties]" |
| No progress indicator for large operations | User thinks tool is frozen during 500-entity delete (which requires 500+ API queries + batch construction) | Show progress bar or counter: "Fetching entity data: 42/500..." then "Building delete ops: 42/500..." then "Publishing batch 1/3..." |
| Silent skipping of entities that cannot be found | User provides 100 IDs, 5 are not found, tool deletes the other 95 silently | Report all not-found entities as errors. Default behavior: abort if any entity is missing. Add `--skip-missing` flag to continue. |
| Error messages that show Geo IDs without entity names | "Failed to delete relation 5cade575..." is meaningless to the user | Always resolve and display entity names alongside IDs: "Failed to delete relation 5cade575 (John Smith -> Company XYZ via 'Works At')" |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Delete:** Entity deletion generates `deleteEntity` ops -- but verify it ALSO generates `deleteRelation` ops for ALL outgoing relations, ALL incoming relations (backlinks), AND all type-assignment relations (`TYPES_PROPERTY`)
- [ ] **Delete:** Dry-run shows N entities will be deleted -- but verify the relation count is non-zero for most entities (an entity with 0 relations is suspicious unless it was just created)
- [ ] **Update:** `updateEntity` ops include `set` values -- but verify `unset` ops are generated for spreadsheet cells that are intentionally empty/cleared
- [ ] **Update:** Spreadsheet includes Geo entity IDs -- but verify these IDs are validated against the Geo API (entity exists and is in the target space)
- [ ] **Merge:** Keeper update ops only include properties the keeper does NOT already have -- verify by checking the keeper's current state was queried before generating ops
- [ ] **Merge:** Merger deletion is complete (same checklist as Delete) -- not just the entity but all its relations
- [ ] **Merge:** Incoming relations to merger are re-pointed to keeper -- this is easily forgotten. Other entities that reference the merger need their relations updated (not just deleted)
- [ ] **All ops:** Batch published successfully -- but verify the indexer has processed it. There can be a delay between transaction confirmation and the data being queryable in the API.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Orphaned relations after incomplete delete | HIGH | Cannot undo. Must identify all orphaned relations via API queries and publish a new batch of `deleteRelation` ops to clean them up. Requires manual forensics. |
| Keeper data overwritten during merge | HIGH | Cannot undo. Must identify the original values (from dry-run report if saved, or from blockchain transaction history if available) and publish `updateEntity` ops to restore them manually. |
| Wrong entity deleted (ID typo) | EXTREME | Cannot undo. The entity and all its data are permanently gone. Must recreate from external backup (spreadsheet, report files). This is why dry-run with name display is critical. |
| Batch too large, partial execution | MEDIUM-HIGH | The blockchain processes the entire edit atomically (all ops in one `publishEdit` are either all applied or all rejected). So partial execution should not happen for a single edit. However, if the tool splits across edits, the second edit failing leaves a half-completed operation. Recovery requires publishing the remaining ops manually. |
| Merge re-pointing relations fails | MEDIUM | Other entities' relations still point to the deleted merger. Must query for these orphaned relations and create new relations from those entities to the keeper, then delete the orphaned ones. |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Incomplete entity deletion (orphaned triples) | Phase 1: Delete | Dry-run shows relation count > 0 for entities with data. Post-publish API query confirms entity and all relations gone. |
| Missing relation discovery API | Phase 1: Delete (prerequisite) | New `fetchEntityTriples()` function returns outgoing relations, backlinks, and property values. Unit tested with mock API responses. |
| Merge overwrites keeper data | Phase 3: Merge | Dry-run diff report shows "KEEP" vs "COPY" columns. Integration test verifies keeper values unchanged after merge. |
| Update uses create semantics | Phase 2: Update | Batch builder generates `updateEntity` ops (not `createEntity`). Test verifies `set` and `unset` arrays are populated correctly. |
| Relation entity IDs not retrieved | Phase 1: Delete | API query returns relation `id` and `entity.id` for each relation. Delete ops reference these IDs. |
| Transaction size limits | Phase 1: Delete | Batch splitting implemented with configurable `--batch-size`. Dry-run shows batch count. Entity-level atomicity preserved within batches. |
| Partial merge execution | Phase 3: Merge | All ops for a merge pair are in a single batch. Tool refuses to merge if combined ops exceed batch limit rather than splitting. |
| Wrong entity targeted (ID typo) | All Phases | Dry-run REQUIRED for first run. Entity names displayed alongside IDs. `--confirm-irreversible` flag for non-dry-run destructive operations. |
| Merge incoming relation re-pointing | Phase 3: Merge | Merger's incoming relations (backlinks) are either deleted or re-created pointing to keeper. Dry-run shows "REMAP: EntityX -> Merger becomes EntityX -> Keeper". |

## Sources

- Geo SDK source code: `submodules/geo-sdk/src/graph/delete-entity.ts` (single op, no cascade)
- Geo SDK source code: `submodules/geo-sdk/src/graph/update-entity.ts` (set/unset semantics)
- Geo SDK source code: `submodules/geo-sdk/src/graph/create-relation.ts` (relation IDs are generated, not derived)
- Geo SDK source code: `submodules/geo-sdk/src/graph/create-entity.ts` (types are relations via TYPES_PROPERTY)
- Geo SDK source code: `submodules/geo-sdk/src/ipfs.ts:57-59` (empty ops rejection)
- Geo SDK source code: `submodules/geo-sdk/src/core/ids/system.ts` (TYPES_PROPERTY = 8f151ba4...)
- Hypergraph source code: `submodules/hypergraph/packages/hypergraph/src/entity/delete.ts` (local delete only handles outgoing relations)
- Hypergraph source code: `submodules/hypergraph/packages/hypergraph/src/utils/relation-query-helpers.ts` (backlinks field exists in API)
- Hypergraph source code: `submodules/hypergraph/packages/hypergraph/src/entity/find-one-public.ts` (entity query pattern)
- Existing codebase: `src/processors/batch-builder.ts` (create-only path)
- Existing codebase: `src/api/geo-client.ts` (no relation query capability)
- Existing codebase: `.planning/codebase/CONCERNS.md` (no batch size limits documented)

---
*Pitfalls research for: Geo bulk data operations (delete, update, merge)*
*Researched: 2026-02-19*
