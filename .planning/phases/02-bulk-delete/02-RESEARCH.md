# Phase 2: Bulk Delete - Research

**Researched:** 2026-02-25
**Domain:** CLI delete pipeline using Geo SDK unset/delete-relation operations + GraphQL entity introspection
**Confidence:** HIGH

## CRITICAL FINDING: deleteEntity Is Not Implemented

**`Graph.deleteEntity()` is NOT functional.** The SDK method exists and generates ops, but the Geo Indexer ignores `deleteEntity` ops entirely. This was confirmed through real-world testing on testnet (2026-02-25).

**The workaround** (used by the Geo curator app) is:
1. Delete all relations to/from the entity using `Graph.deleteRelation({ id })` (this WORKS)
2. Unset all property values using `Graph.updateEntity({ id, unset: [...] })` (this WORKS)

After this, the entity appears blank/empty in the Geo Browser — no name, no properties, no relations, no type badge. This is the de facto "delete" in the Geo protocol.

**Source:** User tested on testnet with a real entity. `Graph.deleteRelation()` successfully removed relations. `Graph.updateEntity({ id, unset })` successfully cleared properties (name, description, custom properties, types).

## Summary

Phase 2 implements a bulk delete command (`geo-publish delete`) that reads entity IDs from an Excel file, validates they exist, fetches all associated data (properties, relations, backlinks) via the GraphQL API, builds SDK operations to blank each entity, and publishes them through the existing publish pipeline. The approach uses `Graph.deleteRelation({ id })` for all relations (outgoing + incoming) and `Graph.updateEntity({ id, unset })` to clear all property values — since `Graph.deleteEntity()` is ignored by the Indexer.

The core technical challenge is **completeness**: we must discover ALL property IDs and ALL relation IDs (both outgoing and incoming/backlinks) for each entity, then generate ops to remove every one. The GraphQL API at `https://testnet-api.geobrowser.io/graphql` provides entity details including `values` (properties with `propertyId`) and `relations` (with relation `id`). Incoming relations ("Referenced by") must be queried separately via the `backlinks` or equivalent field. The `--space` flag (required by success criteria but absent from the current CLI stub) must be added to supply the space ID, since delete input is a simple ID list without a Metadata tab.

