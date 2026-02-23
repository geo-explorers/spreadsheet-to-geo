# Architecture Research

**Domain:** Multi-operation CLI tool refactored from single-pipeline design
**Researched:** 2026-02-19
**Confidence:** HIGH

## Current Architecture Analysis

### Existing Structure (as-is)

```
src/
├── index.ts                    # CLI entry + monolithic orchestrator (216 lines)
├── api/
│   └── geo-client.ts           # GraphQL search queries
├── config/
│   └── schema.ts               # All interfaces (types, entities, batches, publishing)
├── parsers/
│   ├── excel-parser.ts         # XLSX reading + tab extraction
│   └── validators.ts           # Upsert-specific validation rules
├── processors/
│   ├── entity-processor.ts     # Entity resolution (API queries + ID assignment)
│   ├── relation-builder.ts     # Relation extraction from entity properties
│   └── batch-builder.ts        # SDK operation construction (create ops only)
├── publishers/
│   ├── publisher.ts            # Blockchain transaction submission
│   └── publish-report.ts       # Report generation + formatting
└── utils/
    ├── logger.ts               # Structured CLI logging
    └── cell-parsers.ts         # Value parsing + normalization
```

### Current Coupling Problems

The current `src/index.ts` is a monolithic orchestrator that hard-wires a 7-step upsert pipeline. Specific problems for multi-operation support:

1. **CLI setup and pipeline logic are merged.** Commander.js program setup, option parsing, and the entire upsert flow live in one function. Adding subcommands means either duplicating the CLI boilerplate or extracting it.

2. **Validation is upsert-specific.** `validators.ts` assumes Metadata/Types/Properties tabs exist, validates entity columns against Properties tab, and checks reference integrity -- all specific to upsert's spreadsheet format. Delete takes a CSV of entity IDs. Update and merge have different validation needs.

3. **Entity resolution assumes CREATE/LINK semantics.** The `buildEntityMap()` function assumes every entity is either being created or linked. Update needs EXISTING-only semantics (entity must exist). Delete needs EXISTING-only. Merge needs EXISTING for both keeper and merger.

4. **Batch builder only knows create operations.** `buildOperationsBatch()` calls `Graph.createProperty`, `Graph.createType`, `Graph.createEntity`, `Graph.createRelation`. It has no concept of `Graph.updateEntity`, `Graph.deleteEntity`, `Graph.deleteRelation`.

5. **Report generation is upsert-shaped.** `PublishReport` interface tracks typesCreated/typesLinked/entitiesCreated/entitiesLinked -- meaningless for delete or merge operations.

6. **Publishing is operation-agnostic.** Good news: `publishToGeo()` takes an `OperationsBatch` (which is just `ops: Op[]` + summary) and publishes it. This is already generic. The publisher and wallet setup do not care what kind of ops they are submitting.

### What Changes, What Stays

| Component | Shared Across Ops? | Needs Refactoring? | Notes |
|-----------|--------------------|--------------------|-------|
| `utils/logger.ts` | YES | NO | Fully generic already |
| `utils/cell-parsers.ts` | YES | NO | Generic parsing utilities |
| `api/geo-client.ts` | YES | EXTEND | Need new queries for entity details (triples, relations) |
| `publishers/publisher.ts` | YES | MINOR | Already accepts generic `Op[]`. Needs operation-type label for edit names |
| `config/schema.ts` | PARTIALLY | SPLIT | Core types shared, operation-specific types separated |
| `parsers/excel-parser.ts` | PARTIALLY | NO | Upsert and update use it. Delete and merge use CSV parsing (new) |
| `parsers/validators.ts` | NO | REPLACE | Each operation needs its own validator |
| `processors/entity-processor.ts` | PARTIALLY | EXTRACT | Entity resolution logic reusable; CREATE/LINK assumption must be parameterized |
| `processors/relation-builder.ts` | NO | KEEP for upsert | Only upsert builds new relations from spreadsheet columns |
| `processors/batch-builder.ts` | NO | KEEP for upsert | Each operation builds ops differently |
| `publishers/publish-report.ts` | PARTIALLY | GENERALIZE | Report structure must accommodate all operation types |
| `index.ts` | NO | REPLACE | Becomes thin CLI router to subcommand handlers |

