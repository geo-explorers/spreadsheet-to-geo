# Phase 1: CLI Restructure and Shared Infrastructure - Research

**Researched:** 2026-02-19
**Domain:** CLI architecture refactoring, GraphQL entity detail queries, generalized reporting
**Confidence:** HIGH

## Summary

Phase 1 transforms the monolithic `src/index.ts` (216 lines mixing CLI setup and upsert pipeline) into a subcommand-based CLI (`geo-publish upsert|delete|update`) with shared infrastructure ready for Phases 2 and 3. The existing upsert behavior must work identically through the new architecture.

The core work divides into three tracks: (1) **CLI restructuring** -- extracting Commander.js program setup into a thin router (`src/cli.ts`) and moving the upsert pipeline into `src/commands/upsert.ts`; (2) **shared infrastructure** -- extending `src/api/geo-client.ts` with entity detail queries (properties, relation IDs, type assignments, backlinks) needed by delete and update operations; and (3) **generalized reporting** -- redesigning the report type from upsert-specific to operation-generic with a discriminated union pattern.

A critical context decision changes the original scope: all operations use Excel files (not CSV). Delete takes an Excel file with Metadata tab + entity IDs tab, consistent with the upsert/update pattern. This means CLI-02 (CSV parser) is replaced by Excel-based entity ID parsing. Entity ID validation (INFRA-03) applies to the ID values read from Excel, validating 32-char hex format.

**Primary recommendation:** Extract CLI routing first, move upsert pipeline unchanged, then add entity detail queries and report generalization. The restructuring must not change any upsert behavior -- it is purely organizational.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Unnumbered section headers (not "Step 1:", "Step 2:") -- each operation has different step counts, numbering adds noise
- Inline counter for progress on longer operations ("Processing 12/100 entities..." on a single line)
- Structured summary block on completion -- multi-line with labeled counts, transaction hash, report path
- --verbose flag stays as single toggle (no -v/-vv levels)
- All operations (upsert, delete, update) use Excel files -- no standalone CSV parser needed
- Delete takes an Excel file with Metadata tab + entity IDs tab (consistent with upsert/update pattern)
- Metadata tab provides space configuration for all operations
- Entity IDs are 32-char hex strings (e.g., `b064a55953f843af903e43b6cb75c88e`)
- Header row required in entity ID tab
- Duplicate entity IDs reject the file (validation failure, not silent dedup)
- Whitespace trimmed, blank rows silently skipped
- Flags are selective per subcommand -- each command only gets flags that make sense for it
- Network config: GEO_NETWORK env var for default, --network flag to override
- Confirmation: interactive yes/no prompt replaces the 5-second delay
- --yes / -y flag skips confirmation (current convention kept)
- File input: positional argument (`geo-publish upsert <file>`)
- Space ID comes from Metadata tab in the Excel file (not a --space flag)
- JSON reports saved to disk for all operations (consistent audit trail)
- Common base structure + operation-specific extensions (shared: operation type, timestamp, network, tx hash, space; per-operation: specific counts and details)
- Dry-run reports also saved to disk, clearly marked as dry-run
- Report naming: `{operation}-{timestamp}.json` (e.g., `upsert-2026-02-19T14-30-00.json`)

