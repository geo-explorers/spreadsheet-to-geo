# Phase 3: Bulk Update - Research

**Researched:** 2026-02-24
**Domain:** Entity property update pipeline, state diffing, relation set reconciliation
**Confidence:** HIGH

## Summary

Phase 3 adds a `geo-publish update spreadsheet.xlsx --space <id>` command that bulk-updates existing entities from an Excel spreadsheet. The spreadsheet uses the same template format as upsert (Metadata, Types, Properties tabs + entity tabs), but with `Operation type: UPDATE` in the Metadata tab. The command resolves entities by name, queries their current state from Geo, computes a diff between spreadsheet values and live data, and writes only what has changed. Blank cells are skipped entirely -- there is no unset mechanism in this phase.

The implementation reuses extensive existing infrastructure: the Excel parser (`excel-parser.ts`), cell parsers (`cell-parsers.ts`), validators (`validators.ts`), entity search APIs (`geo-client.ts`), entity detail queries (`fetchEntityDetails`), the publisher (`publisher.ts`), and the report system (`report.ts`). The primary new code is the four-phase update pipeline (validate, diff, confirm, publish), the diff engine (comparing spreadsheet values against live entity state), and the relation set reconciliation logic (computing add/remove ops from desired vs. current state).

The Geo SDK provides `Graph.updateEntity()` for setting scalar property values (with `values` for sets and `unset` for clears), `Graph.createRelation()` for adding new relations, and `Graph.deleteRelation()` for removing relations by their relation row ID. These three SDK operations compose the update op set. The existing `fetchEntityDetails()` already returns the exact data needed: current property values, current outgoing relations (with their relation IDs for deletion), and type assignments.

**Primary recommendation:** Structure the update command as a four-phase pipeline (validate -> diff -> confirm -> publish) mirroring upsert's phased architecture. The diff engine is the core new component -- it must handle scalar property comparison (type-aware equality) and relation set reconciliation (desired final state vs. current state). Reuse existing infrastructure aggressively; the only net-new files should be `src/commands/update.ts` (command handler + pipeline orchestration), an update-specific diff/ops module, and any needed type extensions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Diff format is Claude's discretion -- pick the most readable format based on data shape
- Build on existing `publish-report.ts` infrastructure for report generation
- Report includes both entity-level counts (X updated, Y skipped) AND property-level detail (properties overwritten, relations added/removed)
- Dry-run output behavior (terminal vs file) should match upsert's existing pattern
- Entities with zero changes appear in the report as "skipped" (not omitted silently)
- Relation target format matches upsert's existing spreadsheet format
- Unresolvable relation target names hard-error the entire batch (consistent with entity name resolution)
- Relations treated as sets -- order does not matter, only add/remove
- Default behavior: filled cell = complete desired final state (existing targets not listed get removed)
- `--additive` flag available to switch to additive-only mode (only add new targets, never remove)
- Always prompt for confirmation before applying changes (non-dry-run)
- `--yes` flag skips confirmation for CI/scripting use (`--yes` not `--force`)
- Intended scripting pattern: `--dry-run` to review, then `--yes` to apply
- Mid-batch API failures: retry 2-3 times, then stop. Align retry behavior with upsert pipeline
- All entity names AND relation targets validated upfront before any work begins
- Reuse existing upsert validation infrastructure (`validation.ts`, batch builder, etc.)
- Four-phase pipeline: validate() -> diff() -> confirm() -> publish()
- `--dry-run` stops cleanly after diff() -- validate and diff both ran, full output shown, nothing writes
- `--dry-run` -- run validate + diff, print output, stop before confirm/publish
- `--yes` -- skip confirmation prompt (for CI/scripting)
- `--verbose` -- show unchanged relation targets in diff output (~ lines, hidden by default)
- `--quiet` -- suppress diff and progress, only show errors and final summary
- `--quiet` and `--verbose` are mutually exclusive -- hard error if both passed
- `--additive` -- relation cells only add new targets, never remove existing ones
- Pipeline mirrors upsert's phased architecture: validate -> build_ops -> publish, with diff as an additional phase between validate and publish
- "Whatever upsert does, update should do the same" -- strong preference for consistency across commands
- The diff phase must be separate from validate because it does live API reads (querying Geo for current entity state); all reads complete before showing the curator the full picture
- Reuse existing infrastructure: `publish-report.ts`, `validation.ts`, batch builder, cell parsers