## Recommended Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLI Layer (Commander.js)                      │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ upsert  │  │  update   │  │  delete   │  │  merge   │          │
│  └────┬────┘  └────┬──────┘  └────┬──────┘  └────┬─────┘          │
│       │            │              │              │                │
├───────┴────────────┴──────────────┴──────────────┴────────────────┤
│                   Shared Infrastructure                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐       │
│  │ Parsing  │  │ API      │  │ Publish  │  │ Reporting    │       │
│  │ (xlsx/   │  │ Client   │  │ Engine   │  │ (generic)    │       │
│  │  csv)    │  │ (graphql)│  │          │  │              │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐         │
│  │ Logger   │  │ Cell     │  │ Schema / Types            │         │
│  │          │  │ Parsers  │  │                           │         │
│  └──────────┘  └──────────┘  └──────────────────────────┘         │
└───────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── cli.ts                        # CLI entry: Commander.js program + subcommand routing
├── commands/                     # One handler per subcommand
│   ├── upsert.ts                 # Upsert pipeline (extracted from current index.ts)
│   ├── update.ts                 # Update pipeline
│   ├── delete.ts                 # Delete pipeline
│   └── merge.ts                  # Merge pipeline
├── api/                          # External API clients (shared)
│   └── geo-client.ts             # GraphQL client (extended with entity detail queries)
├── config/                       # Type definitions (shared + operation-specific)
│   ├── types.ts                  # Shared types: Metadata, PublishOptions, PublishResult, etc.
│   ├── upsert-types.ts           # Upsert-specific: ParsedSpreadsheet, EntityMap, etc.
│   ├── update-types.ts           # Update-specific: UpdateTarget, UpdateBatch, etc.
│   ├── delete-types.ts           # Delete-specific: DeleteTarget, DeleteBatch, etc.
│   └── merge-types.ts            # Merge-specific: MergePair, MergeBatch, etc.
├── parsers/                      # Input parsing (shared)
│   ├── excel-parser.ts           # XLSX parsing (used by upsert + update)
│   ├── csv-parser.ts             # CSV parsing (used by delete + merge)
│   └── validators/               # Operation-specific validators
│       ├── upsert-validator.ts   # Extracted from current validators.ts
│       ├── update-validator.ts   # Validates update spreadsheet
│       ├── delete-validator.ts   # Validates delete CSV
│       └── merge-validator.ts    # Validates merge CSV
├── processors/                   # Data transformation
│   ├── entity-processor.ts       # Shared entity resolution (parameterized)
│   ├── relation-builder.ts       # Upsert-specific relation extraction
│   └── batch-builders/           # Operation-specific SDK op construction
│       ├── upsert-batch.ts       # Extracted from current batch-builder.ts
│       ├── update-batch.ts       # Uses Graph.updateEntity
│       ├── delete-batch.ts       # Uses Graph.deleteEntity + Graph.deleteRelation
│       └── merge-batch.ts        # Combines update + delete ops
├── publishers/                   # Blockchain publishing (shared)
│   ├── publisher.ts              # Transaction submission (already generic)
│   └── report.ts                 # Generalized report generation
└── utils/                        # Shared utilities (no changes needed)
    ├── logger.ts                 # Structured logging
    └── cell-parsers.ts           # Value parsing and normalization