### Claude's Discretion
- Exact subcommand help text content and formatting
- Internal module boundaries and file organization during restructure
- GraphQL query structure for entity detail fetching
- Error message wording and formatting
- Which flags apply to which subcommands (selective per command)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STRUC-01 | Extract monolithic `src/index.ts` into thin CLI router + per-operation command handlers in `src/commands/` | Commander.js `program.command().action()` pattern; see Architecture Patterns section for exact implementation |
| STRUC-02 | Move existing upsert pipeline into `src/commands/upsert.ts` without changing behavior | Direct extraction of `main()` function body from index.ts lines 48-213; see Code Examples for the upsert handler pattern |
| STRUC-03 | Shared infrastructure (API client, publisher, logger, cell parsers) remains in common modules | No changes needed to `src/utils/`, `src/publishers/publisher.ts`, existing `src/api/geo-client.ts` functions; new functions added alongside existing ones |
| STRUC-04 | Operation-specific logic (validators, batch builders) isolated per operation in dedicated files | Upsert's existing `validators.ts` and `batch-builder.ts` stay where they are for now; future operations get their own files in Phase 2/3 |
| STRUC-05 | Type definitions split into shared types + operation-specific types | Split `src/config/schema.ts` into `src/config/types.ts` (shared) + `src/config/upsert-types.ts` (upsert-specific); see Architecture Patterns for type mapping |
| CLI-01 | CLI uses subcommand structure (`geo-publish upsert\|delete\|update`) | Commander.js `.command('upsert <file>').action()` pattern; all three subcommands registered in `src/cli.ts` |
| CLI-02 | ~~CSV parser handles single-column inputs~~ **SUPERSEDED**: All operations use Excel; entity ID parsing uses existing xlsx library on a dedicated tab | Entity IDs parsed from Excel tab using existing `getSheetData()` + validation via `isValidGeoId()` from cell-parsers.ts |
| CLI-03 | Generalized report type covers all operation types | Discriminated union `OperationReport` with common base + per-operation extensions; see Code Examples |
| INFRA-01 | GraphQL client can fetch entity details by ID (properties, relation IDs, type assignments) | New `fetchEntityDetails()` function using `entity(id:)` query with `valuesList` + `relationsList { nodes { id } }` fields; see Code Examples |
| INFRA-02 | GraphQL client can fetch incoming relations (backlinks) for an entity | New `fetchIncomingRelations()` using `backlinksList` field on entity query (confirmed in Geo GraphQL schema); see Code Examples |
| INFRA-03 | Entity ID validation rejects malformed IDs before API calls | `isValidGeoId()` already exists in `src/utils/cell-parsers.ts` -- validates 32-char hex format; needs new wrapper for Excel-based ID parsing with duplicate detection |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | ^12.1.0 | CLI subcommand routing | Already in use; `.command().action()` pattern supports in-process subcommands |
| @geoprotocol/geo-sdk | 0.9.0 | Entity operations, GraphQL constants | Already in use; exports `SystemIds`, `Graph.*` operations |
| xlsx | ^0.18.5 | Excel file parsing | Already in use; handles Metadata + entity ID tabs for all operations |
| chalk | ^5.3.0 | Terminal output formatting | Already in use; logger depends on it |
| viem | ^2.21.0 | Blockchain transaction client | Already in use; publisher depends on it |
| dotenv | ^16.4.5 | Environment variable loading | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| typescript | ^5.6.0 | Type checking and compilation | Build step |
| tsx | ^4.19.0 | TypeScript execution | Development via `npm run dev` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| N/A | N/A | No new dependencies needed -- all required functionality available in current stack |

**Installation:**
```bash
# No new packages needed. Existing dependencies cover all Phase 1 requirements.
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── cli.ts                        # NEW: CLI entry point with Commander.js subcommand routing
├── commands/                     # NEW: Per-operation command handlers
│   └── upsert.ts                 # Extracted from current index.ts main()
├── api/
│   └── geo-client.ts             # EXTENDED: Add fetchEntityDetails(), fetchIncomingRelations()
├── config/
│   ├── types.ts                  # NEW: Shared types (Metadata, PublishOptions, OperationReport, etc.)
│   └── upsert-types.ts           # RENAMED from schema.ts: Upsert-specific types
├── parsers/
│   ├── excel-parser.ts           # UNCHANGED: Existing Excel parsing
│   ├── entity-id-parser.ts       # NEW: Parse entity IDs from Excel tab (for delete/update)
│   └── validators.ts             # UNCHANGED: Existing upsert validation
├── processors/
│   ├── entity-processor.ts       # UNCHANGED: Existing entity resolution
│   ├── relation-builder.ts       # UNCHANGED: Existing relation building
│   └── batch-builder.ts          # UNCHANGED: Existing upsert batch building
├── publishers/
│   ├── publisher.ts              # UNCHANGED: Already generic (accepts Op[])
│   └── report.ts                 # REPLACED: Generalized from publish-report.ts
└── utils/
    ├── logger.ts                 # EXTENDED: Add inline counter, unnumbered sections
    └── cell-parsers.ts           # UNCHANGED: isValidGeoId() already exists
```

### Pattern 1: Subcommand Handler Pattern

**What:** Each subcommand is a standalone async function that receives parsed CLI options and orchestrates its own pipeline. The CLI layer (`cli.ts`) only handles argument parsing and routing.

**When to use:** Always -- this is the core architectural pattern.

**Key detail from Commander.js docs:** Use `.command('name <arg>').description().action()` for in-process subcommands (not stand-alone executables). The `.addCommand()` pattern is available but `.command().action()` is simpler for in-process handlers.

