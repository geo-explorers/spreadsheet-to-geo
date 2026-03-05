# Phase 4: Delete Relations and Properties - Research

**Researched:** 2026-03-04
**Domain:** Geo protocol bulk operations -- selective deletion of relations and property values
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Excel file (.xlsx) with separate tabs: one for relations, one for properties
- Reuses existing entity-id-parser pattern for reading Excel files via XLSX library
- Relations Tab: Column 'Relation ID' (32-char hex), Column 'Space ID' (32-char hex) -- user provides exact relation row ID
- Properties Tab: Columns 'Entity ID' (32-char hex), 'Property ID' (32-char hex), Column 'Space ID' (32-char hex)
- Each row = one relation to delete (relations tab) or one property to unset (properties tab)
- No name resolution needed -- IDs are provided directly
- Uses Graph.updateEntity({ id, unset: [{ property }] }) for property removal
- Single command handles both relation deletions AND property unsets in one run
- Both tabs read, all ops (deleteRelation + updateEntity unset) published as one atomic transaction
- Empty/missing tabs are allowed -- if user only wants to delete relations, properties tab can be absent
- Validate-everything-first pattern (matches DEL-02): verify all IDs exist, fail-fast with all invalid IDs reported
- New subcommand: separate from existing `delete` command
- Standard flags: --dry-run, --force, --network, --space, --output, --verbose
- Dynamic import for command handler, same flag conventions as existing commands

### Claude's Discretion
- Exact subcommand name (e.g., `delete-triples`, `remove`, `unset`)
- Dry-run preview table layout and detail level
- How to validate relation ID existence via API (may need new GraphQL query)
- Report format and detail level
- Whether to create an Excel template file

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Summary

Phase 4 adds a new CLI subcommand for selectively deleting relations and unsetting properties on entities without deleting the entities themselves. The input is an Excel spreadsheet with two optional tabs: "Relations" (relation IDs to delete) and "Properties" (entity+property ID pairs to unset). This phase builds on well-established patterns from Phase 2 (bulk delete) and Phase 3 (bulk update) -- the same SDK functions (`Graph.deleteRelation`, `Graph.updateEntity` with `unset`), the same publisher infrastructure, and the same validation-first pipeline pattern.

The key technical question is how to validate relation ID existence before building ops. The existing codebase uses two patterns for querying relations from the Geo GraphQL API: (1) entity-scoped `entity.relations(filter: { spaceId })` which returns relation row IDs, and (2) the root `relations(filter: { fromEntityId, spaceId })` query. For relation validation, the most practical approach is to use the root `relations` query filtered by `id`, which should be supported given the API's consistent filtering patterns. Entity validation for the properties tab can reuse the existing `fetchEntityDetails()` function.

**Primary recommendation:** Use the subcommand name `delete-triples` to clearly distinguish from the existing `delete` (which deletes entire entities). Implement a new Excel parser function alongside `parseEntityIds()`, a new ops builder alongside `delete-builder.ts`, and a new command handler following the `delete.ts` pattern. Validate relation IDs via a new `fetchRelationById()` function using the root `relations` query.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @geoprotocol/geo-sdk | ^0.10.1 | Graph.deleteRelation(), Graph.updateEntity({ unset }) | Already used for all delete and update ops in Phases 2-3 |
| xlsx | ^0.18.5 | Read Excel .xlsx files with multi-tab support | Already used by entity-id-parser and excel-parser |
| commander | ^12.1.0 | CLI subcommand routing | Already used for all commands in cli.ts |
| chalk | ^5.3.0 | Terminal output formatting | Already used by logger.ts |
| viem | ^2.21.0 | Blockchain transaction publishing | Already used by publisher.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dotenv | ^16.4.5 | Load .env for PRIVATE_KEY | Already loaded in cli.ts startup |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Excel (.xlsx) input | CSV input | User decision locked to Excel -- two-tab structure requires xlsx format |
| New parser function | Extend parseEntityIds() | Cleaner to create new parser -- column structure is different (Relation ID vs Entity ID) |