### Claude's Discretion
- Diff output format (table, indented text, etc.) -- pick most readable
- Exact progress output -- match upsert behavior
- Internal batch sizing for API calls
- Retry count and backoff strategy (align with upsert)
- How the confirm step formats the diff for terminal readability

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UPD-01 | User can provide Excel spreadsheet in same format as upsert, plus entity ID column | Existing `parseExcelFile()` handles the template format. **NOTE:** REQUIREMENTS.md says "entity ID column" but the phase description/CONTEXT.md says "resolve by name" -- the roadmap and CONTEXT.md are authoritative: entities are resolved by name (not ID). The `searchEntitiesByNames()` API already handles name-based resolution. No entity ID column is needed. |
| UPD-02 | Tool validates all entity IDs exist before executing updates | Resolved via name-based entity resolution: `searchEntitiesByNames()` returns matched entities; any unresolved name triggers a hard error before any ops execute. `fetchEntityDetails()` confirms entity exists and retrieves current state. |
| UPD-03 | Tool overwrites existing property values using updateEntity set semantics | `Graph.updateEntity({ id, values: [...] })` from the Geo SDK handles this directly. The `values` array in updateEntity sets (overwrites) property values. Same `PropertyValueParam` / `TypedValue` types used by upsert's `buildPropertyValues()` are compatible. |
| UPD-04 | Tool unsets properties for explicitly cleared/empty cells | **SCOPE CONFLICT:** REQUIREMENTS.md says "unset for cleared cells" but the phase description and CONTEXT.md explicitly say "blank cells are always skipped -- there is no mechanism to unset a property via a blank cell; unsetting is out of scope for this phase." The roadmap/CONTEXT.md override: **blank cells are skipped, no unset mechanism in Phase 3.** The SDK does support `unset` via `Graph.updateEntity({ id, unset: [{ property: propId }] })` if this is needed later. |
| UPD-05 | Dry-run mode shows what properties will be changed per entity | The diff engine computes per-entity changes (scalar old->new, relations added/removed). `--dry-run` stops after the diff phase and prints the full diff. Matches upsert's dry-run pattern (validate + preview, no publish). |
| UPD-06 | Summary report shows counts of entities updated, properties set, properties unset | `UpdateReport` type already defined in `types.ts` with `entitiesUpdated`, `propertiesUpdated`, `relationsAdded`, `relationsRemoved` fields. Report saved via `saveOperationReport()`. "Properties unset" will be 0 for Phase 3 (unset is out of scope per CONTEXT.md). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@geoprotocol/geo-sdk` | ^0.10.1 | `Graph.updateEntity()`, `Graph.createRelation()`, `Graph.deleteRelation()` for building update ops | Already used by upsert; SDK provides the exact operations needed |
| `xlsx` | ^0.18.5 | Parse Excel spreadsheet (same template format as upsert) | Already used by `excel-parser.ts` |
| `commander` | ^12.1.0 | CLI subcommand registration and flag parsing | Already used by `cli.ts` |
| `chalk` | ^5.3.0 | Terminal output formatting for diff display and progress | Already used by `logger.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `viem` | ^2.21.0 | Transaction submission and receipt handling | Reused from existing publisher for actual publish step |
| `dotenv` | ^16.4.5 | Environment variable loading | Already loaded in cli.ts |

### Alternatives Considered
None -- the entire stack is already in use. No new dependencies needed.