```typescript
// src/cli.ts
import { program, Command } from 'commander';
import * as dotenv from 'dotenv';

dotenv.config();

program
  .name('geo-publish')
  .description('Bulk operations for Geo protocol')
  .version('1.0.0');

// Upsert subcommand
program
  .command('upsert <file>')
  .description('Create or link entities from an Excel spreadsheet')
  .option('-n, --network <network>', 'Network to publish to (TESTNET or MAINNET)')
  .option('--dry-run', 'Validate and preview without publishing', false)
  .option('-o, --output <dir>', 'Output directory for reports', './reports')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action(async (file, opts) => {
    const { upsertCommand } = await import('./commands/upsert.js');
    await upsertCommand(file, opts);
  });

// Delete subcommand (stub for Phase 2)
program
  .command('delete <file>')
  .description('Delete entities listed in an Excel file')
  .option('-n, --network <network>', 'Network to publish to (TESTNET or MAINNET)')
  .option('--dry-run', 'Validate and preview without deleting', false)
  .option('-o, --output <dir>', 'Output directory for reports', './reports')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action(async (_file, _opts) => {
    console.log('Delete command is not yet implemented. Coming in Phase 2.');
    process.exit(1);
  });

// Update subcommand (stub for Phase 3)
program
  .command('update <file>')
  .description('Update entity properties from an Excel spreadsheet')
  .option('-n, --network <network>', 'Network to publish to (TESTNET or MAINNET)')
  .option('--dry-run', 'Validate and preview without updating', false)
  .option('-o, --output <dir>', 'Output directory for reports', './reports')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action(async (_file, _opts) => {
    console.log('Update command is not yet implemented. Coming in Phase 3.');
    process.exit(1);
  });

program.parse();
```

### Pattern 2: Network Config Resolution

**What:** Network defaults from `GEO_NETWORK` env var, overridden by `--network` flag. Consistent across all subcommands.

**When to use:** In every command handler when resolving network.

```typescript
function resolveNetwork(flagValue?: string): 'TESTNET' | 'MAINNET' {
  const network = (flagValue || process.env.GEO_NETWORK || 'TESTNET').toUpperCase();
  if (network !== 'TESTNET' && network !== 'MAINNET') {
    throw new Error(`Invalid network: "${network}". Must be TESTNET or MAINNET.`);
  }
  return network;
}
```

### Pattern 3: Interactive Confirmation Prompt

**What:** Replace the current 5-second delay with an interactive yes/no prompt. `--yes`/`-y` skips the prompt.

**When to use:** Before any destructive/publishing action.

```typescript
import * as readline from 'readline';

async function confirmAction(message: string): Promise<boolean> {
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

### Pattern 4: Generalized Report with Discriminated Union

**What:** Common base fields for all operations, operation-specific details via discriminated union on `operationType`.

**When to use:** For all report generation and saving.

```typescript
// src/config/types.ts
export interface ReportBase {
  operationType: 'upsert' | 'delete' | 'update';
  timestamp: string;
  success: boolean;
  network: string;
  spaceId: string;
  dryRun: boolean;
  transactionHash?: string;
  error?: string;
}

export interface UpsertReport extends ReportBase {
  operationType: 'upsert';
  summary: {
    typesCreated: number;
    typesLinked: number;
    propertiesCreated: number;
    propertiesLinked: number;
    entitiesCreated: number;
    entitiesLinked: number;
    relationsCreated: number;
  };
  details: { /* existing upsert detail fields */ };
}

export interface DeleteReport extends ReportBase {
  operationType: 'delete';
  summary: {
    entitiesDeleted: number;
    relationsRemoved: number;
    propertiesUnset: number;
  };
  details: { /* delete-specific detail fields */ };
}

export interface UpdateReport extends ReportBase {
  operationType: 'update';
  summary: {
    entitiesUpdated: number;
    propertiesSet: number;
    propertiesUnset: number;
  };
  details: { /* update-specific detail fields */ };
}

