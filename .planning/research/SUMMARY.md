# Project Research Summary

**Project:** spreadsheet-to-geo (bulk operations milestone: delete, update, merge)
**Domain:** Bulk data operations CLI for Geo protocol GRC-20 knowledge graph
**Researched:** 2026-02-19
**Confidence:** HIGH

## Executive Summary

This project extends an existing, working upsert CLI tool with three new destructive bulk operations: delete, update, and merge. The Geo SDK (v0.9.0) already exports all required primitives — `Graph.deleteEntity()`, `Graph.deleteRelation()`, `Graph.updateEntity()` — and the existing publish pipeline is already operation-agnostic (it accepts any `Op[]` array). No new dependencies are required. The main engineering work is in two areas: (1) the **query layer**, which must be extended to fetch entity state (properties, outgoing relations, and incoming/backlinks) before destructive operations can be safely constructed, and (2) the **architecture refactoring**, which must decompose the current monolithic `index.ts` into a subcommand-based CLI with per-operation pipeline handlers.

The critical non-obvious constraint is that Geo's `deleteEntity` is not a cascade delete — it emits exactly one op that soft-deletes the entity node, leaving all associated relations and property triples as orphans. Every delete (and every merge's cleanup step) must first query the API for all outgoing relations, all incoming relations (backlinks), and type-assignment relations, then generate `deleteRelation` ops for each before emitting the `deleteEntity` op. Relation IDs (not entity IDs) are required for delete, meaning the GraphQL queries must explicitly request the `id` field on relation nodes via the `relations { nodes { id ... } }` connection pattern. The simpler `relationsList` field used elsewhere in the codebase does not expose relation IDs.

The recommended build order strictly follows dependency logic: (1) extract the CLI layer and add shared infrastructure (CSV parser, entity detail queries, generalized report), (2) implement delete as the foundational destructive operation, (3) implement update which reuses the most existing code, (4) implement merge last as it depends on both delete and update being correct. Merge is the highest-risk operation: a partial merge (copy succeeded but cleanup failed, or vice versa) permanently corrupts the knowledge graph with no native rollback. All merge ops for a given pair must be published as a single atomic `publishEdit` call.

## Key Findings

### Recommended Stack

No new dependencies are required. All functionality is available through the existing geo-sdk (`@geoprotocol/geo-sdk@0.9.0`) and direct `fetch()`-based GraphQL calls via the existing `executeQuery()` helper in `src/api/geo-client.ts`. The existing `publishToGeo()` pipeline in `src/publishers/publisher.ts` is already fully generic and requires no changes for delete or update ops.

**Core technologies:**
- `@geoprotocol/geo-sdk@0.9.0`: All SDK operations (delete, update, create) — already pinned, exports `Graph.deleteEntity`, `Graph.updateEntity`, `Graph.deleteRelation` confirmed from source
- `@geoprotocol/grc-20@0.4.0` (transitive): 9 GRC-20 Op types including `DeleteEntity` (3), `UpdateEntity` (2), `DeleteRelation` (7) — wire codes confirmed from type definitions
- `viem@^2.21.0`: Blockchain transaction signing — already in use, no changes needed
- `commander@^12.1.0`: CLI framework — extend with subcommands for new operations

**Existing code to extend (not replace):**
- `src/api/geo-client.ts` — add `fetchEntityDetails()` and `fetchIncomingRelations()` using the `relations { nodes { id } }` and `backlinks { nodes { id } }` GraphQL connection patterns
- `src/processors/batch-builder.ts` — add `buildDeleteBatch()`, `buildUpdateBatch()`, `buildMergeBatch()`
- `src/config/schema.ts` — split into shared types + operation-specific types
- `src/index.ts` — replace with thin CLI router (`cli.ts`) and per-operation command handlers

### Expected Features

**Must have (table stakes) — v1:**
- Delete: CSV input of entity IDs, validate existence, delete all triples (properties + outgoing relations + incoming backlinks + type assignments), soft delete entity, dry-run mode, summary report
- Update: Excel input (same format as existing upsert plus entity ID column), validate entity exists, overwrite property values via `updateEntity`, unset explicitly cleared fields, dry-run mode, summary report
- Merge: CSV input of keeper_id/merger_id pairs, validate both exist, copy non-conflicting properties from merger to keeper, re-point merger's incoming relations to keeper, delete merger, dry-run mode, summary report
- Entity ID-based GraphQL queries: `fetchEntityDetails()` returning properties + relation IDs + backlink IDs

**Should have (differentiators) — v1.x:**
- Entity name display alongside IDs in all confirmations and reports (dramatically improves operator trust)
- Merge conflict detection logging ("keeper already has X, skipping merger's value for X")
- Batch progress reporting for large operations ("Processing 47/523...")
- Pre-operation snapshot report as audit trail (entity data before delete/merge)

