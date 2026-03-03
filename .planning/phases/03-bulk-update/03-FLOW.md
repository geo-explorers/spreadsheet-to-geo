# Update Command — End-to-End Flow

**Command:** `geo-publish update <file.xlsx> [options]`

## CLI Entry Point

```
cli.ts → updateCommand(file, options)  →  src/commands/update.ts
```

**Options:**
| Flag | Type | Default | Purpose |
|------|------|---------|---------|
| `--network` | TESTNET/MAINNET | TESTNET (env/default) | Target network |
| `--dry-run` | boolean | false | Stop after diff — no publish |
| `--output` | string | `./reports` | Report output directory |
| `--verbose` | boolean | false | Show unchanged relations in diff |
| `--quiet` | boolean | false | Suppress per-entity diffs, show only summary |
| `--yes` | boolean | false | Skip confirmation prompt |
| `--additive` | boolean | false | Only add relations, never remove |

**Guard:** `--verbose` and `--quiet` are mutually exclusive (hard error).

---

## Phase 1: VALIDATE

**Goal:** Parse spreadsheet, resolve every name (entities + relation targets) to a Geo entity ID, resolve every property to its ID + dataType. Hard-error if anything fails.

### Step 1.1 — Check required tabs
```
excel-parser.checkRequiredTabs(filePath)
  → Must have: Metadata, Types, Properties, ≥1 entity tab
```

### Step 1.2 — Parse spreadsheet
```
excel-parser.parseExcelFile(filePath)
  → Returns: { metadata, types, properties, entities }

  metadata   ← Metadata tab (Field/Value pairs)
  types      ← Types tab (type name, space, description, default properties)
  properties ← Properties tab (property name, data type, renderable type, points to types)
  entities   ← All non-special tabs (tab name = default entity type)
```

Each entity has:
```ts
{
  name: string,              // "Entity name" column
  types: string[],           // "Types" column or tab name
  properties: Record<string, string>,    // All scalar columns → values
  relations: Record<string, string[]>,   // RELATION columns → parsed target lists
  sourceTab: string,         // Which tab it came from
  avatarUrl?: string,        // Optional "Avatar URL" column
  coverUrl?: string,         // Optional "Cover URL" column
}
```

### Step 1.3 — Validate structure
```
validators.validateSpreadsheet(data)
  → Checks: metadata fields, type/property/entity names, data types,
    column→property alignment, reference integrity, duplicate entity names
  → Errors = hard stop, Warnings = proceed with notice
```

### Step 1.4 — Resolve all entity names
```
Collect:
  entityRowNames     ← all entity.name values (Set)
  relationTargetNames ← all entity.relations[*] target values (Set)
  allNames            ← union of both (deduplicated)

geo-client.searchEntitiesByNames(allNames, spaceId, network)
  → Searches Root space + target space per name
  → Returns: Map<normalizedName, { id, name }>

Hard-error if:
  - Any entity row name unresolved   → "Use upsert to create first"
  - Any relation target unresolved   → "All targets must exist in Geo"
```

### Step 1.5 — Resolve property names + IDs
```
geo-client.searchPropertiesByNames(propertyNames, network, targetSpaceId)
  → Searches Root space + target space per property name
  → Returns: Map<normalizedName, { id, dataType }>
```

---

## Phase 2: DIFF

**Goal:** For each entity in the spreadsheet, fetch its current state from Geo, compute per-property and per-relation diffs.

```
update-diff.computeEntityDiffs(entities, resolvedEntities, resolvedProperties, spaceId, network, options)
```

### Step 2.1 — Batch-fetch entity details
```
For each entity (concurrency 10):
  geo-client.fetchEntityDetails(entityId, spaceId, network)
    → GraphQL query returns:
      - valuesList (text, boolean, integer, float, datetime, point, schedule)
      - relations (outgoing) with relation row ID (needed for deleteRelation)
      - backlinks (incoming)
    → Hard-error if any fetch returns null (API failure)
```