export type OperationReport = UpsertReport | DeleteReport | UpdateReport;
```

### Pattern 5: Report File Naming

**What:** Reports named `{operation}-{timestamp}.json` with ISO timestamp formatted for filesystem safety.

```typescript
function getReportFilename(operationType: string, dryRun: boolean): string {
  const timestamp = new Date().toISOString()
    .replace(/:/g, '-')   // colons -> hyphens
    .replace(/\./g, '-'); // dots -> hyphens
  const prefix = dryRun ? `${operationType}-dryrun` : operationType;
  return `${prefix}-${timestamp}.json`;
}
// Example: "upsert-2026-02-19T14-30-00-000Z.json"
// Example: "delete-dryrun-2026-02-19T14-30-00-000Z.json"
```

### Anti-Patterns to Avoid

- **God orchestrator:** Do NOT keep a single `main()` with if/else branches for operation type. Each subcommand gets its own handler file.
- **Premature shared abstraction:** Do NOT create an `AbstractOperation` base class forcing all operations into a uniform pipeline shape. Operations have different step counts and flows.
- **Backward compatibility via default command:** The user decision explicitly requires subcommand syntax (`geo-publish upsert <file>`). Do NOT add a fallback that interprets bare `geo-publish <file>` as upsert. This is listed as Out of Scope in REQUIREMENTS.md.
- **Shared batch builder with mode flags:** Do NOT add `mode: 'upsert' | 'delete'` to `buildOperationsBatch()`. Each operation builds ops differently.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI argument parsing | Custom argv parser | Commander.js `.command().action()` | Already in use, handles help text, validation, subcommands |
| Entity ID validation | Custom regex per call site | `isValidGeoId()` from `cell-parsers.ts` | Already exists, validates 32-char hex, tested pattern |
| Excel parsing | Custom XLSX reader | Existing `excel-parser.ts` functions | Handles tab detection, cell extraction, type coercion |
| GraphQL requests | New HTTP client | Existing `executeQuery()` in `geo-client.ts` | Already handles endpoint selection, error wrapping, JSON parsing |
| Entity name normalization | Per-module normalization | `normalizeEntityName()` from `cell-parsers.ts` | Single source of truth for case-insensitive, whitespace-normalized matching |
| Interactive prompts | npm prompt library | Node.js built-in `readline` | Simple yes/no prompt, no dependency needed |

**Key insight:** Phase 1 requires zero new dependencies. Every capability needed is already in the codebase or available through Node.js built-ins.

## Common Pitfalls

### Pitfall 1: Breaking Upsert During Extraction

**What goes wrong:** Moving `main()` to `src/commands/upsert.ts` introduces subtle import path changes, breaks the `program.parse()` flow, or loses the shebang line needed for CLI execution.

**Why it happens:** The current `index.ts` is both the entry point (with shebang) AND the pipeline handler. Splitting these roles requires careful wiring.

**How to avoid:**
1. Keep `src/index.ts` as the shebang entry point: `#!/usr/bin/env node` + `import './cli.js'`
2. Move all CLI setup to `src/cli.ts`
3. Move upsert pipeline logic to `src/commands/upsert.ts` as a named export
4. Verify `package.json` `bin` field still points to `./dist/index.js`
5. Test that `node dist/index.js upsert <file>` produces identical output to old `node dist/index.js <file>`

**Warning signs:** `help` output missing, commands not recognized, "Cannot find module" errors.

### Pitfall 2: Type Splitting Creates Circular Dependencies

**What goes wrong:** Splitting `schema.ts` into `types.ts` and `upsert-types.ts` creates circular imports when shared types reference operation-specific types or vice versa.

**Why it happens:** The current `schema.ts` has types that cross boundaries -- e.g., `PublishResult` references `BatchSummary` which is upsert-specific.

**How to avoid:**
1. Map every type in `schema.ts` to shared or upsert-specific BEFORE splitting
2. Shared types: `Metadata`, `PublishOptions`, `ValidationError`, `ValidationResult`, `SPECIAL_TABS`, `REQUIRED_TABS`, `STANDARD_COLUMNS`
3. Upsert-specific: `ParsedSpreadsheet`, `TypeDefinition`, `PropertyDefinition`, `SpreadsheetEntity`, `EntityMap`, `ResolvedEntity`, `ResolvedType`, `ResolvedProperty`, `OperationsBatch`, `BatchSummary`
4. Bridge type: `PublishResult` is shared (all operations produce a publish result), but its `summary` field must become generic
5. Use `import type` to avoid runtime circular dependencies

**Warning signs:** TypeScript "circular reference" errors, types suddenly showing as `any`.

### Pitfall 3: GraphQL Entity Query Missing Relation IDs

**What goes wrong:** The entity detail query returns relation data but NOT the relation `id` field needed to call `Graph.deleteRelation({ id })`.