**Defer (v2+):**
- Idempotent re-runs with checkpoint files
- Batch transaction splitting with automatic sub-batch management
- Incoming relation discovery improvements if initial query approach is too slow

**Anti-features (reject if requested):**
- Cascade delete (unbounded in knowledge graphs)
- Update/delete by entity name (names are not unique identifiers in Geo)
- Undo/rollback command (blockchain is irreversible)
- Cross-space operations (violates space governance)

### Architecture Approach

The recommended architecture decomposes the current monolithic `index.ts` into a `cli.ts` entry that routes to operation-specific command handlers in `src/commands/`. Each command handler owns its full pipeline (parse -> validate -> resolve -> build ops -> publish -> report) and imports only the shared infrastructure it needs. Shared infrastructure (API client, publisher, logger, cell parsers) is unchanged; operation-specific logic (validators, batch builders, type definitions) is isolated per operation. The refactoring has 8 sequential-then-parallel steps with Step 1 (CLI extraction) as the prerequisite for all others.

**Major components:**
1. `src/cli.ts` — Commander.js subcommand router; backward-compatible (bare command still runs upsert)
2. `src/commands/{upsert,delete,update,merge}.ts` — per-operation pipeline orchestrators
3. `src/api/geo-client.ts` (extended) — GraphQL client adding entity detail + backlinks queries
4. `src/parsers/csv-parser.ts` (new) — CSV parsing for delete and merge inputs
5. `src/processors/batch-builders/{delete,update,merge}-batch.ts` (new) — operation-specific `Op[]` builders
6. `src/publishers/report.ts` (generalized) — discriminated union `OperationReport` type covering all 4 operations

### Critical Pitfalls

1. **Incomplete entity deletion leaves orphaned triples** — `Graph.deleteEntity()` emits exactly 1 op and does NOT cascade. Must query and explicitly delete all outgoing relations, backlinks, and type-assignment relations before calling `deleteEntity`. Operation ordering matters: all `deleteRelation` ops must precede `deleteEntity` ops in the batch.

2. **Relation IDs are required but not currently queried** — `Graph.deleteRelation({ id })` requires the relation's own ID, not the from/to entity IDs. Relation IDs cannot be derived from entity pairs. Must use `relations { nodes { id ... } }` connection pattern (not the simpler `relationsList` which omits `id`). This is the prerequisite API enhancement for all delete operations.

3. **Missing backlinks API query** — The current `geo-client.ts` only queries outgoing relations. Both delete and merge need incoming relations (entities pointing TO the target). Must add a `backlinks` query. Confirmed available in Hypergraph API (from `relation-query-helpers.ts`) but needs runtime verification against the public endpoint.

4. **Merge overwrites keeper data instead of preserving it** — The SDK's `updateEntity` set operation is unconditional. Must query keeper's current property values first, diff against merger's values, and only include properties in the `set` array that the keeper does NOT already have. No "set if not exists" primitive exists; the diff must be implemented in the tool.

5. **Partial merge is permanent corruption** — All ops for a single keeper+merger pair must be in one `publishEdit` call (atomic). If combined ops exceed batch size limits, the tool must refuse to merge that pair rather than splitting across transactions. Blockchain operations are irreversible — a half-completed merge has no recovery path.

6. **Update command must use `updateEntity`, not `createEntity`** — The existing batch builder uses `Graph.createEntity()` which has upsert/LWW semantics but cannot unset (remove) property values. Update requires `Graph.updateEntity()` with explicit `unset` ops for cleared cells. Reusing the create path for updates is never acceptable.

## Implications for Roadmap

Based on research, suggested phase structure with explicit dependency ordering:

### Phase 0: CLI Refactoring and Shared Infrastructure
**Rationale:** The current monolithic `index.ts` makes adding subcommands impossible without duplication. This is the prerequisite for all subsequent phases. Can be done without touching existing upsert functionality — upsert just moves to `src/commands/upsert.ts` with backward-compatible CLI routing.
**Delivers:** `src/cli.ts` with subcommand routing, `src/commands/upsert.ts` (extracted pipeline), `src/parsers/csv-parser.ts`, `src/config/types.ts` (shared types extracted from `schema.ts`), `src/publishers/report.ts` (generalized `OperationReport`). Existing upsert functionality unchanged.
**Addresses:** Architecture anti-pattern (God Orchestrator), backward compatibility requirement
**Avoids:** Breaking existing `geo-publish <file>` invocations during refactoring