### Step 2.2 — Per-entity diff
```
For each entity:
  diffEntity(spreadsheetData, liveDetails, propertyDefs, resolvedEntities, options)

  Scalar properties:
    For each property column with a non-blank value:
      1. Skip blank cells (UPD-04: blank = "no opinion")
      2. Description → special handling via SystemIds.DESCRIPTION_PROPERTY
      3. RELATION dataType → skip (handled in relation diff)
      4. Compare: normalizeValue(spreadsheetValue) vs normalizeValue(currentValue)
         - TEXT: exact match
         - BOOLEAN: canonical true/false
         - INTEGER: parsed int string
         - FLOAT: epsilon comparison (1e-9)
         - DATE: YYYY-MM-DD normalized
         - DATETIME: ISO 8601 normalized
         - TIME: HH:MM:SSZ normalized
         - POINT: lat,lon normalized
      5. If changed → PropertyDiff { type: 'set', oldValue, newValue, typedValue }
      6. If same → unchanged count++

  Relation properties:
    For each relation column with ≥1 target:
      1. Resolve target names → entity IDs
      2. Get current relations for this type from live details
         (filter: relation.typeId === propertyId)
      3. Set diff:
         - toAdd    = desired − current
         - toRemove = current − desired (unless --additive)
         - unchanged = desired ∩ current
      4. If toAdd or toRemove → RelationDiff entry
      5. Otherwise → unchanged count++
```

### Step 2.3 — Aggregate summary
```
DiffSummary {
  totalEntities, entitiesWithChanges, entitiesSkipped,
  totalScalarChanges, totalRelationsAdded, totalRelationsRemoved
}
```

### DRY-RUN GATE
```
If --dry-run:
  printDiffOutput(diffs, summary)
  saveOperationReport(report, outputDir)
  exit(0)
```

---

## Phase 3: CONFIRM

**Goal:** Show the curator what will change, get explicit confirmation.

### Step 3.1 — Print diff output
```
update-report.printDiffOutput(diffs, summary, { verbose, quiet })

Per entity (unless --quiet):
  [UPDATED] Entity Name
    SET PropertyName: "old" -> "new"     (red → green)
    ADD RelationProp -> TargetEntity      (green)
    DEL RelationProp -> TargetEntity      (red)
    ~   RelationProp -> TargetEntity      (gray, verbose only)

  [SKIPPED] Entity Name
    (no changes)

Summary (always shown):
  Entities with changes: N
  Entities skipped: N
  Properties to set: N
  Relations to add: N
  Relations to remove: N
```

### Step 3.2 — Zero-change check
```
If totalScalarChanges == 0 AND totalRelationsAdded == 0 AND totalRelationsRemoved == 0:
  "No changes detected — nothing to publish."
  exit(0)
```

### Step 3.3 — Confirmation prompt
```
Unless --yes:
  confirmAction("Apply these changes to Geo? This action cannot be undone.")
  If declined → exit(0)
```

---

## Phase 4: PUBLISH

**Goal:** Convert diffs to SDK ops, publish atomically.

### Step 4.1 — Validate private key
```
PRIVATE_KEY from env (required)
validatePrivateKey(privateKey) → must be 0x + 64 hex chars
```

### Step 4.2 — Build ops from diffs
```
For each entity with status === 'updated':

  Scalar updates:
    - Separate description changes from regular property values
    - Graph.updateEntity({
        id: entityId,
        values: [{ property, ...typedValue }, ...],  // regular properties
        description: "new desc",                      // if changed
      }).ops → spread into allOps

  Relation additions:
    - Graph.createRelation({
        fromEntity: entityId,
        toEntity: targetEntityId,
        type: propertyId,          // relation type === property ID
      }).ops → spread into allOps

  Relation removals:
    - Graph.deleteRelation({
        id: relationRowId,         // the relation's own ID from fetchEntityDetails
      }).ops → spread into allOps
```

### Step 4.3 — Publish
```
publisher.publishToGeo(batch, metadata, privateKey, options)
  → Personal space: personalSpace.publishEdit({ ops, spaceId, author, network })
  → DAO space: daoSpace.proposeEdit({ ops, ... })
  → Returns: { success, transactionHash, error? }
```

