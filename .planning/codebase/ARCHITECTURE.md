# Architecture

**Analysis Date:** 2026-02-19

## Pattern Overview

**Overall:** Sequential CLI pipeline with staged processing

**Key Characteristics:**
- Linear 7-step transformation from Excel spreadsheet to blockchain operations
- External API queries to deduplicate against existing Geo entities
- Separation of concerns: parsing → validation → entity resolution → relation building → batch construction → publishing
- SDK-first design using Geo SDK for operation formatting and blockchain publication
- Dual-space support (Personal and DAO spaces)

## Layers

**CLI Entry Point:**
- Purpose: Command-line interface and orchestration
- Location: `src/index.ts`
- Contains: Main CLI setup using Commander.js, main() async flow orchestrator
- Depends on: All other layers (parsers, processors, publishers, utilities)
- Used by: Node.js CLI execution

**Parsing Layer:**
- Purpose: Read and extract structured data from Excel/CSV files
- Location: `src/parsers/excel-parser.ts`
- Contains: XLSX file reading, tab parsing, cell value extraction with type coercion
- Depends on: XLSX library, cell-parsers utilities
- Used by: Main orchestrator in Step 2

**Validation Layer:**
- Purpose: Verify spreadsheet data integrity and enforce constraints
- Location: `src/parsers/validators.ts`
- Contains: Data validation rules, error collection, warning detection
- Depends on: Schema types, cell-parsers for normalization
- Used by: Main orchestrator in Step 3

**API Client Layer:**
- Purpose: Query Geo protocol network for existing entities, types, properties
- Location: `src/api/geo-client.ts`
- Contains: GraphQL client, search functions for entities/types/properties
- Depends on: Geo SDK for SystemIds.ROOT_SPACE_ID
- Used by: Entity processor for deduplication

**Entity Resolution Layer:**
- Purpose: Map spreadsheet entities/types/properties to Geo IDs with CREATE/LINK decision
- Location: `src/processors/entity-processor.ts`
- Contains: Async API queries, ID generation, entity map construction
- Depends on: API client, schema types, normalization utilities
- Used by: Main orchestrator in Step 4

**Relation Building Layer:**
- Purpose: Create relation definitions between entities
- Location: `src/processors/relation-builder.ts`
- Contains: Relation extraction from entity properties, validation
- Depends on: Entity processor helpers, schema types
- Used by: Main orchestrator in Step 5

**Batch Building Layer:**
- Purpose: Convert resolved entities/relations to Geo SDK operations
- Location: `src/processors/batch-builder.ts`
- Contains: SDK operation builders (createProperty, createType, createEntity, createRelation), type conversion
- Depends on: Geo SDK, entity map, relation definitions
- Used by: Main orchestrator in Step 6

**Publishing Layer:**
- Purpose: Execute blockchain transactions to publish operations
- Location: `src/publishers/publisher.ts`
- Contains: Wallet client setup, personal/DAO space publishing, transaction submission
- Depends on: Viem for blockchain interaction, Geo SDK for transaction building
- Used by: Main orchestrator in Step 7

**Reporting Layer:**
- Purpose: Generate and save publication reports
- Location: `src/publishers/publish-report.ts`
- Contains: Report generation, file I/O, summary formatting
- Depends on: Schema types, file system
- Used by: Main orchestrator after steps 6-7

**Utility Layer:**
- Purpose: Shared helpers and formatting
- Location: `src/utils/` directory
  - `logger.ts`: Structured logging with color output, verbose mode support
  - `cell-parsers.ts`: Cell value parsing (dates, times, semicolon lists), normalization
- Used by: All layers for logging and data transformation

## Data Flow

**Main CLI Flow:**

1. **File Validation** → Check file exists, get absolute path
2. **Structure Check** → Verify required tabs present (Metadata, Types, Properties, ≥1 entity tab)
3. **Spreadsheet Parsing** → Read Excel, extract typed data structures
4. **Data Validation** → Check constraints, collect warnings/errors
5. **Entity Resolution** → Query Geo API for existing entities, assign IDs with CREATE/LINK actions
6. **Relation Building** → Extract relation columns, map to entity pairs
7. **Batch Construction** → Convert to SDK operations in correct order (properties → types → entities → relations)
8. **Publishing** → Initialize wallet, submit transaction based on space type
9. **Reporting** → Generate summary report and save to disk

**State Management:**
- Immutable pipeline: no state mutations between steps
- `ParsedSpreadsheet` carries raw data through parsing and validation
- `EntityMap` carries resolution results (maps entity names to IDs and actions)
- `RelationToCreate[]` carries relation definitions
- `OperationsBatch` carries SDK operations and summary statistics
- `PublishResult` carries final transaction outcome