**Why it happens:** The simpler `relationsList` pattern used in the MCP server store returns `typeId` and `toEntity` but NOT the relation row's own `id`. Delete operations need the relation's own ID.

**How to avoid:** Use the `relations` connection pattern (NOT `relationsList`) and request `nodes { id typeId toEntity { id name } }`:

```graphql
query EntityDetails($id: UUID!, $spaceId: UUID!) {
  entity(id: $id) {
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
    relations(filter: { spaceId: { is: $spaceId } }) {
      nodes {
        id
        typeId
        toEntity { id name }
      }
    }
    backlinks(filter: { spaceId: { is: $spaceId } }) {
      nodes {
        id
        typeId
        fromEntity { id name }
      }
    }
  }
}
```

**Warning signs:** Delete operations succeed (no API error) but relations are not actually removed, leaving orphaned triples.

### Pitfall 4: Logger Section Headers Still Numbered

**What goes wrong:** The upsert command still prints "Step 1: Checking Structure", "Step 2: Parsing Spreadsheet", etc. after extraction.

**Why it happens:** The current `main()` in `index.ts` uses numbered section headers like `logger.section('Step 1: Checking Structure')`. The user decision says unnumbered.

**How to avoid:** When extracting to `src/commands/upsert.ts`, change all `logger.section('Step N: ...')` calls to unnumbered: `logger.section('Checking Structure')`, `logger.section('Parsing Spreadsheet')`, etc.

**Warning signs:** Output still shows "Step 1:", "Step 2:" prefixes.

### Pitfall 5: Confirmation Prompt Blocks in Non-TTY Environments

**What goes wrong:** The interactive yes/no prompt hangs or crashes when stdin is not a TTY (e.g., piped input, CI environments).

**Why it happens:** `readline` waits for input that never comes when stdin is not interactive.

**How to avoid:** Check `process.stdin.isTTY` before prompting. If not a TTY and `--yes` is not set, error with a message: "Interactive confirmation required. Use --yes to skip confirmation in non-interactive environments."

**Warning signs:** Script hangs indefinitely in CI or when piped.

## Code Examples

Verified patterns from codebase analysis and official sources:

### Upsert Command Handler (extracted from index.ts)

```typescript
// src/commands/upsert.ts
import * as fs from 'fs';
import * as path from 'path';
import { parseExcelFile, checkRequiredTabs } from '../parsers/excel-parser.js';
import { validateSpreadsheet, formatValidationErrors } from '../parsers/validators.js';
import { buildEntityMap } from '../processors/entity-processor.js';
import { buildRelations } from '../processors/relation-builder.js';
import { buildOperationsBatch, formatBatchSummary } from '../processors/batch-builder.js';
import { publishToGeo, validatePrivateKey } from '../publishers/publisher.js';
import {
  generatePublishReport,
  saveReport,
  printReportSummary,
  printPrePublishSummary,
} from '../publishers/publish-report.js';
import { logger, setVerbose } from '../utils/logger.js';
import type { PublishOptions } from '../config/types.js';

interface UpsertOptions {
  network?: string;
  dryRun: boolean;
  output: string;
  verbose: boolean;
  yes: boolean;
}

export async function upsertCommand(file: string, options: UpsertOptions): Promise<void> {
  setVerbose(options.verbose);

  const network = resolveNetwork(options.network);

  logger.section('Geo Publish - Upsert');
  logger.keyValue('File', file);
  logger.keyValue('Network', network);
  logger.keyValue('Dry Run', options.dryRun.toString());

  // ... rest of pipeline extracted from current main(),
  // with numbered sections replaced by unnumbered:
  // logger.section('Checking Structure') instead of 'Step 1: Checking Structure'
}
```

### Entity Detail Query (new for INFRA-01, INFRA-02)

