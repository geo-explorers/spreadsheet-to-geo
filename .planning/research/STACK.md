# Technology Stack: Bulk Delete, Update, and Merge Operations

**Project:** spreadsheet-to-geo (bulk operations milestone)
**Researched:** 2026-02-19
**Sources:** Direct source code analysis of geo-sdk submodule (v0.9.0), @geoprotocol/grc-20 (v0.4.0), Hypergraph API submodule, and existing project codebase.

## Executive Summary

The Geo SDK already provides all the low-level primitives needed for delete, update, and merge operations. The SDK exports `Graph.deleteEntity()`, `Graph.deleteRelation()`, `Graph.updateEntity()`, and `Graph.updateRelation()` -- all producing `Op[]` arrays that feed into the same `personalSpace.publishEdit()` / `daoSpace.proposeEdit()` pipeline the existing upsert system uses. The main engineering work is NOT in the SDK layer but in the **query layer** (fetching existing entity data from the Hypergraph GraphQL API) and the **operation orchestration layer** (deciding what ops to generate given spreadsheet intent).

## GRC-20 Op Types (Protocol Level)

All operations in Geo are expressed as `Op` types from `@geoprotocol/grc-20` v0.4.0. These are the atomic units of graph mutation.

**Confidence: HIGH** -- Read directly from `node_modules/@geoprotocol/grc-20/dist/types/op.d.ts`

| Op Type | Wire Code | Purpose | Already Used in Project |
|---------|-----------|---------|------------------------|
| `CreateEntity` | 1 | Create entity with initial property values. Idempotent: if entity exists, acts as update (LWW). | YES |
| `UpdateEntity` | 2 | Set and/or unset property values on existing entity. Applies unset first, then set. | NO |
| `DeleteEntity` | 3 | Transitions entity to DELETED state. Soft delete -- can be restored. | NO |
| `RestoreEntity` | 4 | Restores a DELETED entity back to ALIVE state. | NO |
| `CreateRelation` | 5 | Create directed relation between entities with type. | YES |
| `UpdateRelation` | 6 | Update mutable fields on relation (position, space/version pins). Structural fields (from, to, type) immutable. | NO |
| `DeleteRelation` | 7 | Transitions relation to DELETED state. | NO |
| `RestoreRelation` | 8 | Restores a DELETED relation. | NO |
| `CreateValueRef` | 9 | Creates referenceable ID for a value slot (provenance, attribution). | NO |

### Key Insight: CreateEntity Is Already Idempotent

From the GRC-20 spec comment on `CreateEntity`:
> "If the entity does not exist, creates it. If it already exists, this acts as an update: values are applied as set_properties (LWW)."

This means the existing `createEntity` path already handles "upsert" semantics at the protocol level. For explicit **update** operations (where we want to unset old values before setting new ones), we need `UpdateEntity` instead.

## SDK Functions for New Operations

### Graph.deleteEntity()

**Source:** `submodules/geo-sdk/src/graph/delete-entity.ts`
**Confidence: HIGH**

```typescript
import { Graph, type Op } from '@geoprotocol/geo-sdk';

const { id, ops } = Graph.deleteEntity({ id: entityId });
// ops = [{ type: 'deleteEntity', id: <grc-20 Id> }]
```

- Takes a single `{ id }` parameter
- Validates the ID format via `assertValid()`
- Returns one op of type `deleteEntity`
- The delete is a **soft delete** -- the entity transitions to DELETED state
- Does NOT require fetching triples first -- the SDK just emits the delete op

### Graph.deleteRelation()

**Source:** `submodules/geo-sdk/src/graph/delete-relation.ts`
**Confidence: HIGH**

```typescript
const { id, ops } = Graph.deleteRelation({ id: relationId });
// ops = [{ type: 'deleteRelation', id: <grc-20 Id> }]
```

- Identical pattern to deleteEntity
- Requires the **relation ID** (not the entity IDs at the endpoints)
- This means to delete all relations for an entity, you need to first **query** for those relations

