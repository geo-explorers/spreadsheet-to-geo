# Codebase Structure

**Analysis Date:** 2026-02-19

## Directory Layout

```
spreadsheet-to-geo/
├── src/                           # TypeScript source code
│   ├── index.ts                  # CLI entry point and orchestration
│   ├── api/                      # External API clients
│   │   └── geo-client.ts         # Geo GraphQL API queries
│   ├── config/                   # Type definitions and schema
│   │   └── schema.ts             # Interfaces for all data structures
│   ├── parsers/                  # Spreadsheet parsing and validation
│   │   ├── excel-parser.ts       # XLSX file reading and extraction
│   │   └── validators.ts         # Data validation rules
│   ├── processors/               # Data transformation pipeline
│   │   ├── entity-processor.ts   # Entity/type/property resolution
│   │   ├── relation-builder.ts   # Relation extraction and validation
│   │   └── batch-builder.ts      # SDK operation construction
│   ├── publishers/               # Blockchain publishing
│   │   ├── publisher.ts          # Transaction submission
│   │   └── publish-report.ts     # Report generation and formatting
│   └── utils/                    # Shared utilities
│       ├── logger.ts             # Structured logging
│       └── cell-parsers.ts       # Value parsing and normalization
├── dist/                         # Compiled JavaScript output (after build)
├── node_modules/                 # Dependencies
├── package.json                  # Project metadata and scripts
├── tsconfig.json                 # TypeScript configuration
├── .gitmodules                   # Git submodule references
└── submodules/                   # External repositories
    ├── geo-sdk                   # Geo protocol SDK
    ├── grc-20-ts                 # GRC-20 token standard (TypeScript)
    └── hypergraph                # Hypergraph application framework
```

## Directory Purposes

**src/:**
- Purpose: All TypeScript source code for the CLI application
- Contains: Parsing, validation, processing, publishing, utilities
- Key files: `index.ts` (entry point), subfolders for each architectural layer

**src/api/:**
- Purpose: External service integrations (Geo GraphQL API)
- Contains: API client, query builders, response parsing
- Key files: `geo-client.ts` (search entities/types/properties via GraphQL)

**src/config/:**
- Purpose: Type definitions and constants
- Contains: Interfaces for all data structures, enum values, validation rules
- Key files: `schema.ts` (2 sections: tab models, entity resolution types, operations batch types, publishing types)

**src/parsers/:**
- Purpose: Read and transform raw spreadsheet data
- Contains: XLSX parsing logic, cell value extraction, type coercion
- Key files: `excel-parser.ts` (5 functions: parseExcelFile, getSheetData, parseMetadata, parseTypes, parseProperties, parseEntityTabs), `validators.ts` (validation rules)

**src/processors/:**
- Purpose: Transform parsed data through decision/resolution pipeline
- Contains: Entity resolution with API queries, relation building, SDK operation construction
- Key files: `entity-processor.ts` (buildEntityMap async function), `relation-builder.ts` (buildRelations), `batch-builder.ts` (buildOperationsBatch)

**src/publishers/:**
- Purpose: Execute blockchain transactions and generate reports
- Contains: Wallet client setup, transaction submission, report generation
- Key files: `publisher.ts` (publishToGeo, separate functions for Personal/DAO spaces), `publish-report.ts` (report generation and file I/O)

**src/utils/:**
- Purpose: Shared utility functions used by multiple layers
- Contains: Logging infrastructure, text parsing, value normalization
- Key files: `logger.ts` (structured logging), `cell-parsers.ts` (normalization, date/time parsing, list parsing)