### Step 4.4 — Report
```
generateUpdateReport(diffs, summary, metadata, network, dryRun=false)
saveOperationReport(report, outputDir)
printUpdateSummary(summary, publishResult)
```

---

## File Map

```
src/
├── cli.ts                      CLI wiring (commander)
├── commands/
│   └── update.ts               Main update handler (4-phase orchestrator)
├── parsers/
│   ├── excel-parser.ts         XLSX → ParsedSpreadsheet
│   └── validators.ts           Structure + reference validation
├── processors/
│   └── update-diff.ts          Diff engine (scalar + relation comparison)
├── publishers/
│   ├── publisher.ts            publishToGeo() (personal + DAO)
│   ├── update-report.ts        Report generation + terminal formatting
│   └── report.ts               saveOperationReport() (shared)
├── api/
│   └── geo-client.ts           GraphQL queries (search, fetchEntityDetails)
├── config/
│   ├── types.ts                Shared types (Metadata, UpdateReport, etc.)
│   ├── update-types.ts         Update-specific types (PropertyDiff, EntityDiff, etc.)
│   └── upsert-types.ts         Shared types (SpreadsheetEntity, OperationsBatch, etc.)
└── utils/
    ├── cell-parsers.ts         Value parsing + convertToTypedValue (shared)
    ├── cli-helpers.ts          resolveNetwork(), confirmAction()
    └── logger.ts               Structured logging
```

---

## Key Design Rules

1. **Blank = no opinion** (UPD-04): Empty cells never produce ops — they don't unset values.
2. **Relations are sets**: Order doesn't matter. Filled cell = complete desired final state.
3. **--additive**: Only adds, never removes relations. Safety net for curators.
4. **Upfront resolution**: ALL entity names + relation targets resolved before any diff work begins.
5. **Atomic publish**: All ops go in a single `publishEdit` call — all-or-nothing.
6. **Description is special**: Uses `SystemIds.DESCRIPTION_PROPERTY` for diffing, passes via `Graph.updateEntity({ description })` for publishing.
7. **Property ID = relation type ID**: When diffing relations, filter on `relation.typeId === propertyId`.

---

## Data Flow Diagram

```
┌─────────────┐
│  Excel File  │
└──────┬──────┘
       │  parseExcelFile()
       ▼
┌──────────────────────┐
│  ParsedSpreadsheet   │
│  { metadata, types,  │
│    properties,       │
│    entities }        │
└──────┬───────────────┘
       │  validateSpreadsheet()
       │  searchEntitiesByNames()
       │  searchPropertiesByNames()
       ▼
┌──────────────────────┐     ┌──────────────────┐
│  resolvedEntities    │     │  resolvedProps    │
│  Map<name → {id}>    │     │  Map<name → {id,  │
│                      │     │   dataType}>      │
└──────┬───────────────┘     └────────┬──────────┘
       │                              │
       ▼                              ▼
┌─────────────────────────────────────────┐
│  computeEntityDiffs()                   │
│  For each entity:                       │
│    fetchEntityDetails(id, spaceId)      │
│    diffEntity(spreadsheet vs live)      │
│  Returns: { diffs[], summary }          │
└──────┬──────────────────────────────────┘
       │
       ├──── --dry-run ──→ printDiffOutput() → saveReport() → exit
       │
       ▼
┌──────────────────────┐
│  CONFIRM             │
│  printDiffOutput()   │
│  confirmAction()     │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│  BUILD OPS                                   │
│  For each entity diff:                       │
│    Graph.updateEntity({ id, values, desc })  │
│    Graph.createRelation({ from, to, type })  │
│    Graph.deleteRelation({ id })              │
│  All → allOps: Op[]                          │
└──────┬───────────────────────────────────────┘
       │
       ▼
┌──────────────────────┐
│  publishToGeo()      │
│  → personalSpace     │
│  → daoSpace          │
│  → txHash            │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│  Report + Summary    │
└──────────────────────┘
```
