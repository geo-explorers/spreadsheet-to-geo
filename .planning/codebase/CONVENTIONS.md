# Coding Conventions

**Analysis Date:** 2026-02-19

## Naming Patterns

**Files:**
- kebab-case for files: `cell-parsers.ts`, `batch-builder.ts`, `entity-processor.ts`
- Directory structure mirrors feature/responsibility: `src/parsers/`, `src/processors/`, `src/publishers/`, `src/api/`, `src/utils/`, `src/config/`

**Functions:**
- camelCase for function names: `buildEntityMap()`, `validateSpreadsheet()`, `normalizeEntityName()`, `parseMultiValueList()`
- Helper functions prefixed by responsibility: `validateMetadata()`, `validateTypes()`, `processEntities()`
- Private helper functions use same camelCase: `collectAllEntityNames()`, `detectMultiTypeEntities()`

**Variables:**
- camelCase for all variables: `entityMap`, `privateKey`, `validationErrors`, `sourceTab`
- Boolean flags use descriptive names: `isValid`, `isVerbose()`, `hasError`, `isRelationProperty()`
- Collections/maps use plural names: `results`, `errors`, `entities`, `properties`, `names`

**Types/Interfaces:**
- PascalCase for interfaces: `ParsedSpreadsheet`, `EntityMap`, `ResolvedEntity`, `ValidationResult`, `BatchSummary`
- Type aliases use PascalCase: `EntityAction`, `LogLevel`, `ValidationSeverity`, `GeoEntity`
- Const objects use UPPER_SNAKE_CASE: `API_ENDPOINTS`, `NETWORKS`, `STANDARD_COLUMNS`, `SPECIAL_TABS`, `REQUIRED_TABS`

## Code Style

**Formatting:**
- No explicit formatter config found (prettier not in dependencies)
- TypeScript strict mode enabled in `tsconfig.json`
- 2-space indentation (observed in source files)
- Single quotes for strings (observed pattern)
- No semicolons explicit config - TypeScript defaults apply

**Linting:**
- No ESLint config in root project
- Submodules have ESLint configs (in `submodules/hypergraph`)

**Type Safety:**
- Strict TypeScript enabled (`"strict": true`)
- Explicit function return types throughout: `async function buildEntityMap(): Promise<EntityMap>`
- Type imports used: `import type { Op } from '@geoprotocol/geo-sdk'`
- Union types for options: `'TESTNET' | 'MAINNET'`, `'CREATE' | 'LINK'`

## Import Organization

**Order:**
1. External/Node.js imports (crypto, path, fs)
2. Third-party framework imports (@geoprotocol/geo-sdk, viem, chalk)
3. Local type imports (`import type { ... }`)
4. Local module imports (`import { ... } from './...'`)

**Examples from codebase:**
```typescript
import { randomUUID } from 'crypto';
import { createPublicClient, http } from 'viem';
import { Graph, type Op } from '@geoprotocol/geo-sdk';
import type { ParsedSpreadsheet, EntityMap } from '../config/schema.js';
import { normalizeEntityName } from '../utils/cell-parsers.js';
import { logger } from '../utils/logger.js';
```

**Path Aliases:**
- ES modules used throughout (`"type": "module"` in package.json)
- Relative paths with `.js` extensions in imports: `from './parsers/excel-parser.js'`
- Barrel file pattern NOT used (no index.ts re-exports observed)

## Error Handling

**Patterns:**
- Try-catch blocks used for async operations
- Error type checking: `error instanceof Error ? error.message : String(error)`
- Explicit error logging with logger.error()
- Process exit on critical errors: `process.exit(1)` for validation failures
- Graceful degradation in API calls: returns null on search failures, logs warning
- Logger used for user-facing error messages, console.error for stderr

**Examples:**
```typescript
// From geo-client.ts - graceful API failure
catch (error) {
  logger.warn(`Failed to search for entity "${name}"`, {
    error: error instanceof Error ? error.message : String(error),
  });
  return null;
}

// From index.ts - validation error handling
if (!validation.isValid) {
  logger.error('Validation failed:');
  console.log(formatValidationErrors(validation.errors));
  process.exit(1);
}
```