**Installation:**
```bash
# No new packages required -- all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── commands/
│   ├── upsert.ts            # Existing upsert command
│   └── update.ts            # NEW: Update command handler + pipeline
├── processors/
│   ├── batch-builder.ts     # Existing (reused for value conversion)
│   ├── entity-processor.ts  # Existing (reused for entity resolution)
│   ├── relation-builder.ts  # Existing (reference for relation patterns)
│   └── update-diff.ts       # NEW: Diff engine + update ops builder
├── api/
│   └── geo-client.ts        # Existing (fetchEntityDetails, searchEntitiesByNames)
├── parsers/
│   ├── excel-parser.ts      # Existing (parseExcelFile)
│   └── validators.ts        # Existing (validateSpreadsheet)
├── publishers/
│   ├── publisher.ts         # Existing (publishToGeo)
│   ├── publish-report.ts    # Existing (upsert-specific, reference for update report)
│   ├── update-report.ts     # NEW: Update-specific report generation
│   └── report.ts            # Existing (saveOperationReport)
├── config/
│   ├── types.ts             # Existing (UpdateReport already defined)
│   └── upsert-types.ts      # Existing (ParsedSpreadsheet, EntityMap shared)
└── utils/
    ├── cell-parsers.ts      # Existing (type conversions, normalizeEntityName)
    └── logger.ts            # Existing (structured logging)
```

### Pattern 1: Four-Phase Pipeline (validate -> diff -> confirm -> publish)
**What:** The update command executes four distinct phases, each with clear boundaries and a gate between diff and publish.
**When to use:** Always -- this is the locked architecture decision from CONTEXT.md.
**Example:**
```typescript
// Source: CONTEXT.md pipeline decision
export async function updateCommand(file: string, options: UpdateOptions): Promise<void> {
  // Phase 1: VALIDATE
  // Parse spreadsheet, resolve all entity names + relation targets
  // Hard-error if any entity name or relation target not found
  const parsed = parseExcelFile(filePath);
  const validation = validateSpreadsheet(parsed); // reuse upsert validation
  const entityMap = await buildEntityMap(parsed, network); // reuse entity resolution

  // Phase 2: DIFF
  // Query current state from Geo for all entities, compute changes
  const diffs = await computeDiffs(parsed, entityMap, spaceId, network, options);

  // --dry-run stops here
  if (options.dryRun) {
    printDiffReport(diffs, options);
    saveDryRunReport(diffs, options);
    return;
  }

  // Phase 3: CONFIRM
  // Show full per-entity diff, prompt y/n (or --yes skips)
  printDiffReport(diffs, options);
  if (!options.yes) {
    const confirmed = await confirmAction('Apply these changes?');
    if (!confirmed) return;
  }

  // Phase 4: PUBLISH
  // Build ops from diffs, send to Geo
  const ops = buildUpdateOps(diffs);
  const result = await publishToGeo(batch, metadata, privateKey, publishOptions);
}
```

### Pattern 2: Diff Engine (Scalar Property Comparison)
**What:** Compare spreadsheet values against live entity state, producing a typed diff per property.
**When to use:** For every non-blank scalar cell in the spreadsheet.
**Example:**
```typescript
interface PropertyDiff {
  propertyId: string;
  propertyName: string;
  type: 'set' | 'unchanged';
  oldValue?: string;  // Human-readable representation of current value
  newValue?: string;  // Human-readable representation of new value
}

function diffScalarProperty(
  propertyName: string,
  propertyId: string,
  spreadsheetValue: string,         // Raw cell value from spreadsheet
  currentValues: EntityDetails['values'],  // Live values from Geo
  dataType: string                   // TEXT, DATE, BOOLEAN, etc.
): PropertyDiff {
  // Find current value for this property from entity details
  const current = currentValues.find(v => v.propertyId === propertyId);

  // Convert spreadsheet value to typed format for comparison
  const newTyped = convertToTypedValue(spreadsheetValue, dataType);

  // Compare based on data type
  const isEqual = compareValues(current, newTyped, dataType);

  if (isEqual) {
    return { propertyId, propertyName, type: 'unchanged' };
  }

  return {
    propertyId,
    propertyName,
    type: 'set',
    oldValue: formatValue(current),
    newValue: formatValue(newTyped),
  };
}
```

