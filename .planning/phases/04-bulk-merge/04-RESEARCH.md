# Phase 4: Bulk Merge - Research

**Researched:** 2026-03-03
**Domain:** Entity deduplication via bulk merge operations in Geo protocol
**Confidence:** HIGH

## Summary

Phase 4 adds a `geo-publish merge` CLI command that accepts an Excel template of keeper/merger entity name pairs, copies unique properties and relations from each merger onto its keeper (without overwriting existing keeper data), then deletes each merger entity. The merge pipeline follows the four-phase pattern established by the update command (validate -> diff -> confirm -> publish), reuses the existing delete pipeline from Phase 2 for merger entity removal, and reuses name-based entity resolution from Phase 3.

The primary technical challenge is the "merge diff" engine -- comparing keeper and merger entities to compute which properties to transfer, which relations to re-point, and which conflicts to report. A critical discovery during research is that the Geo SDK's `Graph.updateRelation()` does NOT support changing `fromEntity` or `toEntity` fields -- it only supports `position`, `fromSpace`, `toSpace`, `fromVersion`, `toVersion`. Therefore, "re-pointing" a relation means deleting the old relation and creating a new one. This is the same delete-then-create pattern already used in the update command for relation changes.

All required SDK operations (`Graph.updateEntity`, `Graph.createRelation`, `Graph.deleteRelation`) are already exercised in the existing codebase. The merge command is a composition of proven patterns rather than new SDK surface area. The Excel template format uses a simple two-column layout (keeper name, merger name) on a "Merge" tab with Metadata for space ID, consistent with the established template conventions.