**Primary recommendation:** Build the delete pipeline as a mirror of the upsert pipeline pattern: parse input, validate, fetch details, build ops, confirm, publish. Reuse `fetchEntityDetails()`, `parseEntityIds()`, the publisher, and report infrastructure from Phase 1. The delete command needs a `--space` CLI flag and a `--force` flag (per user decisions). **Do NOT use `Graph.deleteEntity()` — use `Graph.updateEntity({ id, unset })` instead.**

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Always show confirmation prompt before executing deletions
- Confirmation preview shows entity count + first few entity names as sanity check
- `--force` flag skips confirmation entirely (no prompt, no preview) for CI/scripts
- Require explicit `y` to proceed; default is `N` (abort)
- Pre-deletion snapshot in JSON format capturing full entity data: all properties, all relations (outgoing + incoming), type assignments
- Saved to `.snapshots/` directory in the working directory
- Timestamped filenames (e.g., `delete-snapshot-2026-02-25T14-30-00.json`) to prevent overwrites across multiple runs
- Stop immediately on any failure -- do not continue deleting remaining entities
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

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEL-01 | User can provide CSV of entity IDs as delete input | `parseEntityIds()` from Phase 1 reads Excel single-column IDs with validation. Note: despite "CSV" in requirement, actual implementation uses Excel (.xlsx) via the existing parser -- consistent with the rest of the tool. CLI stub already accepts `[file]` argument. |
| DEL-02 | Tool validates all entity IDs exist before executing any deletions | `fetchEntityDetails()` returns `null` for non-existent entities. Batch-validate all IDs by calling this for each ID; collect nulls as invalid. Fail-fast: reject entire batch if any ID is invalid. |
| DEL-03 | Tool deletes all property triples for each entity | **UPDATED:** `Graph.deleteEntity()` is NOT functional (Indexer ignores it). Use `Graph.updateEntity({ id, unset: propertyIds.map(p => ({ property: p })) })` to unset all property values. Property IDs are available from `fetchEntityDetails()` via the `values` connection's `propertyId` field. |
| DEL-04 | Tool deletes all outgoing relations for each entity | `fetchEntityDetails()` returns `relations[]` with each relation's own `id`. Use `Graph.deleteRelation({ id })` for each. |
| DEL-05 | Tool deletes all incoming relations (backlinks) for each entity | `fetchEntityDetails()` returns `backlinks[]` with each backlink's own `id`. Use `Graph.deleteRelation({ id })` for each. Backlinks GraphQL field needs runtime verification (flagged in STATE.md). |
| DEL-06 | Tool deletes type assignment relations for each entity | Type assignments are relations in the graph. They appear in the `relations` connection and can be deleted via `Graph.deleteRelation({ id })`. User testing confirmed that type badge disappears when the type relation is deleted. |
| DEL-07 | Tool deletes the entity itself after all triples are removed | **UPDATED:** `Graph.deleteEntity()` is NOT functional (Indexer ignores it). Instead, the entity is "blanked" by unsetting all properties via `Graph.updateEntity({ id, unset })` + deleting all relations via `Graph.deleteRelation()`. The entity shell remains in the graph but has no visible data. |
| DEL-08 | Dry-run mode shows entity names, property counts, and relation counts without executing | All data available from `fetchEntityDetails()`: name, values.length, relations.length, backlinks.length. Display in table format. |
| DEL-09 | Pre-operation snapshot saves entity data before deletion as audit trail | Serialize `EntityDetails[]` to JSON in `.snapshots/` with timestamped filename per user decision. |
| DEL-10 | Progress reporting shows "Processing X/Y..." for batches | Existing `logger.progress()` utility provides progress bar. Use line-by-line logging for entity-level progress. |
| DEL-11 | Summary report shows counts of entities deleted, relations removed, properties unset | `DeleteReport` type already defined in `types.ts` with `entitiesDeleted`, `relationsDeleted`, `triplesDeleted`. `saveOperationReport()` handles persistence. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@geoprotocol/geo-sdk` | ^0.10.1 | `Graph.deleteEntity()`, `Graph.deleteRelation()`, `personalSpace.publishEdit()`, `daoSpace.proposeEdit()` | Already in project; provides typed delete ops |
| `commander` | ^12.1.0 | CLI subcommand routing, `--space`, `--force` flags | Already in project; existing pattern in `cli.ts` |
| `xlsx` | ^0.18.5 | Read entity IDs from Excel files | Already in project; `parseEntityIds()` depends on it |
| `viem` | ^2.21.0 | Wallet client, transaction submission | Already in project; publisher depends on it |
| `chalk` | ^5.3.0 | Colored CLI output | Already in project; logger depends on it |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `dotenv` | ^16.4.5 | Load PRIVATE_KEY from `.env` | Already in project; needed for publish |
| `readline` (Node built-in) | - | Interactive confirmation prompt | Already used in `upsert.ts` |
| `fs` / `path` (Node built-in) | - | Snapshot file writing, report saving | Standard Node.js file I/O |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| xlsx for single-column ID parsing | csv-parse or plain text | xlsx is already a dependency and parser exists; adding csv-parse adds unnecessary dep; plain text loses validation |

**Installation:**
No new packages needed. All dependencies are already in `package.json`.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── commands/
│   ├── upsert.ts              # Existing (pattern reference)
│   └── delete.ts              # NEW: delete command handler
├── api/
│   └── geo-client.ts          # Existing: fetchEntityDetails(), used as-is
├── parsers/
│   └── entity-id-parser.ts    # Existing: parseEntityIds(), used as-is
├── processors/
│   └── delete-builder.ts      # NEW: build delete Op[] from EntityDetails
├── publishers/
│   ├── publisher.ts           # Existing: publishToGeo(), reused as-is
│   ├── report.ts              # Existing: saveOperationReport(), reused as-is
│   └── delete-report.ts       # NEW: delete-specific report generation
├── config/
│   └── types.ts               # Existing: DeleteReport type (may need enrichment)
├── utils/
│   └── logger.ts              # Existing: used as-is
└── cli.ts                     # MODIFY: update delete stub with real handler + flags
```