### Graph.updateEntity()

**Source:** `submodules/geo-sdk/src/graph/update-entity.ts`
**Confidence: HIGH**

```typescript
const { id, ops } = Graph.updateEntity({
  id: entityId,
  name: 'Updated Name',           // optional
  description: 'Updated Desc',    // optional
  values: [                        // optional: properties to SET
    { property: propertyId, type: 'text', value: 'new value' },
  ],
  unset: [                         // optional: properties to UNSET
    { property: propertyId },                         // unset all languages
    { property: propertyId2, language: 'all' },       // explicit all
    { property: propertyId3, language: languageId },  // specific language
  ],
});
// ops = [{ type: 'updateEntity', id, set: [...], unset: [...] }]
```

- Returns a **single** `UpdateEntity` op (always exactly 1 op)
- Supports `set` and `unset` in one atomic operation
- Application order: unset first, then set
- For text properties with language variants, can unset specific languages or all
- Does NOT handle cover image or type changes -- those are relations, handled separately
- Does NOT handle relation changes -- use deleteRelation/createRelation for those

### Graph.updateRelation()

**Source:** `submodules/geo-sdk/src/graph/update-relation.ts`
**Confidence: HIGH**

```typescript
const { id, ops } = Graph.updateRelation({
  id: relationId,
  position: 'a0',         // optional
  fromSpace: spaceId,     // optional
  toSpace: spaceId,       // optional
  fromVersion: versionId, // optional
  toVersion: versionId,   // optional
});
```

- Can only update mutable fields: position, space pins, version pins
- **Cannot change** from, to, entity, or relationType (structural fields are immutable)
- To change what an entity is related to, you must delete the old relation and create a new one

## Hypergraph GraphQL API for Querying Entities

Before we can delete or update entities, we need to **query** the current state. The Hypergraph API provides GraphQL endpoints for this.

**Confidence: HIGH** -- Read directly from MCP server and Hypergraph package source.

### API Endpoints

| Network | Endpoint |
|---------|----------|
| TESTNET | `https://testnet-api.geobrowser.io/graphql` |
| MAINNET | `https://api.geobrowser.io/graphql` |

### Key Queries

#### 1. Search for Entities by Name (Already Exists in Project)

```graphql
query Search($query: String!, $spaceId: UUID, $limit: Int) {
  search(query: $query, spaceId: $spaceId, first: $limit) {
    id
    name
    spaceIds
    types { id name }
  }
}
```

**Source:** `src/api/geo-client.ts` -- already implemented.

#### 2. Get Entity with All Values and Relations (NEW -- needed for update/delete)

For fetching relation IDs (required for deleteRelation), use the `relations` connection field with `nodes`, NOT the simpler `relationsList`:

```graphql
query EntityWithRelations($id: UUID!, $spaceId: UUID!) {
  entity(id: $id) {
    id
    name
    spaceIds
    valuesList(filter: { spaceId: { is: $spaceId } }) {
      propertyId
      text
      boolean
      float
      datetime
      point
      schedule
    }
    relations(filter: { spaceId: { is: $spaceId } }) {
      nodes {
        id          # Relation ID -- CONFIRMED available
        typeId
        toEntity { id name }
      }
    }
  }
}
```

**Source:** The `relations` connection field with `nodes { id ... }` is confirmed available from `submodules/hypergraph/packages/hypergraph/src/utils/relation-query-helpers.ts` (line 106-135) which builds exactly this query shape, and `submodules/hypergraph/packages/hypergraph/src/utils/convert-relations.ts` (line 22-28) which types `RelationsListItem` with `id: string`.

**Confidence: HIGH** -- The Hypergraph SDK's own query builder uses `relations(filter: ...) { nodes { id ... } }` pattern. The `nodes` selection explicitly includes the relation `id` field.

**Note on `relationsList` vs `relations`:** The MCP server uses the simpler `relationsList` field which does NOT fetch relation `id`. For our delete/update use case, we MUST use the `relations` connection field instead, which provides `nodes` containing the `id`. This is the same pattern the Hypergraph SDK itself uses.