### Pattern 3: Relation Set Reconciliation
**What:** Compute add/remove ops by diffing desired final state (from spreadsheet) against current relations.
**When to use:** For every non-blank relation cell in the spreadsheet.
**Example:**
```typescript
interface RelationDiff {
  propertyId: string;
  propertyName: string;
  toAdd: Array<{ entityId: string; entityName: string }>;
  toRemove: Array<{ entityId: string; entityName: string; relationId: string }>;
  unchanged: Array<{ entityId: string; entityName: string }>;
}

function diffRelations(
  fromEntityId: string,
  propertyId: string,
  desiredTargetIds: string[],           // From spreadsheet (resolved names -> IDs)
  currentRelations: EntityDetails['relations'],  // Live from Geo
  additive: boolean                     // --additive flag
): RelationDiff {
  // Filter current relations to this property type
  const currentForProp = currentRelations.filter(r => r.typeId === propertyId);
  const currentTargetIds = new Set(currentForProp.map(r => r.toEntity.id));
  const desiredSet = new Set(desiredTargetIds);

  const toAdd = desiredTargetIds.filter(id => !currentTargetIds.has(id));
  const toRemove = additive
    ? []  // --additive: never remove
    : currentForProp.filter(r => !desiredSet.has(r.toEntity.id));
  const unchanged = desiredTargetIds.filter(id => currentTargetIds.has(id));

  return { propertyId, propertyName, toAdd, toRemove, unchanged };
}
```

### Pattern 4: Name-Based Entity Resolution with Mandatory Existence Check
**What:** All entity names in the spreadsheet must resolve to existing entities in the space. Unlike upsert (which creates new entities), update hard-errors on unresolved names.
**When to use:** During the validate phase, before any diff work begins.
**Example:**
```typescript
// Different from upsert: update REQUIRES all entities exist
// Upsert: unresolved name -> CREATE new entity
// Update: unresolved name -> HARD ERROR (cannot update what doesn't exist)
function validateEntityResolution(
  entities: SpreadsheetEntity[],
  entityMap: EntityMap
): string[] {
  const errors: string[] = [];
  for (const entity of entities) {
    const resolved = entityMap.entities.get(normalizeEntityName(entity.name));
    if (!resolved || resolved.action === 'CREATE') {
      errors.push(`Entity "${entity.name}" not found in space -- cannot update`);
    }
  }
  return errors;
}
```

### Anti-Patterns to Avoid
- **Fetching entity details one at a time:** Batch the `fetchEntityDetails()` calls using `Promise.all` with reasonable concurrency (batches of 10-20), matching upsert's batching pattern in `geo-client.ts`.
- **Comparing raw cell strings to API values:** Cell values and API values have different formats (e.g., date strings). Always compare after converting both to the same canonical format.
- **Mutating entityMap for update semantics:** The existing `EntityMap` type is designed for upsert (CREATE/LINK). Do not modify the EntityMap to support update semantics -- build update-specific data structures for the diff.
- **Silently dropping failed API calls during diff:** The diff phase reads current state. If any entity's state cannot be fetched, that is a hard error -- do not proceed with partial data.
- **Mixing read and write in the same phase:** The four-phase pipeline enforces clean separation. All API reads happen in validate + diff. All writes happen in publish. No reads during publish.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Excel parsing | Custom XLSX reader | Existing `parseExcelFile()` from `excel-parser.ts` | Already handles metadata, types, properties, entity tabs |
| Entity name resolution | Custom search logic | Existing `searchEntitiesByNames()` from `geo-client.ts` | Already handles Root space + target space search, batching, normalization |
| Entity detail fetching | Custom GraphQL queries | Existing `fetchEntityDetails()` from `geo-client.ts` | Already returns values, relations (with IDs), backlinks, typeIds |
| Property value conversion | Custom type coercion | Existing `convertToTypedValue()` from `batch-builder.ts` | Already handles all Geo data types (TEXT, DATE, BOOLEAN, etc.) |
| Operation publishing | Custom transaction logic | Existing `publishToGeo()` from `publisher.ts` | Already handles Personal + DAO spaces, retries, confirmation |
| Report saving | Custom file I/O | Existing `saveOperationReport()` from `report.ts` | Already handles naming convention, directory creation |
| Interactive confirmation | Custom readline wrapper | Existing `confirmAction()` from `commands/upsert.ts` | Already handles TTY detection, --yes flag |