### Phase 1: Entity Detail API + Delete Command
**Rationale:** Delete is the foundational destructive operation. It requires building the entity detail query infrastructure (fetchEntityDetails + fetchIncomingRelations) that merge also depends on. Delete is also more constrained than merge — it has no diffing logic — making it the right place to validate the query and batch-building patterns. Get delete right first; merge will inherit these patterns.
**Delivers:** `fetchEntityDetails()` and `fetchIncomingRelations()` in `geo-client.ts`, `src/processors/batch-builders/delete-batch.ts`, `src/commands/delete.ts`, dry-run with entity name + relation count display, `--confirm-irreversible` safety flag, summary report
**Addresses:** Delete all triples (P1), validate IDs exist (P1), dry-run (P1), entity ID-based queries (P1)
**Avoids:** Pitfalls 1, 2, 3 (orphaned triples, missing relation IDs, missing backlinks)
**Research flag:** Needs runtime verification that the `backlinks` GraphQL field is available on the public Geo API endpoint. If unavailable, an alternative incoming-relation strategy is needed before this phase can complete.

### Phase 2: Update Command
**Rationale:** Update is the most independent new operation — it reuses the most existing code (Excel parser, property resolution, value conversion) and only requires the entity-detail query from Phase 1 for validation. It does NOT require backlinks query or the delete infrastructure. Update also validates the `updateEntity` batch builder pattern in isolation before it is embedded in the more complex merge flow.
**Delivers:** `src/parsers/validators/update-validator.ts`, `src/processors/batch-builders/update-batch.ts`, `src/commands/update.ts`. Update spreadsheet format adds Geo ID column alongside existing format. Dry-run, unset support for cleared cells, summary report.
**Addresses:** Update overwrite properties (P1), entity ID column (P1), dry-run (P1), type-aware value conversion (reused, already P1)
**Avoids:** Pitfall 4 (update using create semantics instead of `updateEntity`)
**Research flag:** Update is standard patterns — no deeper research phase needed. Well-documented SDK with test coverage.

### Phase 3: Merge Command
**Rationale:** Merge depends on both Phase 1 (delete infrastructure for merger cleanup) and Phase 2 (updateEntity pattern for property transfer). It is the most complex operation and must come last to inherit validated building blocks. The risk of partial merge (permanent data corruption) makes it essential that delete and update are well-tested before merge combines them.
**Delivers:** `src/parsers/validators/merge-validator.ts`, `src/processors/batch-builders/merge-batch.ts`, `src/commands/merge.ts`. Property diff logic (keeper wins), relation re-pointing, atomic merge-pair batches, `--merge-max-batch-size` safety limit, dry-run showing COPY/KEEP/CONFLICT columns, summary report.
**Addresses:** Copy properties no-overwrite (P1), transfer relations (P1), delete merger (P1), dry-run (P1)
**Avoids:** Pitfalls 3, 5, 7 (merger overwrite, partial merge execution, incoming relation re-pointing)
**Research flag:** Needs careful integration testing with real merge pairs on testnet before mainnet use. The backlinks-to-keeper re-pointing logic (create new relation on keeper + delete old relation on merger) is a novel pattern in this codebase with no existing precedent.

### Phase 4: Polish and Hardening (v1.x)
**Rationale:** Features that improve operator trust and safety but do not block core functionality. Add after core operations are validated on real data.
**Delivers:** Entity names in all output (P2), batch progress reporting (P2), merge conflict logging (P2), pre-operation snapshot reports (P3), `--batch-size` tuning based on empirical testing
**Addresses:** UX pitfalls (silent failures, meaningless IDs in errors), performance traps (sequential API queries, missing progress indicators)
**Research flag:** Transaction size limits need empirical measurement on testnet before implementing automatic batch splitting.

### Phase Ordering Rationale

- Phase 0 must precede all others: adding subcommands to a monolithic CLI is a prerequisite, not a refactor that can happen in parallel
- Phase 1 before Phase 3: merge's merger-deletion step is structurally identical to delete; building delete first means merge inherits tested logic rather than reimplementing it
- Phase 2 before Phase 3: merge's keeper-update step uses `updateEntity`; building update first validates the batch builder pattern that merge will compose
- Phase 2 is independent of Phase 1: update does not need backlinks queries; it can proceed in parallel with Phase 1 after Phase 0 completes
- Phase 4 is always last: polish requires stable underlying operations

### Research Flags

Phases needing deeper research or runtime verification during implementation:
- **Phase 1 (Delete):** The `backlinks` GraphQL field for incoming relations needs runtime verification against the public API before the delete command can handle incoming relations correctly. If the field is unavailable or has different semantics than the Hypergraph source suggests, an alternative strategy (query all relations in space, filter client-side) will be needed.
- **Phase 3 (Merge):** Integration testing on testnet with real entity pairs before mainnet use. The re-pointing pattern (delete relation on source entity, create equivalent relation from same entity to keeper) is novel for this codebase.
- **Phase 4 (Transaction limits):** Empirical measurement needed to set a safe default for `--batch-size`. The current codebase has no size checking and no documented limits.