**Installation:**
No new packages needed. All dependencies are already in package.json.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── cli.ts                          # Add new 'delete-triples' subcommand registration
├── commands/
│   └── delete-triples.ts           # NEW: command handler (follows delete.ts pattern)
├── config/
│   └── delete-triples-types.ts     # NEW: DeleteTriplesOptions, DeleteTriplesBatch, DeleteTriplesSummary
├── parsers/
│   └── triples-parser.ts           # NEW: parseRelationIds(), parsePropertyUnsets() from Excel tabs
├── processors/
│   └── delete-triples-builder.ts   # NEW: buildDeleteTriplesOps() -- Graph.deleteRelation + updateEntity unset
├── api/
│   └── geo-client.ts               # ADD: fetchRelationById() for relation existence validation
└── publishers/
    └── report.ts                   # EXISTING: saveOperationReport() -- reuse with new report type
```

### Pattern 1: Two-Tab Excel Parser
**What:** Parse an Excel file with optional "Relations" and "Properties" tabs, each with their own column structure.
**When to use:** Reading the input file for this command.
**Example:**
```typescript
// Source: Derived from entity-id-parser.ts pattern
export interface TriplesParseResult {
  relations: Array<{ relationId: string; spaceId: string }>;
  properties: Array<{ entityId: string; propertyId: string; spaceId: string }>;
  errors: string[];
}

export function parseTriplesFile(filePath: string): TriplesParseResult {
  const workbook = XLSX.readFile(filePath);

  // Both tabs are optional, but at least one must have data
  const relationsSheet = workbook.Sheets['Relations'];
  const propertiesSheet = workbook.Sheets['Properties'];

  // Parse each tab independently, accumulating errors
  const relations = relationsSheet ? parseRelationsTab(relationsSheet) : { items: [], errors: [] };
  const properties = propertiesSheet ? parsePropertiesTab(propertiesSheet) : { items: [], errors: [] };

  // Validate single space ID across both tabs
  // ...
}
```

### Pattern 2: Validate-Then-Build Pipeline
**What:** Validate all IDs exist via API before building any operations. Report all invalid IDs at once, then abort.
**When to use:** Core pipeline pattern -- same as delete.ts and update.ts.
**Example:**
```typescript
// Source: Established pattern from delete.ts lines 182-213
// Step 1: Parse all IDs from Excel
// Step 2: Validate ALL relation IDs exist (batch query API)
// Step 3: Validate ALL entity IDs exist (for property unsets)
// Step 4: Build ops only after ALL validation passes
// Step 5: Dry-run OR confirm -> publish -> report
```

### Pattern 3: OperationsBatch Compatibility Shim
**What:** Wrap the flat Op[] array with a zeroed BatchSummary to satisfy publishToGeo's OperationsBatch type.
**When to use:** Before publishing -- same shim pattern used by delete.ts and update.ts.
**Example:**
```typescript
// Source: delete.ts lines 311-326, update.ts lines 327-343
const emptyBatchSummary: BatchSummary = {
  typesCreated: 0, typesLinked: 0, propertiesCreated: 0, propertiesLinked: 0,
  entitiesCreated: 0, entitiesLinked: 0, relationsCreated: 0, imagesUploaded: 0,
  multiTypeEntities: [],
};
const publishBatch: OperationsBatch = { ops: allOps, summary: emptyBatchSummary };
```

### Pattern 4: Relation Validation via GraphQL
**What:** Verify relation IDs exist by querying the Geo GraphQL API's root `relations` query.
**When to use:** During the validation step, before building delete ops.
**Example:**
```typescript
// Source: Inferred from existing relations query pattern in geo-client.ts lines 534-541
// The root `relations` query supports filter params. Use id filter to validate existence.
const RELATION_VALIDATION_QUERY = `
  query ValidateRelation($id: UUID!, $spaceId: UUID!) {
    relations(filter: { id: { is: $id }, spaceId: { is: $spaceId } }) {
      id
      fromEntityId
      toEntityId
      typeId
    }
  }
`;