**Key insight:** Phase 3 is primarily a *composition* phase -- it composes existing infrastructure into a new pipeline. The only genuinely new logic is the diff engine and the update-specific ops builder. Everything else (parsing, resolution, publishing, reporting) already exists.

## Common Pitfalls

### Pitfall 1: Value Comparison Type Mismatches
**What goes wrong:** Spreadsheet says "2024-01-15" (string), Geo returns `{ datetime: "2024-01-15T00:00:00Z" }`. Naive string comparison says they differ when they semantically equal.
**Why it happens:** The Geo API returns values in canonical formats that differ from spreadsheet input formats. For example: dates may be returned as ISO datetimes, booleans may be `true`/`false` vs. `"Yes"`/`"No"`.
**How to avoid:** Normalize both spreadsheet and API values to a canonical form before comparison. Use the same parsing pipeline (`parseDate`, `parseDatetime`, `parseBoolean`, etc. from `cell-parsers.ts`) on both sides. Compare in the SDK's TypedValue format, not as raw strings.
**Warning signs:** Entities showing "changed" when nothing actually changed; diff reporting updates for every entity even when the spreadsheet matches live data.

### Pitfall 2: Relation Property ID vs. Relation Type ID Confusion
**What goes wrong:** The spreadsheet's Properties tab defines a RELATION property (e.g., "Employer" with dataType RELATION). The `fetchEntityDetails()` returns relations with a `typeId` field. These are the same thing -- the property ID IS the relation type ID. But the code might try to match by wrong field.
**Why it happens:** Relations in Geo use the property ID as the relation type (the `typeId` in the relations array). The field naming (`typeId` in the API, `propertyId` in the spreadsheet) creates confusion.
**How to avoid:** When filtering an entity's current relations to match a specific relation property, filter by `relation.typeId === resolvedProperty.id`. Document this mapping clearly in comments.
**Warning signs:** Empty diff results for relation properties; "no current relations found" when they clearly exist.

### Pitfall 3: Relation Target Resolution Requires Full Name Resolution Pass
**What goes wrong:** A relation cell says "Anthropic, OpenAI" but those entity names need to be resolved to IDs (just like in upsert). If resolution fails for a relation target, the batch must hard-error.
**Why it happens:** Unlike upsert where unresolved relation targets get created, update requires all targets to already exist. The resolution step must cover not just the entities being updated but also every entity name referenced in any relation cell.
**How to avoid:** During validation, collect ALL entity names (row entities + relation target names) and resolve them all upfront. Any unresolved name (entity row OR relation target) triggers a batch-level hard error.
**Warning signs:** Runtime errors during diff phase because relation target IDs are undefined.

### Pitfall 4: Partial Batch Execution on API Failure
**What goes wrong:** The publish phase sends update ops for 100 entities. Entity 50 fails. The first 49 are already committed on-chain.
**Why it happens:** Geo publish is transactional at the edit/proposal level -- all ops in a single `publishEdit()` call are atomic. But if the code splits ops across multiple API calls, partial execution is possible.
**How to avoid:** Collect ALL ops (updateEntity + createRelation + deleteRelation) into a single ops array and pass them to one `publishEdit()` call, exactly as upsert does. This ensures atomicity.
**Warning signs:** Splitting ops into per-entity publish calls instead of batching them together.