#### 3. Backlinks / Incoming Relations (NEW -- needed for merge)

The Hypergraph query helpers support a `backlinks` connection field for incoming relations:

```graphql
query EntityWithBacklinks($id: UUID!, $spaceId: UUID!) {
  entity(id: $id) {
    id
    name
    backlinks(filter: { spaceId: { is: $spaceId } }) {
      nodes {
        id
        typeId
        fromEntity: toEntity { id name }  # Note: backlinks swap from/to
      }
    }
  }
}
```

**Source:** `submodules/hypergraph/packages/hypergraph/src/utils/relation-query-helpers.ts` line 81-83, 89-91 -- the `listField` parameter supports `'backlinks'` which maps to the `backlinks` connection field and swaps `toEntity`/`fromEntity` accordingly.

**Confidence: MEDIUM** -- The code handles `backlinks` as a list field type, but the exact GraphQL field name on the public API needs runtime verification. The query builder constructs it, suggesting the API supports it.

#### 4. List Entities by Type in a Space (Already Partially Available)

```graphql
query Entities($spaceId: UUID!, $first: Int, $offset: Int) {
  entities(spaceId: $spaceId, first: $first, offset: $offset) {
    id
    name
    typeIds
    valuesList(filter: { spaceId: { is: $spaceId } }) {
      propertyId
      text
      boolean
      float
      datetime
      point
      schedule
    }
    relationsList(filter: { spaceId: { is: $spaceId } }) {
      typeId
      toEntity { id name }
    }
  }
}
```

**Source:** `submodules/hypergraph/packages/mcp-server/src/graphql-client.ts`

#### 5. Filter Entities by Type IDs

```graphql
query Entities($spaceId: UUID!, $typeIds: [UUID!]!, $first: Int) {
  entities(spaceId: $spaceId, typeIds: { in: $typeIds }, first: $first) {
    id
    name
    ...
  }
}
```

**Source:** `submodules/hypergraph/packages/hypergraph/src/entity/find-many-public.ts`

## Recommended Stack for New Operations

### Core Framework (No Changes)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@geoprotocol/geo-sdk` | 0.9.0 | SDK operations (delete, update, create) | Already pinned. Already exports `Graph.deleteEntity`, `Graph.updateEntity`, etc. |
| `@geoprotocol/grc-20` | 0.4.0 (transitive) | Op types, binary encoding | Transitive dependency of geo-sdk. All 9 Op types available. |
| `viem` | ^2.21.0 | Blockchain transactions | Already in use for wallet/transaction signing |
| `commander` | ^12.1.0 | CLI framework | Already in use. Extend with subcommands for new operations. |

### New Dependencies Needed

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| None | -- | -- | All required functionality is available through existing geo-sdk + direct GraphQL fetch calls |

The existing project already makes GraphQL calls using `fetch()` directly (see `src/api/geo-client.ts`). No GraphQL client library is needed -- the existing `executeQuery()` helper is sufficient.

### Existing Code to Reuse

| Component | Path | Reuse For |
|-----------|------|-----------|
| `executeQuery()` | `src/api/geo-client.ts` | All new GraphQL queries (entity lookup, relation fetching) |
| `searchEntityByName()` | `src/api/geo-client.ts` | Finding entities for update/delete by name |
| `publishToGeo()` | `src/publishers/publisher.ts` | Publishing delete/update ops (same pipeline -- ops array is ops array) |
| `convertToTypedValue()` | `src/processors/batch-builder.ts` | Converting spreadsheet values to SDK TypedValue for update operations |
| `buildPropertyValues()` | `src/processors/batch-builder.ts` | Building property value arrays for updateEntity |

### Existing Code to Extend (Not Replace)