### Pattern 1: Command Handler Pipeline (mirror of upsert.ts)
**What:** Each command follows the same flow: parse -> validate -> fetch details -> build ops -> confirm -> publish -> report
**When to use:** All CLI commands should follow this pattern
**Example:**
```typescript
// src/commands/delete.ts -- follows exact same structure as upsert.ts
export async function deleteCommand(file: string, options: DeleteOptions): Promise<void> {
  // 1. Parse entity IDs from Excel
  const { ids, errors } = parseEntityIds(filePath, tabName);

  // 2. Validate all IDs exist (batch fetch details)
  const entityDetails = await fetchAllEntityDetails(ids, spaceId, network);

  // 3. Save pre-deletion snapshot
  saveSnapshot(entityDetails, snapshotDir);

  // 4. Build delete operations
  const { ops, summary } = buildDeleteOps(entityDetails);

  // 5. Confirm (unless --force)
  if (!options.force) await confirmDeletion(entityDetails);

  // 6. Publish
  const result = await publishToGeo(batch, metadata, privateKey, publishOptions);

  // 7. Report
  saveOperationReport(report, outputDir);
}
```

### Pattern 2: Delete Operation Ordering (Workaround for Non-Functional deleteEntity)
**What:** Since `Graph.deleteEntity()` is ignored by the Indexer, "deletion" means: (1) delete all relations, (2) unset all properties. Order: relations first (outgoing + incoming), then property unset.
**When to use:** Every entity deletion
**Example:**
```typescript
// For each entity, build ops in this order:
function buildDeleteOpsForEntity(details: EntityDetails): Op[] {
  const ops: Op[] = [];

  // 1. Delete outgoing relations (includes type assignments)
  for (const rel of details.relations) {
    const { ops: relOps } = Graph.deleteRelation({ id: rel.id });
    ops.push(...relOps);
  }

  // 2. Delete incoming relations (backlinks / "Referenced by")
  for (const backlink of details.backlinks) {
    const { ops: blOps } = Graph.deleteRelation({ id: backlink.id });
    ops.push(...blOps);
  }

  // 3. Unset ALL property values (blanks the entity)
  // Collect all unique property IDs from the entity's values
  const propertyIds = [...new Set(details.values.map(v => v.propertyId))];
  const { ops: updateOps } = Graph.updateEntity({
    id: details.id,
    unset: propertyIds.map(property => ({ property })),
  });
  ops.push(...updateOps);

  // NOTE: Do NOT use Graph.deleteEntity() — Indexer ignores it
  return ops;
}
```

### Pattern 3: Fail-Stop with Remaining-Entities Output
**What:** On any failure, stop immediately, write remaining unprocessed IDs to a CSV for re-run
**When to use:** Any error during the publish phase
**Example:**
```typescript
// Process entities sequentially; on failure, dump remaining
for (let i = 0; i < entities.length; i++) {
  try {
    await publishEntityDeletion(entities[i]);
    succeeded.push(entities[i].id);
  } catch (error) {
    const remaining = entities.slice(i);
    writeRemainingCsv(remaining, outputDir);
    reportPartialFailure(succeeded, remaining, error, snapshotPath);
    process.exit(1);
  }
}
```

### Pattern 4: Space ID via CLI Flag
**What:** Delete command gets spaceId from `--space <id>` CLI flag (not from a Metadata tab, since there is none)
**When to use:** Delete and update commands where input is just entity IDs
**Example:**
```typescript
// In cli.ts delete subcommand definition:
.requiredOption('-s, --space <id>', 'Target space ID (32-char hex)')
```