## Logging

**Framework:** Structured logging utility in `src/utils/logger.ts` - NOT a third-party logger

**Patterns:**
- Always use `logger` object for logging, never `console.log()` for errors/info
- Log levels: debug (verbose only), info, warn, error, success
- Section headers for major operations: `logger.section('Step 1: Checking Structure')`
- Subsections for phases: `logger.subsection('Processing Types')`
- Key-value pairs for details: `logger.keyValue('Network', options.network)`
- List items for collections: `logger.listItem(tab)`
- Debug logs include metadata: `logger.debug('Entity: ...', { id, types })`
- Progress indication for batch operations: `logger.progress(current, total, label)`

**Usage:**
```typescript
logger.section('Building Entity Map');
logger.info(`Found ${allEntityNames.size} unique entity names`);
logger.subsection('Querying Geo API');
logger.success('Entity map built', { types: entityMap.types.size });
```

## Comments

**When to Comment:**
- Function headers with JSDoc-style format explaining purpose and behavior
- Complex algorithms: multi-step entity resolution, relation building
- Important edge cases: Excel 1900 leap year handling, UUIDs without dashes
- Config-related comments: explaining what spreadsheet tabs mean
- TODO/FIXME comments observed in some files (from recent development)

**JSDoc/TSDoc:**
```typescript
/**
 * Validate parsed spreadsheet data
 */
export function validateSpreadsheet(data: ParsedSpreadsheet): ValidationResult {

/**
 * Parse semicolon-separated values from a cell
 * Handles trimming and empty values
 */
export function parseSemicolonList(value: string | undefined | null): string[] {

/**
 * Entity returned from Geo API search
 */
export interface GeoEntity {
```

## Function Design

**Size:** Functions typically 20-100 lines, split into helpers for complex operations
- Validation functions: ~60-80 lines per validation aspect
- Processing functions: split into phase-specific helpers (processTypes, processProperties, processEntities)
- Builder functions: ~150 lines max before splitting

**Parameters:**
- Functions accept typed objects when multiple related parameters: `EntityMap`, `PublishOptions`
- Callback/helper functions receive minimal focused parameters
- Destructuring used in function signatures where appropriate
- Async functions used for I/O: `async function buildEntityMap()`

**Return Values:**
- Explicit return types always declared
- Union types for multi-return paths: `GeoEntity | null`
- Objects returned for multiple related values: `{ isValid, errors }`
- Maps used for lookup tables: `Map<string, ResolvedEntity>`
- Arrays for ordered collections

## Module Design

**Exports:**
- Mix of named and default exports
- Type exports use `export type` syntax
- Helper functions marked with JSDoc comments but not exported when internal
- Each module has clear responsibility:
  - `cell-parsers.ts`: parsing utilities
  - `validators.ts`: validation logic
  - `entity-processor.ts`: entity resolution
  - `batch-builder.ts`: operation building
  - `publisher.ts`: Geo SDK interaction
  - `logger.ts`: logging interface

**Internal Organization:**
- Types defined at top of file
- Constants/configs in UPPER_SNAKE_CASE below types
- Exported functions in logical order (public APIs first)
- Helper functions after main logic

**Example structure from `geo-client.ts`:**
```typescript
// 1. Interface definitions (GeoEntity, GeoType, GeoProperty)
// 2. Constants (API_ENDPOINTS, ROOT_SPACE_ID, SEARCH_QUERY)
// 3. Internal helpers (executeQuery - not exported)
// 4. Public exported functions
```

## Spreadsheet-Specific Conventions

**Entity/Type/Property References:**
- Names normalized via `normalizeEntityName()` for consistent matching
- Case-insensitive comparison: `"Person" === "person"`
- Whitespace normalized: multiple spaces → single space
- Quote variants normalized: `'"'`, `'"'` → consistent form

**Data Types:**
- Enum-like strings for property data types: `'TEXT'`, `'INTEGER'`, `'RELATION'`, etc.
- Network identifiers: `'TESTNET' | 'MAINNET'` (uppercase, exact match required)
- Action types: `'CREATE' | 'LINK'` for entity resolution

---

*Convention analysis: 2026-02-19*