```

### Structure Rationale

- **`commands/`:** Each operation is a self-contained pipeline handler. Clean separation prevents operations from leaking into each other. Each file owns its full orchestration flow (parse -> validate -> resolve -> build ops -> publish -> report).
- **`config/` split:** Shared types (Metadata, PublishOptions, network config) in `types.ts`. Operation-specific interfaces isolated so upsert types do not bloat delete's scope. The current monolithic `schema.ts` becomes hard to navigate with 4 operations' types mixed together.
- **`parsers/validators/` directory:** Each operation has fundamentally different validation rules. A validators directory is cleaner than one bloated file.
- **`processors/batch-builders/` directory:** Each operation generates different SDK ops. Upsert calls `createEntity/createRelation`. Update calls `updateEntity`. Delete calls `deleteRelation` then `deleteEntity`. Merge calls a combination. These must be separate.
- **`parsers/csv-parser.ts`:** New file. Delete and merge operations take CSV input (entity IDs), not Excel spreadsheets with tabs.

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `cli.ts` | CLI argument parsing, subcommand routing, shared option inheritance | `commands/*` |
| `commands/upsert.ts` | Full upsert pipeline orchestration | parsers, validators, entity-processor, upsert-batch, publisher, report |
| `commands/delete.ts` | Full delete pipeline orchestration | csv-parser, delete-validator, geo-client, delete-batch, publisher, report |
| `commands/update.ts` | Full update pipeline orchestration | excel-parser, update-validator, entity-processor, update-batch, publisher, report |
| `commands/merge.ts` | Full merge pipeline orchestration | csv-parser, merge-validator, geo-client, merge-batch, publisher, report |
| `api/geo-client.ts` | GraphQL queries: search + entity detail fetching | Geo API (external) |
| `parsers/excel-parser.ts` | Read XLSX files, extract structured tab data | xlsx library, cell-parsers |
| `parsers/csv-parser.ts` | Read CSV files, extract rows | Node.js fs or csv-parse library |
| `processors/entity-processor.ts` | Resolve entity names to Geo IDs via API | geo-client |
| `processors/batch-builders/*` | Convert resolved data into SDK `Op[]` arrays | Geo SDK (Graph module) |
| `publishers/publisher.ts` | Submit `Op[]` as blockchain transaction | Geo SDK, viem |
| `publishers/report.ts` | Generate human-readable operation reports | fs |

## Data Flow

### Upsert Flow (existing, relocated)

```
CLI args (file, network, dry-run)
    |
    v
[excel-parser] --> ParsedSpreadsheet
    |
    v
[upsert-validator] --> ValidationResult (pass/fail)
    |
    v
[entity-processor] --> EntityMap (CREATE/LINK decisions via API)
    |
    v
[relation-builder] --> RelationToCreate[]
    |
    v
[upsert-batch] --> Op[] (createProperty, createType, createEntity, createRelation)
    |
    v
[publisher] --> PublishResult (transaction hash)
    |
    v
[report] --> saved JSON report file
```

### Delete Flow (new)

```
CLI args (csv-file, network, dry-run)
    |
    v
[csv-parser] --> EntityId[] (list of entity IDs to delete)
    |
    v
[delete-validator] --> validate IDs are well-formed, non-empty
    |
    v
[geo-client.fetchEntityDetails] --> EntityDetails[] (triples: relations, properties, types)
    |
    v
[delete-batch] --> Op[] ordered:
    1. deleteRelation() for each incoming+outgoing relation
    2. deleteEntity() for each entity
    |
    v
[publisher] --> PublishResult
    |
    v
[report] --> saved JSON report (entities deleted, relations removed)
```

Key requirement: The Geo protocol requires all relations and property triples to be removed before an entity can be deleted. The delete batch builder must query the API for each entity's current state (all relations pointing to and from it) and generate delete ops in the correct order.

### Update Flow (new)

```
CLI args (file, network, dry-run)
    |
    v
[excel-parser] --> ParsedSpreadsheet (same format as upsert)
    |
    v
[update-validator] --> validate all entities exist in Geo (no CREATE allowed)
    |
    v
[entity-processor] --> EntityMap (all should resolve as EXISTING)
    |
    v
[update-batch] --> Op[] (updateEntity for each entity with new property values)
    |
    v
[publisher] --> PublishResult
    |
    v
[report] --> saved JSON report (entities updated, properties changed)
```

Key difference from upsert: Update does NOT create new entities/types/properties. All referenced entities must already exist. The entity-processor is reused but with a mode flag that rejects CREATE actions.

### Merge Flow (new)

```
CLI args (csv-file, network, dry-run)
    |
    v
[csv-parser] --> MergePair[] (keeper_id, merger_id pairs)
    |
    v
[merge-validator] --> validate both IDs exist in Geo
    |
    v
[geo-client.fetchEntityDetails] --> full state for both keeper and merger
    |
    v
[merge-batch] --> Op[] ordered:
    1. updateEntity(keeper) - append merger's properties not already on keeper
    2. Re-point merger's incoming relations to keeper
    3. deleteRelation() for merger's remaining relations
    4. deleteEntity(merger)
    |
    v
[publisher] --> PublishResult
    |
    v
[report] --> saved JSON report (pairs merged, properties transferred, relations moved)
```

Key complexity: Merge must compare keeper and merger state, transfer properties only if the keeper lacks them, re-point relations from merger to keeper, then delete the merger. This is the most complex operation.

## Architectural Patterns

### Pattern 1: Subcommand Handler Pattern

**What:** Each subcommand is a standalone async function that receives parsed CLI options and orchestrates its own pipeline. The CLI layer only handles argument parsing and delegates.

**When to use:** Always -- this is the core architectural pattern for the refactoring.

**Trade-offs:** Slight code duplication in boilerplate (loading env vars, setting verbose mode), but each operation's pipeline is independently readable and modifiable.

**Example:**

```typescript
// src/cli.ts
import { program } from 'commander';

// Shared options inherited by all subcommands
const addSharedOptions = (cmd: Command) =>
  cmd
    .option('-n, --network <network>', 'Network (TESTNET or MAINNET)', 'TESTNET')
    .option('--dry-run', 'Preview without publishing', false)
    .option('-o, --output <dir>', 'Report output directory', './reports')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .option('-y, --yes', 'Skip confirmation prompt', false);

program
  .name('geo-publish')
  .description('Bulk operations for Geo protocol')
  .version('2.0.0');

const upsertCmd = program
  .command('upsert <file>')
  .description('Create or link entities from spreadsheet');
addSharedOptions(upsertCmd);
upsertCmd.action((file, opts) => import('./commands/upsert.js').then(m => m.default(file, opts)));

const deleteCmd = program
  .command('delete <file>')
  .description('Delete entities listed in CSV');
addSharedOptions(deleteCmd);
deleteCmd.action((file, opts) => import('./commands/delete.js').then(m => m.default(file, opts)));

// Backward compatibility: bare command (no subcommand) defaults to upsert
program
  .argument('[file]', 'Path to spreadsheet (legacy mode, defaults to upsert)')
  .action((file, opts) => {
    if (file) {
      import('./commands/upsert.js').then(m => m.default(file, opts));
    } else {
      program.help();
    }
  });

program.parse();
```

### Pattern 2: Operation Context Object

**What:** Each command handler creates an `OperationContext` that carries shared state (network, dryRun, verbose, outputDir) through the pipeline stages. Avoids threading many individual parameters.

**When to use:** In every command handler to reduce parameter count.

**Trade-offs:** One more interface to maintain, but dramatically simplifies function signatures across the pipeline.

**Example:**

```typescript
// src/config/types.ts
export interface OperationContext {
  network: 'TESTNET' | 'MAINNET';
  dryRun: boolean;
  verbose: boolean;
  outputDir: string;
  skipConfirmation: boolean;
  privateKey?: string;
  spaceId?: string;
}

// src/commands/delete.ts
export default async function deleteCommand(file: string, options: CLIOptions) {
  const ctx: OperationContext = {
    network: options.network.toUpperCase() as 'TESTNET' | 'MAINNET',
    dryRun: options.dryRun,
    verbose: options.verbose,
    outputDir: options.output,
    skipConfirmation: options.yes,
  };
  // ... pipeline stages all receive ctx
}
```

### Pattern 3: Batch Builder Strategy

**What:** Each operation has its own batch builder that produces `Op[]`. The publisher is agnostic about what kind of operations it submits. The batch builder is the operation-specific "strategy."

**When to use:** For all four operations.

**Trade-offs:** Some duplication in how batch builders structure their output, but each is independently testable and the publisher never needs to know about operation semantics.

**Example:**

```typescript
// src/processors/batch-builders/delete-batch.ts
import { Graph } from '@geoprotocol/geo-sdk';
import type { Op } from '@geoprotocol/geo-sdk';

export interface DeleteBatchResult {
  ops: Op[];
  summary: {
    relationsDeleted: number;
    entitiesDeleted: number;
  };
}

export function buildDeleteBatch(
  entities: EntityDetails[]
): DeleteBatchResult {
  const ops: Op[] = [];
  let relationsDeleted = 0;
  let entitiesDeleted = 0;

  for (const entity of entities) {
    // 1. Delete all relations (incoming + outgoing) first
    for (const relation of entity.allRelations) {
      const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
      ops.push(...deleteOps);
      relationsDeleted++;
    }

    // 2. Then delete the entity itself
    const { ops: entityOps } = Graph.deleteEntity({ id: entity.id });
    ops.push(...entityOps);
    entitiesDeleted++;
  }

  return { ops, summary: { relationsDeleted, entitiesDeleted } };
}
```

### Pattern 4: Generalized Report Interface

**What:** The report interface uses a discriminated union for operation type so each operation's summary is type-safe but they share report generation/saving infrastructure.

**When to use:** For all reporting across operations.

**Example:**

```typescript
// src/config/types.ts
export type OperationReport = {
  timestamp: string;
  operationType: 'upsert' | 'update' | 'delete' | 'merge';
  success: boolean;
  network: string;
  spaceId: string;
  transactionHash?: string;
  error?: string;
} & (
  | { operationType: 'upsert'; summary: UpsertSummary; details: UpsertDetails }
  | { operationType: 'update'; summary: UpdateSummary; details: UpdateDetails }
  | { operationType: 'delete'; summary: DeleteSummary; details: DeleteDetails }
  | { operationType: 'merge'; summary: MergeSummary; details: MergeDetails }
);
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: God Orchestrator

**What people do:** Keep a single `main()` function with if/else branches for each operation type, passing an `operationType` string through the pipeline.

**Why it is wrong:** Every new operation adds complexity to every function in the pipeline. Conditionals proliferate. Testing requires mocking the entire pipeline to test one operation.

**Do this instead:** Each operation gets its own command handler that composes shared infrastructure. The `cli.ts` file routes to the right handler and never contains pipeline logic.

### Anti-Pattern 2: Premature Shared Abstraction

**What people do:** Create an `AbstractOperation` base class or `OperationPipeline<T>` generic that all operations must extend, forcing a uniform pipeline shape.

**Why it is wrong:** The four operations have fundamentally different pipelines. Upsert has 7 steps. Delete has 4 steps. Merge has 5 steps. Forcing them into a common shape creates leaky abstractions and no-op steps.

**Do this instead:** Share infrastructure (parsing, API client, publishing, logging) through imports, not inheritance. Let each command handler compose the pieces it needs.

### Anti-Pattern 3: Shared Batch Builder With Mode Flags

**What people do:** Add `mode: 'upsert' | 'delete' | 'update' | 'merge'` to the existing `buildOperationsBatch()` function with switch statements inside.

**Why it is wrong:** The batch builders for each operation have fundamentally different inputs and logic. Upsert takes `ParsedSpreadsheet + EntityMap + Relations`. Delete takes `EntityDetails[]`. Merge takes `MergePair[]`. Forcing them into one function makes it unreadable and untestable.

**Do this instead:** Separate batch builder per operation in `processors/batch-builders/`.

### Anti-Pattern 4: Breaking Backward Compatibility

**What people do:** Rename the CLI command from `geo-publish <file>` to `geo-publish upsert <file>` and break all existing scripts.

**Why it is wrong:** Users have existing scripts and muscle memory. Breaking changes without a migration path create friction.

**Do this instead:** Support both forms. If a subcommand is not provided, default to upsert for backward compatibility (with a deprecation warning). The example in Pattern 1 above shows how.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Geo GraphQL API | HTTP POST to graphql endpoint | Need new queries for entity details (triples, relations) for delete/merge |
| Geo Blockchain | Transaction via SDK's personalSpace/daoSpace | Already generic, no changes needed |
| IPFS | Via SDK's publishEdit | Already handled, no changes needed |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| cli.ts -> commands/* | Direct function call with parsed options | CLI layer never contains pipeline logic |
| commands/* -> parsers/* | Direct function call | Commands choose which parser to use (excel vs csv) |
| commands/* -> batch-builders/* | Direct function call | Commands choose which batch builder |
| batch-builders/* -> publisher | Via `Op[]` array | Publisher is operation-agnostic |
| All modules -> logger | Direct import | Logger is universal, no changes needed |
| All modules -> geo-client | Direct import | API client is shared and extended |

### API Extensions Needed

The current `geo-client.ts` supports search-by-name queries. Delete and merge operations need:

1. **Entity detail fetching:** Given an entity ID, retrieve all its triples (property values), all outgoing relations, and all incoming relations. The Hypergraph API supports this via `valuesList` and `relationsList` fields on the entity query.

2. **Incoming relation queries:** The current API client only searches outgoing relations. Delete needs to find relations pointing TO the entity being deleted (incoming), which requires querying `relationsList` with the target entity filter.

Recommended new function signatures:

```typescript
// Fetch full entity state needed for delete/merge
export async function fetchEntityDetails(
  entityId: string,
  spaceId: string,
  network: 'TESTNET' | 'MAINNET'
): Promise<EntityDetails | null>;

// Fetch all relations pointing to an entity (incoming)
export async function fetchIncomingRelations(
  entityId: string,
  spaceId: string,
  network: 'TESTNET' | 'MAINNET'
): Promise<RelationInfo[]>;
```

## Refactoring Build Order

The refactoring has clear dependencies. This ordering ensures each step is independently testable and does not break the existing upsert functionality.

### Step 1: Extract CLI from Pipeline (prerequisite for everything)

- Create `src/cli.ts` with Commander.js subcommand structure
- Move `main()` from `src/index.ts` to `src/commands/upsert.ts`
- Make `src/index.ts` a thin re-export: `import './cli.js'`
- Add backward compatibility for bare `geo-publish <file>` syntax
- Test: Existing upsert still works via `geo-publish upsert <file>` AND `geo-publish <file>`

### Step 2: Split schema.ts types

- Extract shared types to `src/config/types.ts`
- Keep upsert-specific types in `src/config/upsert-types.ts`
- Update all imports
- Test: Everything compiles, upsert still works

### Step 3: Generalize report module

- Replace `PublishReport` interface with discriminated union `OperationReport`
- Keep `saveReport()` and `printReportSummary()` working for upsert
- Test: Upsert reports still generate correctly

### Step 4: Add CSV parser

- Create `src/parsers/csv-parser.ts`
- Parse entity ID lists and merge pair CSVs
- Test: Unit test CSV parsing independently

### Step 5: Extend API client for entity details

- Add `fetchEntityDetails()` and `fetchIncomingRelations()` to `geo-client.ts`
- Use GraphQL queries from the Hypergraph API patterns (valuesList, relationsList)
- Test: Integration test against testnet API

### Step 6: Implement delete command

- Create `src/parsers/validators/delete-validator.ts`
- Create `src/processors/batch-builders/delete-batch.ts`
- Create `src/commands/delete.ts`
- Wire into `cli.ts`
- Test: End-to-end with dry-run on testnet

### Step 7: Implement update command

- Create `src/parsers/validators/update-validator.ts`
- Create `src/processors/batch-builders/update-batch.ts`
- Create `src/commands/update.ts`
- Wire into `cli.ts`
- Test: End-to-end with dry-run on testnet

### Step 8: Implement merge command

- Create `src/parsers/validators/merge-validator.ts`
- Create `src/processors/batch-builders/merge-batch.ts`
- Create `src/commands/merge.ts`
- Wire into `cli.ts`
- Test: End-to-end with dry-run on testnet

### Step Dependency Graph

```
Step 1 (CLI extraction)
  |
  ├── Step 2 (type splitting) ──┐
  |                              |
  ├── Step 3 (report generalize) ──── required by Steps 6, 7, 8
  |
  ├── Step 4 (CSV parser) ──── required by Steps 6, 8
  |
  ├── Step 5 (API extension) ──── required by Steps 6, 8
  |
  ├── Step 6 (delete) ──── independent after 1, 3, 4, 5
  |
  ├── Step 7 (update) ──── independent after 1, 2, 3
  |
  └── Step 8 (merge) ──── depends on 6 (delete logic reuse) + 7 (update logic reuse)
```

Steps 2, 3, 4, 5 can be done in parallel after Step 1.
Steps 6 and 7 can be done in parallel after their prerequisites.
Step 8 should come last as it combines delete and update logic.

## SDK Operation Mapping

Verified from installed `@geoprotocol/geo-sdk@0.9.0` type declarations (HIGH confidence):

| Operation | SDK Function | Input Type | Notes |
|-----------|-------------|------------|-------|
| Create entity | `Graph.createEntity()` | `EntityParams` | Already used in upsert |
| Create relation | `Graph.createRelation()` | `RelationParams` | Already used in upsert |
| Create type | `Graph.createType()` | `CreateTypeParams` | Already used in upsert |
| Create property | `Graph.createProperty()` | `CreatePropertyParams` | Already used in upsert |
| Update entity | `Graph.updateEntity()` | `UpdateEntityParams` | Supports values + unset |
| Delete entity | `Graph.deleteEntity()` | `DeleteEntityParams` | Takes `{ id }` only |
| Delete relation | `Graph.deleteRelation()` | `DeleteRelationParams` | Takes `{ id }` only |
| Update relation | `Graph.updateRelation()` | `UpdateRelationParams` | Position + space/version |

Critical observation: `deleteEntity` and `deleteRelation` take only an `id` parameter. They do NOT handle cascading deletes. The batch builder must explicitly generate `deleteRelation` ops for every relation before `deleteEntity` ops. This ordering within the `Op[]` array is the tool's responsibility.

Critical observation: `updateEntity` supports both setting new values (`values` array) AND unsetting existing values (`unset` array). The update batch builder should use `values` for setting/overwriting property values but does NOT need `unset` for the basic update flow (overwrite means set new value).

## Sources

- Source code analysis: All files in `src/` (read directly, HIGH confidence)
- `@geoprotocol/geo-sdk@0.9.0` type declarations (read from `node_modules`, HIGH confidence)
- Commander.js v12 type declarations (read from `node_modules`, HIGH confidence)
- Hypergraph MCP server GraphQL queries (read from `submodules/hypergraph`, HIGH confidence for API query patterns)
- Existing `.planning/codebase/` documentation (HIGH confidence, created same day)

---
*Architecture research for: Geo Bulk Operations Tool - Multi-operation CLI Refactoring*
*Researched: 2026-02-19*