### Anti-Patterns to Avoid
- **Using `Graph.deleteEntity()`:** The Indexer ignores this op. Use `Graph.updateEntity({ id, unset })` + `Graph.deleteRelation()` instead
- **Single massive transaction:** Publishing hundreds of delete ops in one transaction may exceed gas limits or timeout. Consider batching if entity count is large, but start with single-transaction for simplicity (user can split input files for very large batches)
- **Silently skipping non-existent entities:** Requirements say tool must refuse to proceed if ANY ID doesn't exist -- never silently skip
- **Modifying publisher.ts:** The publisher is operation-agnostic (takes `Op[]`). Delete ops go through the same path. Do not create a separate delete publisher.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Delete op generation | Custom GraphQL mutations or raw triple deletion | `Graph.deleteEntity()`, `Graph.deleteRelation()` from SDK | SDK handles GRC-20 encoding, ID validation, op type tagging |
| Entity detail fetching | New GraphQL queries | `fetchEntityDetails()` from Phase 1 | Already built and tested; returns all needed data |
| Entity ID parsing | Custom CSV/text parser | `parseEntityIds()` from Phase 1 | Handles validation, dedup, error accumulation |
| Transaction publishing | Custom wallet/IPFS flow | `publishToGeo()` from publisher.ts | Already handles personal + DAO spaces, retries, receipts |
| Report persistence | Custom file writing | `saveOperationReport()` from report.ts | Handles directory creation, naming convention, JSON serialization |
| Confirmation prompt | Custom stdin reading | Pattern from `upsert.ts` `confirmAction()` | Already handles TTY detection, non-interactive error |

**Key insight:** Phase 1 built most of the infrastructure this phase needs. The delete command is primarily a new command handler + a delete-specific op builder. The heavy lifting (API client, parser, publisher, reporter) is already done.

## Common Pitfalls

### Pitfall 1: Backlinks GraphQL Field Availability
**What goes wrong:** The `backlinks` field on the entity query may not be available in the production Geo API, or may behave differently than expected
**Why it happens:** This was flagged in STATE.md: "Backlinks GraphQL field needs runtime verification against public Geo API"
**How to avoid:** Early in implementation, test `fetchEntityDetails()` against a real entity with known backlinks. If the field is missing, fall back to querying `relations` filtered by `toEntityId` to find incoming relations.
**Warning signs:** GraphQL errors mentioning unknown field `backlinks`, or empty backlinks array for entities that are known to have incoming relations

### Pitfall 2: Type Assignment Relation IDs — RESOLVED
**Status:** User testing confirmed type assignment relations appear in the `relations` connection and can be deleted via `Graph.deleteRelation({ id })`. The type badge disappears after deletion. Ensure `fetchEntityDetails()` query captures type relations in its `relations` connection.

### Pitfall 3: Duplicate Relation Deletions Across Entities
**What goes wrong:** Entity A has an outgoing relation to Entity B. When processing Entity A, we delete this relation. When processing Entity B, `backlinks` also lists this same relation. Attempting to delete it again will fail (already deleted).
**Why it happens:** The same relation row appears as an outgoing relation on one entity and a backlink on the other
**How to avoid:** Maintain a `Set<string>` of already-deleted relation IDs. Before calling `Graph.deleteRelation()`, check if the ID is already in the set. Skip if already deleted.
**Warning signs:** SDK/API errors about deleting non-existent relations during batch processing

### Pitfall 4: Transaction Size Limits
**What goes wrong:** Deleting many entities with many relations creates a very large `Op[]` array that exceeds transaction gas limits or IPFS upload size
**Why it happens:** Each entity may have 10-50+ relations/properties, and deleting 100 entities could produce thousands of ops
**How to avoid:** For v1, publish all ops in a single transaction (matching upsert pattern). If this proves problematic, the user can split input files. Transaction splitting is explicitly deferred to v2 (ENH-01 in requirements).
**Warning signs:** Transaction reverts with gas errors, IPFS upload timeouts

### Pitfall 5: Confirmation Prompt Blocking CI
**What goes wrong:** In CI/script environments, the confirmation prompt hangs indefinitely waiting for stdin
**Why it happens:** No TTY available in non-interactive environments
**How to avoid:** The `--force` flag (user decision) skips confirmation. Also, the existing `confirmAction()` in upsert.ts already throws if `!process.stdin.isTTY` -- reuse this pattern. `--force` is the CI-friendly path.
**Warning signs:** CI pipelines hanging on delete commands

### Pitfall 6: Space ID Omission
**What goes wrong:** User runs `geo-publish delete entities.xlsx` without `--space` flag, and the tool either crashes or operates on wrong space
**Why it happens:** Unlike upsert (which reads spaceId from Metadata tab), delete has no Metadata tab
**How to avoid:** Make `--space` a required option for the delete command. Commander can enforce this with `.requiredOption()`.
**Warning signs:** Errors about undefined spaceId during entity detail fetching

## Code Examples