| Component | Path | Extension Needed |
|-----------|------|-----------------|
| `geo-client.ts` | `src/api/geo-client.ts` | Add queries for: entity by ID with values+relations (using `relations { nodes { id } }` pattern), bulk entity fetch by IDs, backlinks query |
| `batch-builder.ts` | `src/processors/batch-builder.ts` | Add `buildDeleteOps()`, `buildUpdateOps()`, `buildMergeOps()` functions |
| `schema.ts` | `src/config/schema.ts` | Add `EntityAction` values: 'DELETE', 'UPDATE', 'MERGE'; extend `BatchSummary` |
| `index.ts` | `src/index.ts` | Add subcommands or mode flag for delete/update/merge |

## Operation Patterns

### Delete Operation Pattern

```typescript
// 1. Query: Find entity by name/ID, get its relation IDs
const entity = await getEntityWithRelations(entityId, spaceId, network);

// 2. Build ops: Delete entity + all its relations
const ops: Op[] = [];
// Delete all relations first (relations reference the entity)
for (const relation of entity.relations) {
  const { ops: deleteRelOps } = Graph.deleteRelation({ id: relation.id });
  ops.push(...deleteRelOps);
}
// Then delete the entity itself
const { ops: deleteEntityOps } = Graph.deleteEntity({ id: entityId });
ops.push(...deleteEntityOps);

// 3. Publish: Same pipeline as create
await personalSpace.publishEdit({
  name: `Bulk delete - ${new Date().toISOString()}`,
  spaceId, ops, author, network,
});
```

**Key consideration:** Deleting an entity without deleting its relations may leave orphaned relations. The protocol does soft-delete, so relations pointing to a deleted entity may still resolve but show as deleted. Whether to eagerly delete relations depends on the use case. For bulk spreadsheet operations, eagerly deleting outgoing relations from the same space is the safe default.

### Update Operation Pattern

```typescript
// 1. Query: Find entity by name/ID
const existingEntity = await searchEntityByName(name, spaceId, network);

// 2. Build ops: Use updateEntity to set new values and unset old ones
const ops: Op[] = [];

const { ops: updateOps } = Graph.updateEntity({
  id: existingEntity.id,
  name: newName,              // optional: only if changed
  description: newDescription, // optional: only if changed
  values: newPropertyValues,   // SET these values (LWW semantics)
  unset: propertiesToRemove,   // UNSET these values first
});
ops.push(...updateOps);

// For relation changes: delete old relations, create new ones
for (const oldRelation of relationsToRemove) {
  const { ops: delOps } = Graph.deleteRelation({ id: oldRelation.id });
  ops.push(...delOps);
}
for (const newRelation of relationsToAdd) {
  const { ops: createOps } = Graph.createRelation({ ...newRelation });
  ops.push(...createOps);
}

// 3. Publish
await personalSpace.publishEdit({ ... });
```

**Key consideration:** `UpdateEntity` applies unset before set within the same op. This means you can atomically replace a value: unset the old property value and set the new one in a single op.

### Merge Operation Pattern

Merge is the most complex: combine data from two or more entities into a target entity.

```typescript
// 1. Query: Get full data for source entities and target entity
const sourceEntities = await Promise.all(
  sourceIds.map(id => getEntityWithRelations(id, spaceId, network))
);
const targetEntity = await getEntityWithRelations(targetId, spaceId, network);

// 2. Build ops:
const ops: Op[] = [];

// a) Update target with merged property values
const { ops: updateOps } = Graph.updateEntity({
  id: targetId,
  values: mergedPropertyValues, // from all sources, with conflict resolution
});
ops.push(...updateOps);

// b) Re-point incoming relations from sources to target
for (const source of sourceEntities) {
  for (const relation of source.incomingRelations) {
    // Delete old relation pointing to source
    const { ops: delOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...delOps);
    // Create new relation pointing to target
    const { ops: createOps } = Graph.createRelation({
      fromEntity: relation.fromEntityId,
      toEntity: targetId,
      type: relation.typeId,
    });
    ops.push(...createOps);
  }
}

// c) Delete source entities (and their outgoing relations)
for (const source of sourceEntities) {
  for (const relation of source.outgoingRelations) {
    const { ops: delRelOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...delRelOps);
  }
  const { ops: delOps } = Graph.deleteEntity({ id: source.id });
  ops.push(...delOps);
}

// 3. Publish
await personalSpace.publishEdit({ ... });
```