### Pitfall 5: --additive Flag Interacting with Empty Relation Cells
**What goes wrong:** With `--additive`, a blank relation cell should be skipped (no change). But a filled cell with a subset of current targets should only add new targets, never remove. The code might confuse "blank cell = skip" with "filled cell with fewer targets = remove some."
**Why it happens:** The `--additive` flag changes the semantics of filled relation cells but not blank cells. Blank cells are always skipped regardless of `--additive`.
**How to avoid:** Check for blank cells FIRST (skip entirely). Only if the cell is non-blank, apply the additive/default logic. In additive mode, compute only additions. In default mode, compute adds and removes.
**Warning signs:** Tests showing unexpected removals in additive mode, or unexpected additions from blank cells.

### Pitfall 6: REQUIREMENTS.md vs. CONTEXT.md Discrepancy
**What goes wrong:** UPD-01 says "entity ID column" and UPD-04 says "unset for cleared cells," but the roadmap and CONTEXT.md say "resolve by name" and "blank cells skipped."
**Why it happens:** REQUIREMENTS.md was written before the discuss-phase refined the design. The CONTEXT.md and roadmap represent the latest user decisions.
**How to avoid:** Follow CONTEXT.md and the roadmap description. Entities are resolved by name (not ID column). Blank cells are skipped (no unset). Document these overrides clearly.
**Warning signs:** Implementing entity ID columns or unset logic that contradicts the approved design.

## Code Examples

Verified patterns from the existing codebase and Geo SDK:

### Using Graph.updateEntity() for Scalar Property Updates
```typescript
// Source: node_modules/@geoprotocol/geo-sdk/dist/src/graph/update-entity.js
import { Graph, type Op, type PropertyValueParam } from '@geoprotocol/geo-sdk';

// updateEntity accepts same PropertyValueParam/TypedValue types as createEntity
const { ops } = Graph.updateEntity({
  id: entityId,           // 32-char hex string
  values: [
    { property: propertyId, type: 'text', value: 'new value' },
    { property: datePropertyId, type: 'date', value: '2024-01-15' },
    { property: boolPropertyId, type: 'boolean', value: true },
    { property: floatPropertyId, type: 'float', value: 42.5 },
  ],
  // unset: [] -- NOT USED in Phase 3 (blank cells are skipped)
});
// Result: single Op with type 'updateEntity'
```

### Using Graph.deleteRelation() to Remove Relations
```typescript
// Source: node_modules/@geoprotocol/geo-sdk/dist/src/graph/delete-relation.js
import { Graph } from '@geoprotocol/geo-sdk';

// deleteRelation takes the relation row's own ID (not the entity ID)
// This ID comes from fetchEntityDetails() -> relations[].id
const { ops } = Graph.deleteRelation({ id: relationRowId });
// Result: single Op with type 'deleteRelation'
```

### Using Graph.createRelation() to Add Relations
```typescript
// Source: node_modules/@geoprotocol/geo-sdk/dist/src/graph/create-relation.js
import { Graph } from '@geoprotocol/geo-sdk';

const { ops } = Graph.createRelation({
  fromEntity: sourceEntityId,
  toEntity: targetEntityId,
  type: relationPropertyId,  // The property ID serves as the relation type
  // position is optional -- update can omit it for simplicity
});
```

### Fetching Current Entity State for Diffing
```typescript
// Source: src/api/geo-client.ts - fetchEntityDetails()
import { fetchEntityDetails, type EntityDetails } from '../api/geo-client.js';

const details: EntityDetails | null = await fetchEntityDetails(entityId, spaceId, network);
// details.values -> current scalar property values
// details.relations -> current outgoing relations (each has .id for deletion)
// details.typeIds -> current type assignments

// Batch fetch for multiple entities:
const entityIds = resolvedEntities.map(e => e.id);
const batchSize = 10;
for (let i = 0; i < entityIds.length; i += batchSize) {
  const batch = entityIds.slice(i, i + batchSize);
  const results = await Promise.all(
    batch.map(id => fetchEntityDetails(id, spaceId, network))
  );
}
```