### "Delete" Entity via Unset (Workaround)
```typescript
// Graph.deleteEntity() is NOT functional — Indexer ignores it.
// Instead, unset all property values to blank the entity.
import { Graph } from '@geoprotocol/geo-sdk';

// propertyIds = all property IDs from entity's values connection
const { ops } = Graph.updateEntity({
  id: entityId,
  unset: propertyIds.map(property => ({ property })),
});
// Entity will appear blank in Geo Browser after this
```

### Delete Relation with SDK
```typescript
// Source: github.com/graphprotocol/grc-20-ts/src/graph/delete-relation.ts
import { Graph } from '@geoprotocol/geo-sdk';

const { id, ops } = Graph.deleteRelation({ id: relationRowId });
// ops = [{ type: 'deleteRelation', id: '<grc-id>' }]
```

### Fetch Entity Details (existing from Phase 1)
```typescript
// Source: src/api/geo-client.ts
import { fetchEntityDetails } from '../api/geo-client.js';

const details = await fetchEntityDetails(entityId, spaceId, network);
// details.values     -- property triples
// details.relations  -- outgoing relations with { id, typeId, toEntity }
// details.backlinks  -- incoming relations with { id, typeId, fromEntity }
// details.typeIds    -- type assignment IDs
// details.name       -- entity name (for display)
```

### Parse Entity IDs (existing from Phase 1)
```typescript
// Source: src/parsers/entity-id-parser.ts
import { parseEntityIds } from '../parsers/entity-id-parser.js';

const { ids, errors } = parseEntityIds(filePath, tabName);
// ids = ['5cade5757ecd41ae83481b22ffc2f94e', ...]
// errors = ['Row 5: "xyz" is not a valid entity ID (expected 32-char hex string)']
```

### Publish Ops Through Existing Pipeline
```typescript
// Source: src/publishers/publisher.ts
// Delete ops are Op[] just like create ops -- same publish path
import { publishToGeo } from '../publishers/publisher.js';

const batch = { ops: deleteOps, summary: deleteSummary };
const metadata = { spaceId, spaceType: 'Personal' }; // or 'DAO'
const result = await publishToGeo(batch, metadata, privateKey, options);
```

### Save Pre-Deletion Snapshot
```typescript
// Pattern for snapshot saving
import * as fs from 'fs';
import * as path from 'path';

function saveSnapshot(entities: EntityDetails[], dir: string): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString()
    .replace(/:/g, '-').replace(/\./g, '-');
  const filename = `delete-snapshot-${timestamp}.json`;
  const filepath = path.join(dir, filename);

  fs.writeFileSync(filepath, JSON.stringify(entities, null, 2));
  return filepath;
}
```

### Remaining-Entities CSV Output
```typescript
// On failure, write unprocessed IDs for re-run
function writeRemainingCsv(
  remainingIds: string[],
  outputDir: string
): string {
  const timestamp = new Date().toISOString()
    .replace(/:/g, '-').replace(/\./g, '-');
  const filename = `remaining-entities-${timestamp}.csv`;
  const filepath = path.join(outputDir, filename);

  // Header + one ID per line (Excel-compatible)
  const content = 'entity_id\n' + remainingIds.join('\n') + '\n';
  fs.writeFileSync(filepath, content);
  return filepath;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@geoprotocol/geo-sdk` (project dependency) | `@graphprotocol/grc-20` (upstream name) | Package rename/upstream change | Import path may differ; verify at install time. Project currently uses `@geoprotocol/geo-sdk` which re-exports the same `Graph` API. |
| Custom GraphQL mutations for deletion | `Graph.deleteEntity()` / `Graph.deleteRelation()` SDK methods | Available in current SDK | Use SDK methods -- they handle GRC-20 op encoding correctly |

**Deprecated/outdated:**
- `relationsList` field: Use `relations` connection pattern instead (decision from Phase 1) -- `relationsList` does not expose relation row IDs needed for deletion

## Open Questions

1. **Type Assignment Relation Cleanup** — RESOLVED
   - **Answer:** Type assignments ARE relations. They appear in the entity's `relations` connection with their own relation IDs. `Graph.deleteRelation({ id })` successfully removes type badges. Confirmed by user testing on testnet: deleting the type relation made the "Episode" badge disappear.