**Key consideration:** Merge requires querying **incoming** relations (other entities pointing TO the source) via the `backlinks` connection field. The Hypergraph query builder supports this (see relation-query-helpers.ts), but the current project only queries outgoing relations. A new `backlinks` query is needed.

## Critical Technical Details

### 1. Relation IDs Are Required for Delete/Update

The SDK delete and update functions require the **relation ID**, not just the from/to entity IDs. This means:
- To delete entity relations, you must first query for them with their IDs
- Use the `relations(filter: ...) { nodes { id ... } }` connection pattern, NOT the simpler `relationsList` pattern (which omits `id` in the MCP examples)
- The Hypergraph SDK itself uses this `nodes { id }` pattern in its query builders

**Confidence: HIGH** -- Confirmed from `relation-query-helpers.ts` and `convert-relations.ts` in the Hypergraph package.

### 2. Soft Delete Semantics

Geo uses soft deletes. `DeleteEntity` and `DeleteRelation` transition to DELETED state. They can be restored with `RestoreEntity`/`RestoreRelation`. This is important for:
- Undo capability (could add a `--restore` flag later)
- No permanent data loss risk
- Deleted entities may still appear in some queries until indexer processes the edit

### 3. UpdateEntity Is Atomic Set+Unset

Within a single `UpdateEntity` op:
1. All `unset` operations apply first
2. Then all `set` operations apply

This means you can safely replace values in a single op without race conditions.

### 4. CreateEntity Is Already Upsert

The GRC-20 spec says `CreateEntity` acts as an update if the entity already exists. This means the current tool already handles the "update values" case for properties. What it CANNOT do:
- **Unset** properties (remove a value entirely)
- **Delete** entities
- **Delete** relations (can only add new ones)

This is exactly the gap the new operations fill.

### 5. Transaction Size Limits

All ops for a single edit are encoded into a binary protobuf, uploaded to IPFS, and referenced onchain. Very large edits (thousands of ops) may:
- Take longer to encode
- Cost more gas (larger calldata)
- Hit IPFS upload limits

**Recommendation:** Batch large delete/update operations into multiple edits (e.g., 500 ops per edit) like the existing create flow should be doing.

### 6. Cover and Type Relations

Cover images and types are implemented as **relations** in Geo, not as entity properties:
- Cover: `createRelation({ from: entityId, to: coverImageId, type: COVER_PROPERTY })` (system ID `34f535072e6b42c5a84443981a77cfa2`)
- Types: `createRelation({ from: entityId, to: typeId, type: TYPES_PROPERTY })` (system ID `8f151ba4de204e3c9cb499ddf96f48f1`)

This means:
- **Updating types** requires deleting old type relations and creating new ones
- **Updating cover** requires deleting old cover relation and creating a new one
- The `Graph.updateEntity()` function does NOT handle these -- they must be handled as separate relation delete+create ops

**Source:** `submodules/geo-sdk/src/graph/create-entity.ts` lines 269-293, `submodules/geo-sdk/src/core/ids/system.ts` constants.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| GraphQL client | Direct `fetch()` via existing `executeQuery()` | `graphql-request`, `urql`, `apollo` | Existing pattern works. No need for client-side caching or subscriptions. Adding a dependency for simple POST requests is unnecessary. |
| Relation querying | Extend `geo-client.ts` with `relations { nodes { id } }` | Use simpler `relationsList` or Hypergraph SDK `findOnePublic()` | `relationsList` may not expose `id`. Hypergraph SDK requires Effect.js setup and is designed for local-first apps, not CLI tools. Direct GraphQL with the connection pattern is the right trade-off. |
| Entity identification for delete | By name via search, then by ID | By ID only | Users work with spreadsheets (names), not raw IDs. Name-based lookup is essential. |
| Merge strategy | Delete sources, update target | Create new entity, delete all sources | Preserving the target entity keeps its ID stable for external references. |