```typescript
// Addition to src/api/geo-client.ts

/**
 * Full entity details including properties, relations with IDs, and backlinks
 */
export interface EntityDetails {
  id: string;
  name: string | null;
  typeIds: string[];
  values: Array<{
    propertyId: string;
    text: string | null;
    boolean: boolean | null;
    float: number | null;
    datetime: string | null;
    point: string | null;
    schedule: string | null;
  }>;
  relations: Array<{
    id: string;      // Relation's own ID -- needed for deleteRelation()
    typeId: string;
    toEntity: { id: string; name: string | null };
  }>;
  backlinks: Array<{
    id: string;      // Backlink relation's own ID -- needed for deleteRelation()
    typeId: string;
    fromEntity: { id: string; name: string | null };
  }>;
}

const ENTITY_DETAILS_QUERY = `
  query EntityDetails($id: UUID!, $spaceId: UUID!) {
    entity(id: $id) {
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
      relations(filter: { spaceId: { is: $spaceId } }) {
        nodes {
          id
          typeId
          toEntity {
            id
            name
          }
        }
      }
      backlinks(filter: { spaceId: { is: $spaceId } }) {
        nodes {
          id
          typeId
          fromEntity {
            id
            name
          }
        }
      }
    }
  }
`;

/**
 * Fetch full entity details by ID
 * Returns properties, relation IDs (outgoing), backlink IDs (incoming), and type assignments
 */
export async function fetchEntityDetails(
  entityId: string,
  spaceId: string,
  network: 'TESTNET' | 'MAINNET'
): Promise<EntityDetails | null> {
  try {
    const data = await executeQuery<{
      entity: {
        id: string;
        name: string | null;
        typeIds: string[];
        valuesList: EntityDetails['values'];
        relations: { nodes: EntityDetails['relations'] };
        backlinks: { nodes: EntityDetails['backlinks'] };
      } | null;
    }>(ENTITY_DETAILS_QUERY, { id: entityId, spaceId }, network);

    if (!data.entity) return null;

    return {
      id: data.entity.id,
      name: data.entity.name,
      typeIds: data.entity.typeIds,
      values: data.entity.valuesList,
      relations: data.entity.relations.nodes,
      backlinks: data.entity.backlinks.nodes,
    };
  } catch (error) {
    logger.warn(`Failed to fetch entity details for "${entityId}"`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
```

### Entity ID Parsing from Excel (for CLI-02 replacement)

```typescript
// src/parsers/entity-id-parser.ts
import XLSX from 'xlsx';
import { isValidGeoId, cleanString } from '../utils/cell-parsers.js';
import { logger } from '../utils/logger.js';

export interface EntityIdParseResult {
  ids: string[];
  errors: string[];
}

/**
 * Parse entity IDs from an Excel tab
 * Expects a tab with a header row and one column of 32-char hex entity IDs
 * - Trims whitespace
 * - Skips blank rows
 * - Rejects duplicate IDs (validation failure, not silent dedup)
 * - Validates 32-char hex format
 */
export function parseEntityIds(filePath: string, tabName: string): EntityIdParseResult {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[tabName];

  if (!sheet) {
    return { ids: [], errors: [`Tab "${tabName}" not found in workbook`] };
  }

  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const ids: string[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 for 0-index, +1 for header row

    // Get first column value
    const values = Object.values(row);
    const raw = values[0];
    if (raw === undefined || raw === null || raw === '') continue; // blank row

    const value = cleanString(String(raw));
    if (!value) continue; // whitespace-only row

    const id = value.toLowerCase();

    if (!isValidGeoId(id)) {
      errors.push(`Row ${rowNum}: "${value}" is not a valid entity ID (expected 32-char hex)`);
      continue;
    }

    if (seen.has(id)) {
      errors.push(`Row ${rowNum}: Duplicate entity ID "${id}"`);
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return { ids, errors };
}
```

### Generalized Report Save Function

```typescript
// src/publishers/report.ts
import * as fs from 'fs';
import * as path from 'path';
import type { OperationReport } from '../config/types.js';
import { logger } from '../utils/logger.js';

/**
 * Save operation report to disk
 * Naming: {operation}-{timestamp}.json or {operation}-dryrun-{timestamp}.json
 */
export function saveOperationReport(report: OperationReport, outputDir: string): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = report.timestamp
    .replace(/:/g, '-')
    .replace(/\./g, '-');
  const dryRunSuffix = report.dryRun ? '-dryrun' : '';
  const filename = `${report.operationType}${dryRunSuffix}-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  logger.success(`Report saved: ${filepath}`);

  return filepath;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic CLI entry point | Subcommand routing with per-op handlers | This phase | Enables adding delete/update without modifying upsert |
| 5-second timeout for confirmation | Interactive yes/no prompt | This phase (user decision) | Better UX; `--yes` still skips for automation |
| Numbered step headers ("Step 1:", "Step 2:") | Unnumbered section headers | This phase (user decision) | Cleaner output when operations have different step counts |
| Upsert-specific report format | Discriminated union `OperationReport` | This phase | All operations share report save/load infrastructure |
| `--network` flag only | `GEO_NETWORK` env var + `--network` override | This phase (user decision) | Consistent network config without repeating flags |