## Key Abstractions

**EntityMap:**
- Purpose: Central registry mapping all spreadsheet names to resolved Geo IDs and actions
- Examples: `src/processors/entity-processor.ts` (buildEntityMap function, entityMap parameter)
- Pattern: 4 Maps keyed by normalized entity names (entities, types, properties, propertyDefinitions)
- Lookups: Helper functions like `resolveEntityId()`, `getResolvedEntity()`, `isRelationProperty()`

**Normalized Entity Names:**
- Purpose: Case-insensitive, whitespace-agnostic entity lookups
- Examples: `src/utils/cell-parsers.ts` (normalizeEntityName function)
- Pattern: Lowercase, trim, collapse whitespace to single spaces
- Usage: All map keys throughout the system

**Action Types (CREATE/LINK):**
- Purpose: Flag whether each entity/type/property should be created or linked
- Examples: `ResolvedEntity.action`, `ResolvedType.action`, `ResolvedProperty.action`
- Pattern: Set during entity resolution based on API search results
- Determines: Which SDK operations to generate (skip LINK items)

**Property Value Conversion:**
- Purpose: Transform spreadsheet text values to SDK TypedValue format
- Examples: `src/processors/batch-builder.ts` (convertToTypedValue function)
- Pattern: Switch on PropertyDefinition.dataType, parse text to appropriate SDK type
- Supports: TEXT, INTEGER, FLOAT, DATE, TIME, DATETIME, BOOLEAN, POINT

**Relation Definition:**
- Purpose: Intermediate representation of entity relationships
- Examples: `src/processors/relation-builder.ts` (RelationToCreate interface)
- Pattern: from/to entity IDs, property ID, names for logging
- Validation: Only created for entities with action='CREATE'

## Entry Points

**CLI Command:**
- Location: `src/index.ts` (lines 36-46)
- Triggers: `npm run dev` or `node dist/index.js` (after build)
- Arguments: `<file>` (Excel path), options (--network, --dry-run, --output, --verbose, --yes)
- Responsibilities: Parse CLI arguments, orchestrate 7-step pipeline, handle errors, exit codes

**Main Function:**
- Location: `src/index.ts` (lines 48-213)
- Triggers: Commander.js action callback
- Responsibilities:
  - Load .env configuration
  - Execute validation and parsing steps 1-6
  - Branch on dry-run flag (exit early) or proceed to publishing
  - Handle 5-second confirmation delay
  - Execute publishing step 7
  - Generate and save report
  - Print summary and exit

## Error Handling

**Strategy:** Fail-fast with detailed logging

**Patterns:**
- File system: Check existence before processing, throw if missing
- Validation: Collect all errors, display and exit if critical (isValid=false), warn if non-critical
- API queries: Catch network errors, log warnings, continue with empty results
- Entity resolution: Throw if entity reference unresolvable after all stages
- Relations: Collect errors during building, throw if any unresolved references
- Publishing: Catch transaction failures, return error result with details
- JSON parsing: Assume fetch responses are valid JSON, handle GraphQL errors separately

## Cross-Cutting Concerns

**Logging:**
- Implementation: `src/utils/logger.ts` (structured logging with levels: debug, info, warn, error, success)
- Pattern: Each layer calls logger.info(), logger.debug(), logger.warn(), or logger.error()
- Verbose mode: Debug messages hidden by default, enabled via -v flag
- Sections: Printed with `logger.section()` for visual flow in CLI output

**Validation:**
- Implementation: `src/parsers/validators.ts` (comprehensive validation rules)
- Pattern: Each data class has property constraints (required vs optional, format rules)
- Error collection: Returns `{isValid: boolean, errors: ValidationError[]}` object
- Recovery: Warnings don't block publishing; critical errors do

**Authentication:**
- Implementation: Private key from `PRIVATE_KEY` environment variable
- Pattern: Validated as 66-character string starting with `0x` (32-byte hex)
- Usage: Passed to wallet client initialization for transaction signing
- DAO mode: Additional `DAO_SPACE_ADDRESS` and `CALLER_SPACE_ID` env vars required

**Deduplication:**
- Implementation: Query Geo API for existing entities/types/properties before publishing
- Pattern: Exact name matching (case-insensitive) via `normalizeEntityName()`
- Result: Existing items marked as LINK, new items marked as CREATE
- Scope: Searches Root space for types/properties; target space + Root for entities

---

*Architecture analysis: 2026-02-19*