Phases with standard patterns (skip additional research):
- **Phase 0 (CLI refactoring):** Commander.js subcommand patterns are well-documented. Mechanical extraction of existing code.
- **Phase 2 (Update):** SDK `updateEntity` is thoroughly tested (630 lines of test coverage in `update-entity.test.ts`). Value conversion already implemented. Standard patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings from direct source code analysis of geo-sdk@0.9.0, grc-20@0.4.0, and existing codebase. No new dependencies required — confirmed by reading all relevant modules. |
| Features | HIGH | SDK operation capabilities confirmed from source + tests. Feature decisions (ID-based targeting, no name-matching for destructive ops) derived from protocol constraints, not opinion. |
| Architecture | HIGH | Current codebase read directly. Refactoring plan based on concrete coupling problems identified in existing `index.ts`. Subcommand pattern is standard Commander.js. |
| Pitfalls | HIGH | All pitfalls derived from reading actual SDK source (delete-entity.ts, update-entity.ts, create-relation.ts). Not inferred — e.g., the orphaned-relation problem is visible from reading the single `deleteEntity` op emitted. |
| Backlinks API | MEDIUM | Hypergraph query builder source confirms `backlinks` field exists and is constructed, but the public API endpoint behavior needs runtime verification. |
| Transaction size limits | LOW | No concrete numbers found in source. General blockchain constraints cited. Empirical testing needed before implementing auto-splitting. |

**Overall confidence:** HIGH for core implementation decisions; MEDIUM for API behavior at edges (backlinks, transaction limits).

### Gaps to Address

- **Backlinks field availability:** During Phase 1 implementation, the first task should be a short spike: call the Geo testnet API with the `backlinks` query and confirm the field exists and returns the expected data shape. If it does not, design an alternative (e.g., maintain a space-scoped relation index, or query all relations with a `toEntityId` filter if the API supports it).
- **Transaction size limits:** During Phase 1 testing, deliberately construct a large delete batch (100+ entities with relations) and observe at what op count IPFS uploads or transactions fail. Use that number to set the default `--batch-size`.
- **Relation junction entity IDs:** Each Geo relation has both a relation ID and a junction entity ID. Research confirmed both may need deletion (`relation.id` and `relation.entity.id`). Verify during Phase 1 implementation whether the junction entity also requires explicit deletion or whether deleting the relation is sufficient.
- **Entity ID format for CSV input:** Confirm whether entity IDs in CSV inputs should be in UUID format (as used by the GraphQL API) or GRC-20 base58 format (used internally by the SDK). The `assertValid()` function in the SDK validates format.

## Sources

### Primary (HIGH confidence — direct source code analysis)

- `submodules/geo-sdk/src/graph/` — delete-entity.ts, delete-relation.ts, update-entity.ts, update-relation.ts, create-entity.ts, create-relation.ts (all read with test files)
- `submodules/geo-sdk/src/core/ids/system.ts` — TYPES_PROPERTY, COVER_PROPERTY system IDs
- `node_modules/@geoprotocol/grc-20/dist/types/op.d.ts` — all 9 Op type definitions with wire codes
- `submodules/hypergraph/packages/hypergraph/src/utils/relation-query-helpers.ts` — confirms `relations { nodes { id } }` and `backlinks` patterns
- `submodules/hypergraph/packages/hypergraph/src/utils/convert-relations.ts` — confirms `RelationsListItem` includes `id: string`
- `submodules/hypergraph/packages/mcp-server/src/graphql-client.ts` — GraphQL query patterns
- `src/api/geo-client.ts` — existing GraphQL client (search, executeQuery)
- `src/processors/batch-builder.ts` — existing create-only batch builder
- `src/publishers/publisher.ts` — existing generic publish pipeline
- `src/index.ts` — existing monolithic CLI + pipeline (identified coupling problems)
- `src/config/schema.ts` — existing type definitions

### Secondary (MEDIUM confidence)

- `submodules/hypergraph/packages/hypergraph/src/entity/delete.ts` — Hypergraph local delete (shows outgoing-only pattern)
- Geo protocol GRC-20 spec embedded in SDK source — upsert/LWW semantics for `CreateEntity`

### Tertiary (LOW confidence — inference or unverified)

- Transaction size limits: general blockchain constraints, no concrete numbers found in source
- Backlinks field on public API: confirmed in query builder source, but public endpoint behavior not runtime-verified

---
*Research completed: 2026-02-19*
*Ready for roadmap: yes*