**Deprecated/outdated:**
- `PublishReport` interface in current `publish-report.ts`: Will be replaced by `OperationReport` discriminated union
- `publishReportSummary()` function: Will be generalized to handle all operation types
- Numbered section headers in CLI output: Replaced by unnumbered per user decision
- 5-second delay confirmation: Replaced by interactive prompt per user decision

## Open Questions

1. **GraphQL `backlinks` connection field availability**
   - What we know: The Geo GraphQL schema defines `backlinksList: Array<Relation>` and `backlinks: RelationsConnection` on the Entity type (confirmed from generated TypeScript types in `submodules/hypergraph/packages/typesync-studio/src/generated/graphql.ts`)
   - What's unclear: Whether the `backlinks` connection (with `nodes { id }`) is available on both TESTNET and MAINNET APIs, and whether it supports the space-scoped filter
   - Recommendation: Implement using the connection pattern (`backlinks(filter: {...}) { nodes { id ... } }`), test against TESTNET API during implementation. If the connection pattern is unavailable, fall back to `backlinksList` and accept that relation IDs may need a separate query

2. **Exact tab name for entity IDs in delete Excel files**
   - What we know: Delete takes an Excel file with Metadata tab + entity IDs tab. The Metadata tab format is well-defined.
   - What's unclear: What should the entity ID tab be named? "Entities"? "Entity IDs"? Should it be configurable?
   - Recommendation: Use "Entities" as the default tab name (consistent with the entity tab convention). The first non-Metadata, non-Properties, non-Types tab containing an ID-like column could also work, but explicit naming is safer.

3. **Report backward compatibility during transition**
   - What we know: Current reports use `publish-report-{timestamp}-{status}.json` naming and the `PublishReport` interface
   - What's unclear: Should existing report consumers (if any) be considered?
   - Recommendation: Since this is an internal engineering tool, make a clean break to the new `{operation}-{timestamp}.json` format. No backward compatibility layer needed.

## Sources

### Primary (HIGH confidence)
- Source code: All files in `src/` read directly -- entry point, parsers, processors, publishers, utilities
- Geo SDK source: `submodules/geo-sdk/src/graph/` -- delete-entity.ts, update-entity.ts, delete-relation.ts, types.ts (confirmed `DeleteEntityParams`, `DeleteRelationParams`, `UpdateEntityParams`)
- Geo GraphQL schema: `submodules/hypergraph/packages/typesync-studio/src/generated/graphql.ts` -- confirmed Entity type has `backlinks`, `backlinksList`, `relations`, `relationsList`, `valuesList`, `typeIds`
- MCP server queries: `submodules/hypergraph/packages/mcp-server/src/graphql-client.ts` -- confirmed `valuesList`, `relationsList` query patterns
- MCP server store: `submodules/hypergraph/packages/mcp-server/src/store.ts` -- confirmed reverse relation (backlink) indexing pattern
- Hypergraph entity queries: `submodules/hypergraph/packages/hypergraph/src/entity/find-one-public.ts` -- confirmed entity query with `valuesList` and relation selection patterns
- Relation query helpers: `submodules/hypergraph/packages/hypergraph/src/utils/relation-query-helpers.ts` -- confirmed `backlinks` field name and `fromEntity` traversal direction for backlinks
- Context7 Commander.js docs: `/tj/commander.js` -- confirmed `.command().action()` in-process subcommand pattern, `.addCommand()` for prepared commands

### Secondary (MEDIUM confidence)
- Existing planning documents: `.planning/research/ARCHITECTURE.md`, `.planning/codebase/ARCHITECTURE.md` -- confirmed architectural analysis and recommended structure

### Tertiary (LOW confidence)
- None -- all findings verified against source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all verified from existing package.json and source
- Architecture: HIGH -- Commander.js subcommand pattern verified via Context7; all existing code read directly
- GraphQL entity details: HIGH -- query patterns confirmed from 3 independent sources in hypergraph submodule (MCP server, typesync-studio generated types, relation-query-helpers)
- Pitfalls: HIGH -- derived from direct code analysis of current index.ts, schema.ts, and publish-report.ts

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable -- no fast-moving dependencies)