export async function fetchRelationById(
  relationId: string,
  spaceId: string,
  network: 'TESTNET' | 'MAINNET'
): Promise<{ id: string; fromEntityId: string; toEntityId: string; typeId: string } | null> {
  // Query and return null if empty
}
```

**IMPORTANT:** The `relations` root query filter supporting `id: { is: $id }` is an inference from the API's pattern consistency. The existing code demonstrates `fromEntityId: { is: ... }` and `spaceId: { is: ... }` filters on the same query. If `id` filtering is not supported, the fallback is to query the entity's relations and check if the target relation ID appears in the results. This needs **runtime verification** during implementation.

### Anti-Patterns to Avoid
- **Mixing entity deletion with triple deletion:** This command ONLY deletes relations and unsets properties. It must NOT delete entities themselves. The existing `delete` command handles full entity deletion.
- **Silently skipping invalid IDs:** The fail-fast pattern requires reporting ALL invalid IDs before aborting. Never silently skip.
- **Partial publishing:** All ops (from both tabs) go in a single atomic transaction. Never publish relations and properties separately.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Relation deletion ops | Custom triple construction | `Graph.deleteRelation({ id })` | SDK handles op encoding for the protocol |
| Property unset ops | Manual property removal | `Graph.updateEntity({ id, unset: [{ property }] })` | SDK handles the unset semantics correctly |
| Excel file parsing | Custom file reader | `XLSX.readFile()` + `sheet_to_json()` | Handles all Excel encoding edge cases |
| Geo ID validation | Custom regex | `isValidGeoId()` from cell-parsers.ts | Already validated in production |
| Network resolution | Custom env parsing | `resolveNetwork()` from cli-helpers.ts | Flag > env > default precedence already correct |
| Confirmation prompt | Custom stdin handler | `confirmAction()` from cli-helpers.ts | TTY detection and CI-friendly behavior already handled |
| Report saving | Custom file writer | `saveOperationReport()` from report.ts | Consistent naming convention, directory creation |

**Key insight:** Every infrastructure component this command needs already exists. The only new code is the parser (different column structure), the ops builder (simpler than existing delete-builder), and the command handler (following established patterns).

## Common Pitfalls

### Pitfall 1: Space ID Consistency Across Tabs
**What goes wrong:** Relations and properties tabs could have different Space IDs, leading to cross-space operations.
**Why it happens:** Each tab has its own "Space ID" column. Users might mix IDs from different spaces.
**How to avoid:** Enforce single space ID across both tabs (same constraint as entity-id-parser). Collect all space IDs, error if more than one unique value.
**Warning signs:** Tests should verify space ID mismatch is rejected.

### Pitfall 2: Relation ID vs Entity ID Column Confusion
**What goes wrong:** User puts entity IDs in the Relation ID column, or vice versa.
**Why it happens:** Both are 32-char hex strings -- they look identical.
**How to avoid:** Validation step queries the API with the provided IDs. If a "Relation ID" doesn't match any relation, it's reported as invalid. Clear column headers in the template.
**Warning signs:** All IDs fail validation despite looking well-formed.

### Pitfall 3: Duplicate Relation IDs
**What goes wrong:** Same relation ID appears multiple times in the spreadsheet.
**Why it happens:** User copies rows or has overlapping data.
**How to avoid:** Deduplicate relation IDs the same way entity-id-parser rejects duplicates. Use a Set to track seen IDs, report duplicates as errors.
**Warning signs:** Parse phase reports duplicate IDs.

### Pitfall 4: Missing Both Tabs
**What goes wrong:** User provides an Excel file with neither "Relations" nor "Properties" tab.
**Why it happens:** Wrong file or incorrect tab names.
**How to avoid:** Check that at least one tab exists and has data. Error message should list expected tab names.
**Warning signs:** Empty parse result with zero operations.

### Pitfall 5: Relation ID Validation API Uncertainty
**What goes wrong:** The assumed `relations(filter: { id: { is: $id } })` query syntax may not be supported by the Geo API.
**Why it happens:** The `id` filter on the root `relations` query is inferred, not verified against live API.
**How to avoid:** Test the query against the live API early in implementation. If unsupported, fall back to an alternative approach: query entity details for each entity that owns the relation, then check if the relation ID appears in the entity's relations list. Alternatively, try an introspection query to discover available filter fields.
**Warning signs:** GraphQL errors when running relation validation queries.

### Pitfall 6: Property Unset for Non-Existent Properties
**What goes wrong:** User provides a property ID that doesn't exist on the target entity. Graph.updateEntity({ unset }) may silently succeed or may error.
**Why it happens:** Property was already unset, or wrong property ID.
**How to avoid:** Fetch entity details first, verify the property ID appears in the entity's values. Report properties that aren't set as warnings (not hard errors -- unsetting an already-unset property is idempotent).
**Warning signs:** Unset count doesn't match expected.

## Code Examples

Verified patterns from existing codebase:

### Building Delete Relation Ops
```typescript
// Source: src/processors/delete-builder.ts lines 44-47
import { Graph } from '@geoprotocol/geo-sdk';