**dist/:**
- Purpose: Compiled JavaScript output from TypeScript
- Contains: All src/* files transpiled to ES2022 modules
- Generated: By `npm run build` (tsc command)
- Entry: `dist/index.js` (executable with shebang)

**node_modules/:**
- Purpose: Installed npm dependencies
- Key packages: @geoprotocol/geo-sdk, viem, xlsx, commander, chalk, dotenv

**submodules/:**
- Purpose: Integrated external repositories
- Contents:
  - `geo-sdk`: Geo protocol TypeScript SDK (entity/type/property operations, signing, publishing)
  - `grc-20-ts`: GRC-20 token standard implementation
  - `hypergraph`: Full-stack application framework (backend server, React apps, examples)

## Key File Locations

**Entry Points:**
- `src/index.ts`: CLI entry point with Commander.js setup and main() orchestrator (lines 1-216)
- `src/parsers/excel-parser.ts`: parseExcelFile(filePath) → ParsedSpreadsheet (lines 30-56)

**Configuration:**
- `src/config/schema.ts`: All TypeScript interfaces (Metadata, TypeDefinition, PropertyDefinition, SpreadsheetEntity, EntityMap, OperationsBatch, etc.)
- `package.json`: Dependencies (geo-sdk, viem, xlsx, commander, chalk, dotenv), scripts (build, start, dev, typecheck)
- `tsconfig.json`: Target ES2022, moduleResolution NodeNext, strict mode enabled

**Core Logic by Phase:**
1. Parsing: `src/parsers/excel-parser.ts` (getSheetData, parseMetadataTab, parseTypesTab, parsePropertiesTab, parseEntityTabs)
2. Validation: `src/parsers/validators.ts` (validateSpreadsheet function)
3. Entity Resolution: `src/processors/entity-processor.ts` (buildEntityMap async, processTypes, processProperties, processEntities)
4. API Queries: `src/api/geo-client.ts` (searchEntitiesByNames, searchTypesByNames, searchPropertiesByNames, executeQuery)
5. Relations: `src/processors/relation-builder.ts` (buildRelations, groupRelationsByProperty)
6. Batch Construction: `src/processors/batch-builder.ts` (buildOperationsBatch, buildPropertyOps, buildTypeOps, buildEntityOps, buildRelationOps, convertToTypedValue)
7. Publishing: `src/publishers/publisher.ts` (publishToGeo, publishToPersonalSpace, publishToDAOSpace)
8. Reporting: `src/publishers/publish-report.ts` (generatePublishReport, saveReport, printReportSummary)

**Testing:**
- No test files present in codebase (not detected)

## Naming Conventions

**Files:**
- Pattern: kebab-case (e.g., excel-parser.ts, entity-processor.ts)
- Organization: By functional domain (parsers/, processors/, publishers/, api/, utils/)

**Directories:**
- Pattern: lowercase plural (src/, parsers/, processors/, publishers/, utils/)
- Functional grouping: Each directory represents a layer or concern

**Functions:**
- Pattern: camelCase, action-noun format (e.g., parseExcelFile, buildEntityMap, resolveEntityId)
- Async marker: Explicit async/await (buildEntityMap is async)
- Helpers: Private functions prefixed with underscore concept (e.g., processTypes, parseMetadataTab)

**Variables:**
- Pattern: camelCase for all variables, constants, and parameters
- Maps: Named with Map suffix (entityMap, typeMap, propertyMap)
- Resolved/Normalized: suffixed with their processed state (normalized, resolved, existing)
- Collections: Plural noun form (entities, types, properties, relations, ops)

**Types/Interfaces:**
- Pattern: PascalCase (Metadata, TypeDefinition, PropertyDefinition, SpreadsheetEntity, EntityMap, ResolvedEntity, OperationsBatch, BatchSummary)
- Action types: ALL_CAPS (CREATE, LINK)
- DataType enum: ALL_CAPS (TEXT, INTEGER, FLOAT, DATE, TIME, DATETIME, BOOLEAN, RELATION, POINT)

## Where to Add New Code

**New Feature:**
- Primary code: `src/processors/` if it's a transformation step (e.g., new processing stage)
- Tests: Not currently used; would go in `tests/` or `src/**/*.test.ts` if added
- Entry: Update main() in `src/index.ts` to call new processor

**New Validator Rule:**
- Implementation: `src/parsers/validators.ts` (add function, export from validateSpreadsheet)
- Types: Update `ValidationResult` interface in `src/config/schema.ts` if needed
- Trigger: Called in main() Step 3 before entity resolution

**New Cell Parser:**
- Implementation: `src/utils/cell-parsers.ts` (add export function)
- Pattern: Take string input, return parsed value or undefined
- Usage: Called from excel-parser.ts (getStringCell, getBooleanCell, etc.) or batch-builder.ts (convertToTypedValue)

**New CLI Option:**
- Implementation:
  - Add `.option()` call in program setup `src/index.ts` (line 41-45)
  - Update main() function signature and implementation
  - Pass to downstream functions if needed

**New TypeScript Interface/Type:**
- Location: `src/config/schema.ts`
- Organization: Group by concern (tab models, entity resolution, operations, publishing)
- Exports: All types exported for use by other modules

**New Logger Output:**
- Implementation: Use existing logger functions in `src/utils/logger.ts`
  - `logger.section(title)` for major flow markers
  - `logger.subsection(title)` for substeps
  - `logger.info(message, details?)` for normal output
  - `logger.debug(message, details?)` for verbose-only output
  - `logger.warn()`, `logger.error()`, `logger.success()` for status
- Pattern: Import logger from utils, call appropriate method with contextual details

## Special Directories

**node_modules/:**
- Purpose: npm dependencies
- Generated: By `npm install`
- Committed: No (excluded via .gitignore)

**dist/:**
- Purpose: Compiled JavaScript output
- Generated: By `npm run build` (tsc command)
- Committed: No (typically excluded)
- Execution: `node dist/index.js` after compilation

**submodules/:**
- Purpose: Integrated external Git repositories
- Committed: Yes (via .gitmodules)
- Setup: `git submodule update --init --recursive`
- Usage: `@geoprotocol/geo-sdk` imported from submodules/geo-sdk

---

*Structure analysis: 2026-02-19*