## Sources

All findings are from direct source code analysis (HIGH confidence):

- `submodules/geo-sdk/src/graph/delete-entity.ts` -- deleteEntity implementation
- `submodules/geo-sdk/src/graph/delete-entity.test.ts` -- confirms op type is `'deleteEntity'`
- `submodules/geo-sdk/src/graph/delete-relation.ts` -- deleteRelation implementation
- `submodules/geo-sdk/src/graph/delete-relation.test.ts` -- confirms op type is `'deleteRelation'`
- `submodules/geo-sdk/src/graph/update-entity.ts` -- updateEntity implementation (232 lines)
- `submodules/geo-sdk/src/graph/update-entity.test.ts` -- confirms set/unset behavior (630 lines of tests)
- `submodules/geo-sdk/src/graph/update-relation.ts` -- updateRelation implementation
- `submodules/geo-sdk/src/graph/update-relation.test.ts` -- confirms updateRelation behavior
- `submodules/geo-sdk/src/graph/create-entity.ts` -- createEntity using grcCreateEntity + grcCreateRelation for cover/types
- `submodules/geo-sdk/src/graph/index.ts` -- Graph module exports all 10 functions (create/update/delete for entity+relation)
- `submodules/geo-sdk/src/types.ts` -- TypeScript types including UpdateEntityParams, DeleteEntityParams, UnsetPropertyParam
- `submodules/geo-sdk/src/core/ids/system.ts` -- TYPES_PROPERTY, COVER_PROPERTY, NAME_PROPERTY, DESCRIPTION_PROPERTY system IDs
- `node_modules/@geoprotocol/grc-20/dist/types/op.d.ts` -- 9 GRC-20 Op type definitions with wire codes
- `node_modules/@geoprotocol/grc-20/dist/ops/index.d.ts` -- Op builder functions (createEntity, updateEntity, deleteEntity, etc.)
- `submodules/hypergraph/packages/mcp-server/src/graphql-client.ts` -- GraphQL query patterns for entities/relations
- `submodules/hypergraph/packages/hypergraph/src/entity/find-one-public.ts` -- Entity query with valuesList
- `submodules/hypergraph/packages/hypergraph/src/utils/relation-query-helpers.ts` -- Confirms `relations { nodes { id } }` query pattern and `backlinks` support
- `submodules/hypergraph/packages/hypergraph/src/utils/convert-relations.ts` -- Confirms RelationsListItem includes `id: string`
- `src/api/geo-client.ts` -- Existing project GraphQL client with executeQuery() and search functions
- `src/processors/batch-builder.ts` -- Existing batch builder pattern using Graph.createEntity/createRelation/createProperty/createType
- `src/publishers/publisher.ts` -- Existing publish pipeline for personal space and DAO space
- `src/config/schema.ts` -- Existing type definitions: EntityAction ('CREATE' | 'LINK'), BatchSummary, etc.

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| SDK Op types for delete/update | HIGH | Read directly from grc-20 type definitions and geo-sdk source with test verification |
| SDK function signatures | HIGH | Read from source; verified against test files showing exact op shapes |
| GraphQL query patterns | HIGH | Read from MCP server and Hypergraph package source |
| Relation ID availability via `relations { nodes { id } }` | HIGH | Confirmed in Hypergraph SDK query builder (`relation-query-helpers.ts`) and type definitions (`convert-relations.ts`) |
| Backlinks/incoming relations query | MEDIUM | Hypergraph query builder supports `backlinks` list field, but needs runtime verification against public API |
| Merge operation pattern | MEDIUM | Conceptually sound, uses verified primitives, but end-to-end pattern is novel for this project |
| Transaction size limits | LOW | No concrete numbers found in source; based on general blockchain constraints |