const { ops } = Graph.deleteRelation({ id: relationId });
allOps.push(...ops);
```

### Building Property Unset Ops
```typescript
// Source: src/processors/delete-builder.ts lines 62-66
const { ops } = Graph.updateEntity({
  id: entityId,
  unset: [{ property: propertyId }],
});
allOps.push(...ops);
```

### Grouping Property Unsets Per Entity
```typescript
// Source: Derived from delete-builder.ts lines 60-69
// For efficiency, group all property IDs by entity ID and emit one updateEntity per entity
const entityPropertyMap = new Map<string, string[]>();
for (const { entityId, propertyId } of propertyUnsets) {
  if (!entityPropertyMap.has(entityId)) entityPropertyMap.set(entityId, []);
  entityPropertyMap.get(entityId)!.push(propertyId);
}

for (const [entityId, propertyIds] of entityPropertyMap) {
  const { ops } = Graph.updateEntity({
    id: entityId,
    unset: propertyIds.map(property => ({ property })),
  });
  allOps.push(...ops);
}
```

### Parsing an Excel Tab with Custom Columns
```typescript
// Source: src/parsers/entity-id-parser.ts lines 52-131 (adapted for different columns)
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets['Relations'];
if (!sheet) return { items: [], errors: [] };

const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
// Use getColumnValue() pattern for BOM-tolerant header matching
const relationIdRaw = getColumnValue(row, 'Relation ID');
```

### CLI Subcommand Registration (Dynamic Import)
```typescript
// Source: src/cli.ts lines 40-74 (delete command pattern)
const deleteTriplesCmd = program
  .command('delete-triples')
  .argument('[file]', 'Path to Excel (.xlsx) file with relation IDs and property IDs')
  .description('Delete specific relations and unset specific properties')
  .option('-s, --space <id>', 'Override space ID from spreadsheet (32-char hex)')
  .option('-n, --network <network>', 'Network (TESTNET or MAINNET)')
  .option('--dry-run', 'Preview deletions without executing', false)
  .option('-f, --force', 'Skip confirmation prompt', false)
  .option('-o, --output <dir>', 'Output directory for reports', './reports')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action(async (file?: string, opts?: DeleteTriplesOptions) => {
    if (!file) { deleteTriplesCmd.help(); return; }
    const { deleteTriplesCommand } = await import('./commands/delete-triples.js');
    await deleteTriplesCommand(file, opts!);
  });
```

### Confirmation Prompt
```typescript
// Source: src/utils/cli-helpers.ts lines 25-39
import { confirmAction } from '../utils/cli-helpers.js';