**Primary recommendation:** Build merge as a three-plan phase following the established pattern: (1) Excel parser extension + merge types, (2) merge diff engine with conflict detection, (3) merge command handler with four-phase pipeline, dry-run, and reporting.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Excel template (`.xlsx`) -- consistent with upsert/update commands
- Metadata tab specifies `Operation type: MERGE` and space ID
- Merge tab has two columns: keeper entity name, merger entity name
- Entity names resolved to IDs internally (same pattern as update command)
- Multi-way merges expressed as multiple rows with the same keeper (e.g., row 1: A/B, row 2: A/C)
- Rows processed in file order
- Terminology throughout codebase: **keeper** (survives) and **merger** (gets absorbed)
- Keeper's existing property values are never overwritten
- When keeper and merger have the same property with different values: keep keeper's value, log as conflict in report (showing both values)
- When keeper and merger have the same property with the same value: skip silently (not a conflict)
- Transfer all unique properties from merger to keeper EXCEPT the entity name -- keeper's name is canonical
- Multi-value properties (e.g., "Related topics"): union the sets -- add merger's unique values to keeper's existing set, skip duplicates
- Incoming relations (backlinks) pointing at merger are re-pointed to keeper
- Outgoing relations from merger are added to keeper
- Duplicate relation check: if keeper already has the same relation type to the same target entity, skip (never create duplicate relations) -- applies to both outgoing and incoming
- Type assignments: union -- add merger's types that keeper doesn't already have
- Dry-run (`--dry-run`): full per-pair diff showing properties to transfer, conflicting properties (with both values), relations to re-point, duplicate relations to skip, and merger entity to be deleted
- Summary report (after execution): aggregate counts -- total pairs merged, properties transferred, relations re-pointed, conflicts skipped, entities deleted (consistent with delete/update report pattern)
- Conflict details shown in console output only -- no separate file
- Pre-merge snapshot: save both keeper and merger full entity state before merge (audit trail, same pattern as delete command's pre-deletion snapshot)

### Claude's Discretion
- Exact Excel template column headers and layout
- Dry-run output formatting and spacing
- Snapshot file format and location
- Internal ordering of merge operations (property transfer vs relation re-pointing)
- Error handling for partial failures within a pair

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MERGE-01 | User can provide CSV with keeper_id/merger_id pairs as merge input | CONTEXT.md upgrades this: Excel template with keeper/merger *names* (not IDs), resolved internally via `searchEntitiesByNames()` from geo-client.ts. Merge tab parsed by extended excel-parser or new dedicated parser. |
| MERGE-02 | Tool validates both keeper and merger entities exist | Reuse `searchEntitiesByNames()` pattern from update command -- resolve all names to IDs, hard-error on unresolved names before any operations execute. |
| MERGE-03 | Tool copies properties from merger to keeper without overwriting keeper's existing values | Merge diff engine compares `EntityDetails.values` arrays. For each merger property: if keeper has the property, log conflict; if keeper lacks it, emit `Graph.updateEntity({ id: keeperId, values: [...] })` op. Multi-value relation properties use set union. |
| MERGE-04 | Tool re-points relations from merger to keeper | SDK's `updateRelation()` does NOT support changing fromEntity/toEntity. Must use delete-old + create-new pattern: `Graph.deleteRelation({ id })` + `Graph.createRelation({ fromEntity: keeper, toEntity: target, type })` for outgoing; for incoming backlinks: `Graph.deleteRelation({ id })` + `Graph.createRelation({ fromEntity: source, toEntity: keeper, type })`. Duplicate relation check prevents creating relations keeper already has. |
| MERGE-05 | Tool deletes merger entity after transfer (using delete logic) | Reuse `buildDeleteOps()` from delete-builder.ts. After property transfer and relation re-pointing, the merger entity is blanked using the standard delete pipeline (unset all properties, delete remaining relations). |
| MERGE-06 | All ops for a merge pair published in single atomic transaction | Collect all ops (property transfer + relation re-point + delete) into a single `Op[]` array per pair and publish via `publishToGeo()`. Each pair is one atomic publishEdit call. |
| MERGE-07 | Dry-run mode shows property transfers, relation re-points, and conflicts | Merge diff engine returns structured diff per pair. Dry-run prints per-pair report using chalk color-coding (consistent with update-report.ts pattern). |
| MERGE-08 | Merge conflict detection logs when keeper already has a value merger also has | Merge diff tracks conflicts explicitly: `{ propertyId, propertyName, keeperValue, mergerValue }`. Conflicts are logged in console output during both dry-run and live execution. |
| MERGE-09 | Summary report shows properties transferred, relations re-pointed, mergers deleted | New MergeReport type extending ReportBase (consistent with DeleteReport, UpdateReport pattern). Added to OperationReport discriminated union. Saved via `saveOperationReport()`. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @geoprotocol/geo-sdk | ^0.10.1 | Graph.updateEntity, Graph.createRelation, Graph.deleteRelation | Already in project, all needed ops available |
| xlsx | ^0.18.5 | Parse Excel template (Merge tab + Metadata tab) | Already in project, used by entity-id-parser and excel-parser |
| commander | ^12.1.0 | CLI subcommand registration for `merge` | Already in project, pattern established in cli.ts |
| chalk | ^5.3.0 | Color-coded dry-run output | Already in project, used in update-report.ts and logger.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| viem | ^2.21.0 | Transaction submission via publishToGeo | Already in project, reused through publisher.ts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| xlsx for merge tab parsing | csv-parse | CONTEXT.md locked Excel format for consistency with other commands |
| Delete + create for relation re-pointing | Graph.updateRelation | NOT possible -- updateRelation only supports position/space/version, not fromEntity/toEntity |

**Installation:** No new packages required. All dependencies already in project.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── commands/merge.ts            # Merge command handler (four-phase pipeline)
├── config/merge-types.ts        # MergeOptions, MergePairDiff, MergeSummary, MergeBatch
├── processors/merge-diff.ts     # Merge diff engine (compare keeper vs merger)
├── publishers/merge-report.ts   # MergeReport generation + dry-run output
```

### Pattern 1: Four-Phase Pipeline (from update command)
**What:** Validate -> Diff -> Confirm -> Publish pipeline structure
**When to use:** All destructive bulk operations
**Confidence:** HIGH -- proven pattern in update command, established in CONTEXT.md
**Example:**
```typescript
// Phase 1: VALIDATE - Parse template, resolve names, validate existence
// Phase 2: DIFF - Fetch both entities per pair, compute merge diff
// Phase 3: CONFIRM - Show diff (dry-run stops here), prompt confirmation
// Phase 4: PUBLISH - Build ops from diffs, publish per pair atomically
```

### Pattern 2: Entity Name Resolution (from update command)
**What:** Resolve entity names to IDs via `searchEntitiesByNames()` before any operations
**When to use:** When Excel input uses entity names (not IDs)
**Confidence:** HIGH -- proven pattern in update command
**Example:**
```typescript
// Collect all unique names from merge pairs
const allNames = [...keeperNames, ...mergerNames];
const resolvedEntities = await searchEntitiesByNames(allNames, spaceId, network);

// Hard-error on unresolved names
const unresolvedNames = allNames.filter(n => !resolvedEntities.has(normalizeEntityName(n)));
if (unresolvedNames.length > 0) { /* error and exit */ }
```

### Pattern 3: OperationsBatch Adapter (from delete and update commands)
**What:** Wrap `Op[]` in minimal `OperationsBatch` with zeroed `BatchSummary` for `publishToGeo()`
**When to use:** When publishing non-upsert ops through the shared publisher
**Confidence:** HIGH -- pattern used identically in both delete.ts and update.ts
**Example:**
```typescript
const emptyBatchSummary: BatchSummary = {
  typesCreated: 0, typesLinked: 0, propertiesCreated: 0,
  propertiesLinked: 0, entitiesCreated: 0, entitiesLinked: 0,
  relationsCreated: 0, imagesUploaded: 0, multiTypeEntities: [],
};
const batch: OperationsBatch = { ops: allOps, summary: emptyBatchSummary };
```

### Pattern 4: Pre-Operation Snapshot (from delete command)
**What:** Save full entity state to `.snapshots/` before destructive operations
**When to use:** Before executing any merge (both keeper and merger states)
**Confidence:** HIGH -- identical pattern from delete command
**Example:**
```typescript
function saveMergeSnapshot(pairs: Array<{ keeper: EntityDetails; merger: EntityDetails }>): string {
  const snapshotsDir = path.resolve('.snapshots');
  fs.mkdirSync(snapshotsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = `merge-snapshot-${timestamp}.json`;
  fs.writeFileSync(path.join(snapshotsDir, filename), JSON.stringify(pairs, null, 2));
  return path.join(snapshotsDir, filename);
}
```

### Pattern 5: Relation Re-pointing via Delete + Create
**What:** "Re-point" a relation by deleting the old one and creating a new one targeting keeper
**When to use:** Transferring incoming/outgoing relations from merger to keeper
**Confidence:** HIGH -- SDK confirmed: `Graph.updateRelation()` does NOT support changing `fromEntity`/`toEntity`
**Example:**
```typescript
// Re-point incoming backlink: was pointing at merger, now point at keeper
// Old: sourceEntity -> merger (relation ID = backlink.id)
// New: sourceEntity -> keeper (new relation)
const deleteOps = Graph.deleteRelation({ id: backlink.id }).ops;
const createOps = Graph.createRelation({
  fromEntity: backlink.fromEntity.id,
  toEntity: keeperId,
  type: backlink.typeId,
}).ops;

// Re-point outgoing relation: was from merger, now from keeper
// Old: merger -> targetEntity (relation ID = rel.id)
// New: keeper -> targetEntity (new relation)
const deleteOps2 = Graph.deleteRelation({ id: rel.id }).ops;
const createOps2 = Graph.createRelation({
  fromEntity: keeperId,
  toEntity: rel.toEntity.id,
  type: rel.typeId,
}).ops;
```

### Pattern 6: Multi-Way Merge as Sequential Pair Processing
**What:** Multiple rows with same keeper processed sequentially in file order
**When to use:** When a keeper absorbs multiple mergers (e.g., A absorbs B, then A absorbs C)
**Confidence:** HIGH -- locked decision from CONTEXT.md
**Critical detail:** After merging A+B, the keeper entity state changes (new properties, new relations). When processing A+C, the diff engine must account for properties already gained from B. Two approaches:
1. **Re-fetch keeper state between pairs** (simpler, correct, extra API calls)
2. **Track accumulated state in memory** (faster, more complex, risk of inconsistency)

**Recommendation:** Use approach 1 (re-fetch) for correctness. The number of pairs is typically small (tens, not thousands), and the API calls are cheap compared to the risk of state tracking bugs.

### Anti-Patterns to Avoid
- **In-place relation mutation:** Cannot use `Graph.updateRelation()` to change entity endpoints. Must delete + create.
- **Overwriting keeper name:** CONTEXT.md explicitly says keeper's name is canonical. Skip merger's NAME_PROPERTY transfer.
- **Single transaction for all pairs:** Each pair must be its own atomic transaction (MERGE-06). Do NOT batch all pairs into one giant publishEdit.
- **Silent deduplication without reporting:** When skipping duplicate relations or same-value properties, these should be tracked in the diff for dry-run output (even though they produce no ops).
- **Mutating merger entity before transfer:** Fetch both entities first, compute all diffs, then execute. Don't start deleting merger data before fully reading it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Entity name resolution | Custom search logic | `searchEntitiesByNames()` from geo-client.ts | Handles Root space + target space, batching, normalization |
| Entity detail fetching | Custom GraphQL queries | `fetchEntityDetails()` from geo-client.ts | Returns properties, relations, backlinks, typeIds in one call |
| Entity deletion after merge | Custom deletion ops | `buildDeleteOps()` from delete-builder.ts | Handles relation dedup, property unset, backlink cleanup |
| Report saving | Custom file I/O | `saveOperationReport()` from report.ts | Consistent naming convention, directory creation |
| Network resolution | Custom env/flag parsing | `resolveNetwork()` from cli-helpers.ts | Handles flag > env > default precedence |
| Confirmation prompt | Custom readline | `confirmAction()` from cli-helpers.ts | Handles TTY check, --yes bypass |
| Private key validation | Custom hex check | `validatePrivateKey()` from publisher.ts | Consistent 0x + 64 hex check |

**Key insight:** Merge is fundamentally a composition of existing infrastructure. The only genuinely new logic is the merge diff engine that computes which properties/relations to transfer and which conflicts to report.

## Common Pitfalls

### Pitfall 1: Re-Fetching Merger After Partial Processing in Multi-Way Merge
**What goes wrong:** When keeper A absorbs merger B, some of B's relations now point at A. If A then absorbs merger C, and C had a relation to B, that relation may now effectively be a relation to A (if B was already deleted). But since each pair is atomic and published separately, C's data is still based on pre-merge state.
**Why it happens:** Multi-way merges involve sequential atomic transactions, not one big transaction.
**How to avoid:** Each pair is independently atomic. After A+B publishes, the A+C diff should be computed against fresh API state (re-fetch keeper A's details). The merger C's state doesn't change between transactions -- it's only modified when its own merge pair executes.
**Warning signs:** Relation counts in summary don't match expectations. Duplicate relation warnings appearing for seemingly unique relations.

### Pitfall 2: Relation Deduplication Must Check Both Directions
**What goes wrong:** Keeper already has a relation `keeper -> X` of type T. Merger also has `merger -> X` of type T. If we create `keeper -> X` of type T, we get a duplicate.
**Why it happens:** Forgetting to check keeper's existing relations before creating re-pointed ones.
**How to avoid:** Build a dedup set from keeper's existing relations: `Set<"fromId:toId:typeId">`. Before creating any re-pointed relation, check if the equivalent already exists on keeper.
**Warning signs:** Duplicate relations appearing on keeper entity after merge.

### Pitfall 3: Multi-Value Property Union Requires Understanding Value Semantics
**What goes wrong:** CONTEXT.md specifies multi-value properties (like "Related topics") should be unioned. But the Geo API represents these as relations, not as multi-value text properties.
**Why it happens:** Confusion between scalar properties (single value per property) and relation properties (multiple relations of same type).
**How to avoid:** In Geo, "multi-value" properties like "Related topics" are RELATION type properties. Each topic is a separate entity linked via a relation. Union logic = add merger's relation targets that keeper doesn't already have. Scalar properties are always single-valued -- there is no "union" for scalars.
**Warning signs:** Attempting to append text values instead of creating relations.

### Pitfall 4: Entity Name Property Must Not Be Transferred
**What goes wrong:** Merger's name overwrites keeper's name.
**Why it happens:** Blindly transferring all properties without filtering.
**How to avoid:** Explicitly exclude `SystemIds.NAME_PROPERTY` from property transfer. CONTEXT.md says "keeper's name is canonical."
**Warning signs:** Keeper entity name changes after merge.

### Pitfall 5: Backlink Re-Pointing Creates a Relation FROM the Third-Party Entity
**What goes wrong:** When re-pointing a backlink, the new createRelation must have `fromEntity: thirdPartyEntity.id` (the entity that was pointing at merger), NOT `fromEntity: keeper.id`.
**Why it happens:** Confusing direction of backlinks. A backlink on merger means "entity X has an outgoing relation to merger." Re-pointing means "entity X should have an outgoing relation to keeper instead."
**How to avoid:** For backlinks: `fromEntity = backlink.fromEntity.id`, `toEntity = keeperId`. For outgoing relations: `fromEntity = keeperId`, `toEntity = rel.toEntity.id`.
**Warning signs:** Relations appearing in wrong direction after merge.

### Pitfall 6: Type Assignment Transfer via createRelation
**What goes wrong:** Attempting to transfer type assignments using `Graph.updateEntity` instead of relation operations.
**Why it happens:** Type assignments in Geo are stored as relations (type assignment relation). The `EntityDetails.typeIds` field shows assigned type IDs, but the actual assignment is a relation that appears in the `relations` array.
**How to avoid:** Type assignment union means: for each type in merger's `typeIds` that's not in keeper's `typeIds`, create a type assignment relation. The existing `relations` array on the entity already includes type assignment relations. The standard approach is to use `Graph.createRelation` with `SystemIds.TYPES_PROPERTY` as the type.
**Warning signs:** Types not appearing on keeper after merge, or using wrong API for type assignment.

## Code Examples

### Merge Diff Engine Core Logic (Verified Against Codebase Patterns)
```typescript
// Source: Derived from update-diff.ts pattern + CONTEXT.md decisions
interface MergePairDiff {
  keeperName: string;
  keeperId: string;
  mergerName: string;
  mergerId: string;
  propertiesToTransfer: Array<{
    propertyId: string;
    propertyName: string;
    mergerValue: string;
    typedValue: TypedValue;
  }>;
  conflicts: Array<{
    propertyId: string;
    propertyName: string;
    keeperValue: string;
    mergerValue: string;
  }>;
  relationsToRepoint: Array<{
    relationId: string;      // Old relation ID to delete
    direction: 'outgoing' | 'incoming';
    typeId: string;
    otherEntityId: string;   // The third-party entity
    otherEntityName: string;
  }>;
  relationsSkipped: Array<{  // Keeper already has equivalent
    direction: 'outgoing' | 'incoming';
    typeId: string;
    otherEntityId: string;
    otherEntityName: string;
  }>;
  typesToTransfer: string[];  // Type IDs merger has that keeper doesn't
  mergerDeleteOps: Op[];      // From buildDeleteOps() for post-transfer cleanup
}
```

### Relation Dedup Set Construction
```typescript
// Source: fetchExistingRelations pattern in geo-client.ts
function buildKeeperRelationSet(keeper: EntityDetails): Set<string> {
  const set = new Set<string>();

  // Outgoing relations: keeper -> target
  for (const rel of keeper.relations) {
    set.add(`out:${rel.toEntity.id}:${rel.typeId}`);
  }

  // Incoming relations (backlinks): source -> keeper
  for (const bl of keeper.backlinks) {
    set.add(`in:${bl.fromEntity.id}:${bl.typeId}`);
  }

  return set;
}
```

### Building Ops for a Single Merge Pair
```typescript
// Source: Composition of delete-builder.ts + update command op-building patterns
function buildMergeOps(diff: MergePairDiff, keeperId: string): Op[] {
  const ops: Op[] = [];

  // 1. Transfer unique properties to keeper
  if (diff.propertiesToTransfer.length > 0) {
    // Handle description separately (same pattern as update command)
    const descTransfer = diff.propertiesToTransfer.find(
      p => p.propertyId === SystemIds.DESCRIPTION_PROPERTY
    );
    const values = diff.propertiesToTransfer
      .filter(p => p.propertyId !== SystemIds.DESCRIPTION_PROPERTY)
      .map(p => ({ property: p.propertyId, ...p.typedValue }));

    ops.push(...Graph.updateEntity({
      id: keeperId,
      values: values.length > 0 ? values : undefined,
      ...(descTransfer && { description: descTransfer.mergerValue }),
    }).ops);
  }

  // 2. Transfer type assignments (union)
  for (const typeId of diff.typesToTransfer) {
    ops.push(...Graph.createRelation({
      fromEntity: keeperId,
      toEntity: typeId,
      type: SystemIds.TYPES_PROPERTY,
    }).ops);
  }

  // 3. Re-point relations (delete old + create new)
  for (const rel of diff.relationsToRepoint) {
    ops.push(...Graph.deleteRelation({ id: rel.relationId }).ops);

    if (rel.direction === 'outgoing') {
      ops.push(...Graph.createRelation({
        fromEntity: keeperId,
        toEntity: rel.otherEntityId,
        type: rel.typeId,
      }).ops);
    } else {
      ops.push(...Graph.createRelation({
        fromEntity: rel.otherEntityId,
        toEntity: keeperId,
        type: rel.typeId,
      }).ops);
    }
  }

  // 4. Delete merger entity (reuse delete pipeline)
  ops.push(...diff.mergerDeleteOps);

  return ops;
}
```

### Excel Template Merge Tab Parsing
```typescript
// Source: entity-id-parser.ts pattern adapted for name-based columns
function parseMergeTab(filePath: string): { pairs: MergePair[]; spaceId: string; errors: string[] } {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['Merge'];
  if (!sheet) return { pairs: [], spaceId: '', errors: ['Tab "Merge" not found'] };

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const pairs: MergePair[] = [];

  for (let i = 0; i < rows.length; i++) {
    const keeperName = getStringCell(rows[i], 'Keeper');  // or 'Keeper Entity Name'
    const mergerName = getStringCell(rows[i], 'Merger');  // or 'Merger Entity Name'
    if (keeperName && mergerName) {
      pairs.push({ keeperName, mergerName, rowNumber: i + 2 });
    }
  }

  return { pairs, spaceId, errors };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct entity deletion via `Graph.deleteEntity()` | Unset all properties + delete all relations via `Graph.updateEntity({ unset })` + `Graph.deleteRelation()` | Phase 2 discovery | Indexer ignores `deleteEntity` -- must blank entities instead. Merge must use same approach for merger deletion. |
| Relation re-pointing via `Graph.updateRelation()` | Delete old relation + create new relation | SDK limitation (confirmed current) | `updateRelation` only supports position/space/version fields, not `fromEntity`/`toEntity` |
| CSV input format | Excel (.xlsx) template format | CONTEXT.md decision | Consistent with upsert/update commands; REQUIREMENTS.md MERGE-01 says "CSV" but CONTEXT.md upgrades to Excel with entity names |

**Deprecated/outdated:**
- `Graph.deleteEntity()`: Indexer ignores it. Use property unset + relation deletion instead.
- MERGE-01 original "CSV with IDs" design: CONTEXT.md upgrades to Excel with entity names, resolved internally.

## Open Questions

1. **Type assignment relation type ID**
   - What we know: Type assignments appear in `EntityDetails.typeIds` and as relations in the `relations` array. The relation type for type assignment is likely `SystemIds.TYPES_PROPERTY`.
   - What's unclear: Need to verify the exact relation type ID used for type assignment relations in the codebase.
   - Recommendation: During implementation, inspect an entity's relations array and identify which relations correspond to type assignments (they will have `toEntity.id` matching one of `typeIds`). Use the observed `typeId` from those relations. HIGH likelihood it is a known SystemIds constant.

2. **Property value extraction from EntityDetails for typed transfer**
   - What we know: `EntityDetails.values` has typed fields (text, boolean, integer, float, etc.). The merge diff engine needs to extract the non-null field and reconstruct a `TypedValue` for `Graph.updateEntity`.
   - What's unclear: Whether we need the original data type metadata to correctly construct the TypedValue, or if we can infer it from which field is non-null.
   - Recommendation: Infer data type from which field is non-null in the `values` entry. This avoids needing to resolve property metadata. `text` non-null -> TEXT, `boolean` non-null -> BOOLEAN, etc. The `convertToTypedValue` function in cell-parsers.ts shows the mapping. LOW risk -- the field names directly correspond to data types.

3. **Per-pair atomic publishing vs batch publishing**
   - What we know: CONTEXT.md says "each merge pair published as a single atomic transaction." MERGE-06 says "All ops for a merge pair published in single atomic transaction."
   - What's unclear: Whether this means one `publishToGeo()` call per pair (multiple transactions) or all pairs in one transaction with per-pair grouping.
   - Recommendation: One `publishToGeo()` call per pair = one on-chain transaction per pair. This is the safest interpretation -- if pair 2 fails, pair 1 is already committed. This also matches the "atomic per pair" language. For multi-way merges (A absorbs B, then A absorbs C), this allows re-fetching A's state between pairs.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | No test framework currently installed in project |
| Config file | none -- Wave 0 must install |
| Quick run command | `npx vitest run --reporter=verbose` (after install) |
| Full suite command | `npx vitest run` (after install) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MERGE-01 | Parse Excel with keeper/merger name pairs | unit | `npx vitest run src/parsers/merge-parser.test.ts -x` | Wave 0 |
| MERGE-02 | Validate both keeper and merger entities exist | integration | Manual -- requires live API | manual-only |
| MERGE-03 | Copy unique properties without overwriting keeper | unit | `npx vitest run src/processors/merge-diff.test.ts -t "property transfer" -x` | Wave 0 |
| MERGE-04 | Re-point relations from merger to keeper | unit | `npx vitest run src/processors/merge-diff.test.ts -t "relation repoint" -x` | Wave 0 |
| MERGE-05 | Delete merger entity after transfer | unit | Covered by existing delete-builder tests (if they existed) | Wave 0 |
| MERGE-06 | Atomic transaction per merge pair | smoke | Manual -- requires live publish | manual-only |
| MERGE-07 | Dry-run shows transfers, re-points, conflicts | unit | `npx vitest run src/processors/merge-diff.test.ts -t "dry-run" -x` | Wave 0 |
| MERGE-08 | Conflict detection for shared properties | unit | `npx vitest run src/processors/merge-diff.test.ts -t "conflict" -x` | Wave 0 |
| MERGE-09 | Summary report with aggregate counts | unit | `npx vitest run src/publishers/merge-report.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest` -- framework install: `npm install -D vitest`
- [ ] `vitest.config.ts` -- config file for project root
- [ ] `src/parsers/merge-parser.test.ts` -- covers MERGE-01
- [ ] `src/processors/merge-diff.test.ts` -- covers MERGE-03, MERGE-04, MERGE-07, MERGE-08
- [ ] `src/publishers/merge-report.test.ts` -- covers MERGE-09

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/commands/update.ts` -- four-phase pipeline pattern, name resolution, OperationsBatch adapter
- Codebase inspection: `src/commands/delete.ts` -- snapshot pattern, delete pipeline, confirmation flow
- Codebase inspection: `src/processors/delete-builder.ts` -- buildDeleteOps() for entity deletion
- Codebase inspection: `src/processors/update-diff.ts` -- diff engine pattern, scalar/relation comparison
- Codebase inspection: `src/api/geo-client.ts` -- searchEntitiesByNames(), fetchEntityDetails(), EntityDetails type
- SDK inspection: `submodules/geo-sdk/src/graph/update-relation.ts` -- confirmed updateRelation does NOT support fromEntity/toEntity changes
- SDK inspection: `submodules/geo-sdk/src/graph/create-relation.ts` -- createRelation API for new relations
- SDK inspection: `submodules/geo-sdk/src/graph/delete-relation.ts` -- deleteRelation API

### Secondary (MEDIUM confidence)
- CONTEXT.md (04-CONTEXT.md) -- user decisions on merge behavior, conflict handling, template format
- REQUIREMENTS.md -- MERGE-01 through MERGE-09 requirement descriptions
- ROADMAP.md -- phase dependency chain, planned plan structure

### Tertiary (LOW confidence)
- Type assignment mechanism: HIGH likelihood uses SystemIds.TYPES_PROPERTY but needs implementation-time verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies needed
- Architecture: HIGH -- all patterns proven in existing commands (update, delete), direct codebase evidence
- Pitfalls: HIGH -- identified from codebase analysis (SDK limitation on updateRelation confirmed by source inspection)
- Merge diff engine: MEDIUM -- new logic composition, but built from well-understood primitives

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable -- no external dependencies changing)