2. **Backlinks API Availability** — PARTIALLY RESOLVED
   - What we know: The GraphQL API supports querying incoming relations. User successfully queried backlinks via the `relationsTo` connection on the entity query. The "Referenced by" section in Geo Browser shows these incoming relations.
   - What's still unclear: Whether the Phase 1 `fetchEntityDetails()` query includes backlinks or if the query needs updating. The `ENTITY_DETAILS_QUERY` may need to include `relationsTo` (or equivalent) to capture incoming relations.
   - Recommendation: Verify the existing query covers incoming relations. If not, extend it.

3. **publishToGeo Metadata Shape for Delete**
   - What we know: `publishToGeo()` takes a `Metadata` object that includes `spaceType` ('Personal' | 'DAO'). Delete command gets spaceId from `--space` flag but has no Metadata tab for spaceType.
   - What's unclear: How to determine spaceType from just a space ID.
   - Recommendation: Either add a `--space-type` flag (simple), auto-detect from API (query space info), or default to 'Personal' with override option.

4. **Relation Junction Entities** — LOW PRIORITY
   - User testing showed `Graph.deleteRelation()` works correctly — relations disappear from the entity. Junction entity cleanup appears to be handled by the protocol layer. No explicit action needed.

5. **Entity Shell After "Deletion"** — NEW
   - After unsetting all properties and deleting all relations, the entity ID still exists in the graph — it just has no visible data. This is the expected behavior since `deleteEntity` is non-functional.
   - This means "deleted" entities may still appear in queries with empty data. The success criteria "querying any deleted entity returns no properties, no relations, and no backlinks" is satisfied — the entity returns empty results.

## Sources

### Primary (HIGH confidence)
- `src/api/geo-client.ts` -- EntityDetails interface, fetchEntityDetails(), ENTITY_DETAILS_QUERY
- `src/parsers/entity-id-parser.ts` -- parseEntityIds(), EntityIdParseResult
- `src/commands/upsert.ts` -- Command handler pattern, confirmAction(), resolveNetwork()
- `src/publishers/publisher.ts` -- publishToGeo(), personalSpace/daoSpace integration
- `src/publishers/report.ts` -- saveOperationReport()
- `src/config/types.ts` -- DeleteReport, ReportBase, OperationReport
- `src/cli.ts` -- Commander subcommand pattern, delete stub
- [github.com/graphprotocol/grc-20-ts/src/graph/delete-entity.ts](https://github.com/graphprotocol/grc-20-ts/tree/main/src/graph) -- `Graph.deleteEntity({ id })` returns `{ id, ops: Op[] }`
- [github.com/graphprotocol/grc-20-ts/src/graph/delete-relation.ts](https://github.com/graphprotocol/grc-20-ts/tree/main/src/graph) -- `Graph.deleteRelation({ id })` returns `{ id, ops: Op[] }`
- [github.com/graphprotocol/grc-20-ts/src/types.ts](https://github.com/graphprotocol/grc-20-ts/tree/main/src) -- DeleteEntityParams, DeleteRelationParams, CreateResult types

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` -- Blockers: backlinks verification, relation junction IDs
- `.planning/phases/01-*/01-03-SUMMARY.md` -- Phase 1 decisions: connection pattern, parser pattern

### User-Verified (testnet, 2026-02-25)
- `Graph.deleteEntity()` is NOT functional — Indexer ignores the op (confirmed by Geo team)
- `Graph.updateEntity({ id, unset })` successfully clears property values
- `Graph.deleteRelation({ id })` successfully removes relations (outgoing + incoming)
- Type assignment relations can be deleted via `Graph.deleteRelation()` — type badge disappears
- GraphQL API at `https://testnet-api.geobrowser.io/graphql` provides entity values, relations, and backlinks

### External References
- Geo SDK source: https://github.com/geobrowser/geo-sdk/tree/main
- Geo GraphQL API: https://testnet-api.geobrowser.io/graphql

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project, no new dependencies
- Architecture: HIGH -- follows established upsert.ts pattern; deleteEntity workaround confirmed via user testing on testnet
- Pitfalls: HIGH -- most runtime questions resolved by user testing (type assignments, deleteRelation, updateEntity unset all confirmed working)

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable -- project dependencies pinned, SDK API unlikely to change in 30 days)