if (!options.force) {
  const confirmed = await confirmAction(
    `About to delete ${relationCount} relation(s) and unset ${propertyCount} propert(ies). This cannot be undone.`
  );
  if (!confirmed) {
    logger.info('Operation cancelled by user.');
    process.exit(0);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Graph.deleteEntity() | deleteRelation + updateEntity(unset) | Phase 2 discovery | Indexer ignores deleteEntity -- must blank entities manually |

**Deprecated/outdated:**
- `Graph.deleteEntity()` -- Indexer ignores it. Use `deleteRelation` + `updateEntity({ unset })` instead (decision 02-01 in STATE.md).

## Open Questions

1. **Relation ID validation via GraphQL**
   - What we know: The root `relations` query supports `fromEntityId` and `spaceId` filters. The entity-scoped `relations` connection returns relation row IDs.
   - What's unclear: Whether the root `relations` query supports filtering by `id: { is: $id }`. The API schema has not been introspected.
   - Recommendation: Attempt `relations(filter: { id: { is: $id }, spaceId: { is: $spaceId } })` during implementation. If it fails, fall back to batch-querying entity relations via `fetchEntityDetails()` and checking if the relation ID appears. This fallback is less efficient but guaranteed to work.

2. **Subcommand name**
   - What we know: Must be distinct from `delete` (which deletes entire entities).
   - Options considered: `delete-triples` (explicit -- triples are the fundamental unit in knowledge graphs), `remove` (shorter but ambiguous), `unset` (only describes properties, not relations).
   - Recommendation: Use `delete-triples`. It accurately describes the operation (deleting relation triples and property triples), is distinct from `delete`, and aligns with knowledge graph terminology.

3. **Excel template**
   - What we know: Existing `Geo delete template.xlsx` has a single-tab structure for entity deletion.
   - Recommendation: Create a new template `Geo delete-triples template.xlsx` with two tabs ("Relations" and "Properties") with correct headers and one example row each. This is low effort and high value for users.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected -- no test framework installed |
| Config file | None |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements -> Test Map

Phase 4 has no formal requirement IDs assigned. Based on CONTEXT.md decisions, the implicit requirements are:

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P4-01 | Parse Relations tab with Relation ID and Space ID columns | unit | N/A | No -- Wave 0 |
| P4-02 | Parse Properties tab with Entity ID, Property ID, Space ID columns | unit | N/A | No -- Wave 0 |
| P4-03 | Allow empty/missing tabs (at least one must have data) | unit | N/A | No -- Wave 0 |
| P4-04 | Validate all relation IDs exist via API before building ops | integration | manual-only (requires API) | No |
| P4-05 | Validate all entity IDs exist before building unset ops | integration | manual-only (requires API) | No |
| P4-06 | Fail-fast: report ALL invalid IDs and abort | unit | N/A | No -- Wave 0 |
| P4-07 | Build deleteRelation ops for each relation ID | unit | N/A | No -- Wave 0 |
| P4-08 | Build updateEntity(unset) ops grouped by entity | unit | N/A | No -- Wave 0 |
| P4-09 | Dry-run shows preview without publishing | integration | manual-only (requires API) | No |
| P4-10 | All ops published as single atomic transaction | integration | manual-only (requires blockchain) | No |
| P4-11 | Enforce single space ID across both tabs | unit | N/A | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** No automated tests (no framework)
- **Per wave merge:** Manual verification against testnet
- **Phase gate:** Manual dry-run + live testnet execution

### Wave 0 Gaps
- [ ] Install test framework (vitest recommended -- fast, TypeScript-native, ESM support)
- [ ] `tests/parsers/triples-parser.test.ts` -- covers P4-01, P4-02, P4-03, P4-06, P4-11
- [ ] `tests/processors/delete-triples-builder.test.ts` -- covers P4-07, P4-08
- [ ] Framework config: `vitest.config.ts` with ESM module settings
- [ ] Test fixtures: sample .xlsx files with valid/invalid data

**NOTE:** The project has no test infrastructure. Setting up tests is out of scope for Phase 4 unless explicitly requested. All prior phases shipped without automated tests. The Wave 0 gaps are documented for completeness but should not block implementation unless the user decides to add testing.

## Sources

### Primary (HIGH confidence)
- `src/processors/delete-builder.ts` -- Graph.deleteRelation() and Graph.updateEntity({ unset }) patterns
- `src/parsers/entity-id-parser.ts` -- Excel tab parsing, ID validation, space ID enforcement
- `src/commands/delete.ts` -- Full command handler pipeline pattern
- `src/commands/update.ts` -- Alternative command handler pattern with diff/confirm phases
- `src/api/geo-client.ts` -- GraphQL query patterns for entity and relation validation
- `src/cli.ts` -- Commander.js subcommand registration with dynamic import
- `src/config/delete-types.ts` -- Type definition pattern for command-specific types
- `src/publishers/publisher.ts` -- publishToGeo() and OperationsBatch shim pattern
- `src/publishers/report.ts` -- saveOperationReport() with OperationReport union

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` -- Decision 02-01 on Graph.deleteEntity() being ignored by Indexer
- `.planning/phases/04-delete-relations-and-properties/04-CONTEXT.md` -- User decisions constraining implementation

### Tertiary (LOW confidence)
- Geo GraphQL API `relations` root query `id` filter support -- inferred from API pattern consistency, not verified against live schema. Needs runtime validation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, no new dependencies
- Architecture: HIGH - All patterns copied from existing commands with minor modifications
- Pitfalls: MEDIUM - Relation validation API approach needs runtime verification; everything else is well-understood from prior phases

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- no external API changes expected)