### Building Combined Update Ops Array
```typescript
// All ops go into a single array for atomic publish
const allOps: Op[] = [];

for (const entityDiff of diffs) {
  if (entityDiff.scalarChanges.length > 0) {
    const { ops } = Graph.updateEntity({
      id: entityDiff.entityId,
      values: entityDiff.scalarChanges.map(c => c.newTypedValue),
    });
    allOps.push(...ops);
  }

  for (const rel of entityDiff.relationsToAdd) {
    const { ops } = Graph.createRelation({
      fromEntity: entityDiff.entityId,
      toEntity: rel.targetEntityId,
      type: rel.propertyId,
    });
    allOps.push(...ops);
  }

  for (const rel of entityDiff.relationsToRemove) {
    const { ops } = Graph.deleteRelation({ id: rel.relationRowId });
    allOps.push(...ops);
  }
}

// Single atomic publish
const batch: OperationsBatch = { ops: allOps, summary };
await publishToGeo(batch, metadata, privateKey, options);
```

### Reusing Confirmation Pattern from Upsert
```typescript
// Source: src/commands/upsert.ts - confirmAction()
// The exact confirmAction function from upsert should be extracted to a shared util
// or imported directly, since update needs the same pattern
async function confirmAction(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive confirmation required. Use --yes to skip.');
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Entity ID column for updates (REQUIREMENTS.md UPD-01) | Name-based resolution (CONTEXT.md / roadmap) | Phase discuss session (2026-02-24) | Entities resolved by name via searchEntitiesByNames(), no ID column needed |
| Unset for empty cells (REQUIREMENTS.md UPD-04) | Blank cells skipped, no unset (CONTEXT.md) | Phase discuss session (2026-02-24) | Simpler implementation; unset deferred |

**Deprecated/outdated:**
- UPD-01's "entity ID column" wording: superseded by name-based resolution per roadmap
- UPD-04's "unset for cleared cells" wording: superseded by "blank cells skipped" per CONTEXT.md

## Open Questions

1. **Operation type field in Metadata tab**
   - What we know: Roadmap says `Operation type: UPDATE` in Metadata tab. Current `parseMetadataTab()` does not parse this field.
   - What's unclear: Should the update command require this field and hard-error if it says UPSERT? Or should the command simply be determined by the CLI subcommand used?
   - Recommendation: The CLI subcommand (`geo-publish update`) is the authoritative operation selector. The Metadata `Operation type` field, if present, should be validated for consistency (warn if mismatched) but the subcommand takes precedence. The parser should be extended to read this field.

2. **Space ID source: Metadata tab vs. --space flag**
   - What we know: CONTEXT.md says `geo-publish update spreadsheet.xlsx --space <id>`. But upsert reads Space ID from the Metadata tab (no --space flag). Phase 1 decision says "Space ID comes from Metadata tab in the Excel file (not a --space flag)."
   - What's unclear: Whether --space is a new flag for update or whether the roadmap description is just illustrative.
   - Recommendation: Follow upsert's pattern -- Space ID from Metadata tab. The `--space` in the roadmap description is illustrative, not a literal new flag. Consistency with upsert is a locked decision.

3. **Metadata tab `Operation type: UPDATE` -- parser extension needed**
   - What we know: The current `parseMetadataTab()` in `excel-parser.ts` does not parse an `Operation type` field. The Metadata interface in `types.ts` does not have this field.
   - What's unclear: Whether this field is required, optional, or purely informational.
   - Recommendation: Add optional `operationType` field to Metadata interface. Parse it from the Metadata tab. The update command warns (not errors) if operationType is present but not "UPDATE". This keeps backward compatibility with existing upsert spreadsheets that don't have this field.

4. **confirmAction() duplication**
   - What we know: `confirmAction()` is defined inline in `src/commands/upsert.ts`. The update command needs the same function.
   - What's unclear: Whether to extract to shared utils or duplicate.
   - Recommendation: Extract `confirmAction()` and `resolveNetwork()` to a shared `src/utils/cli-helpers.ts` module. Both upsert and update import from there. This is a minor refactor that pays off immediately.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None currently installed in project |
| Config file | None |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |
| Estimated runtime | ~5 seconds (unit tests only, no API calls) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UPD-01 | Excel parsing with same template format, name-based resolution | unit | `npx vitest run tests/update-parse.test.ts -x` | No -- Wave 0 gap |
| UPD-02 | All entity names validated before execution | unit | `npx vitest run tests/update-validate.test.ts -x` | No -- Wave 0 gap |
| UPD-03 | Scalar property overwrite via updateEntity | unit | `npx vitest run tests/update-diff.test.ts -x` | No -- Wave 0 gap |
| UPD-04 | Blank cells skipped (no unset) | unit | `npx vitest run tests/update-diff.test.ts -x` | No -- Wave 0 gap |
| UPD-05 | Dry-run shows per-entity diff | unit | `npx vitest run tests/update-diff.test.ts -x` | No -- Wave 0 gap |
| UPD-06 | Summary report with counts | unit | `npx vitest run tests/update-report.test.ts -x` | No -- Wave 0 gap |

### Nyquist Sampling Rate
- **Minimum sample interval:** After every committed task -> run: `npx vitest run --reporter=verbose`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~5 seconds

### Wave 0 Gaps (must be created before implementation)
- [ ] `vitest` dev dependency -- install: `npm install -D vitest`
- [ ] `vitest.config.ts` -- basic config pointing to test files
- [ ] `tests/update-diff.test.ts` -- covers UPD-03, UPD-04, UPD-05 (diff engine unit tests)
- [ ] `tests/update-validate.test.ts` -- covers UPD-02 (entity resolution validation)
- [ ] `tests/update-report.test.ts` -- covers UPD-06 (report generation)
- [ ] `tests/update-parse.test.ts` -- covers UPD-01 (spreadsheet parsing for update)

## Sources

### Primary (HIGH confidence)
- `node_modules/@geoprotocol/geo-sdk/dist/src/graph/update-entity.js` -- verified `updateEntity({ id, values, unset })` API with all data type support
- `node_modules/@geoprotocol/geo-sdk/dist/src/graph/delete-relation.js` -- verified `deleteRelation({ id })` API taking relation row ID
- `node_modules/@geoprotocol/geo-sdk/dist/src/graph/create-relation.js` -- verified `createRelation({ fromEntity, toEntity, type })` API
- `node_modules/@geoprotocol/geo-sdk/dist/src/graph/update-entity.test.js` -- verified all TypedValue types, unset semantics, integer/bigint handling
- `src/api/geo-client.ts` -- verified `fetchEntityDetails()` returns values, relations (with row IDs), backlinks, typeIds
- `src/parsers/excel-parser.ts` -- verified `parseExcelFile()` returns ParsedSpreadsheet with metadata, types, properties, entities
- `src/processors/batch-builder.ts` -- verified `convertToTypedValue()` and `buildPropertyValues()` patterns
- `src/commands/upsert.ts` -- verified pipeline structure, confirmation flow, network resolution, dry-run pattern

### Secondary (MEDIUM confidence)
- `src/config/types.ts` -- `UpdateReport` interface already stubbed with correct fields for Phase 3

### Tertiary (LOW confidence)
- None -- all findings verified against existing codebase and SDK source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- four-phase pipeline is a locked decision, SDK APIs verified against source code, existing infrastructure patterns directly transferable
- Pitfalls: HIGH -- identified from direct codebase analysis (type comparison gotchas, relation ID semantics, requirement discrepancies all verified)

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable domain -- SDK version pinned, codebase under our control)
