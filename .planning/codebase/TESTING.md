# Testing Patterns

**Analysis Date:** 2026-02-19

## Test Framework

**Status:** No test framework configured for main project

- No testing dependencies in `package.json` (no jest, vitest, mocha)
- No test configuration files in project root
- No test files found in `src/` directory
- Production code only (no test suite)

**Note:** Submodules (`geo-sdk`, `hypergraph`, `grc-20-ts`) have extensive vitest configs, but these are external dependencies, not part of the main codebase.

## Code Structure for Testability

While no tests exist, the code is structured with testability in mind:

**Separation of Concerns:**
- `src/parsers/` - data parsing logic isolated in `excel-parser.ts`
- `src/processors/` - business logic isolated (entity resolution, relation building, batch building)
- `src/api/` - API communication isolated in `geo-client.ts`
- `src/utils/` - pure utility functions in `cell-parsers.ts` and `logger.ts`
- `src/publishers/` - publishing logic isolated

**Dependency Injection Pattern:**
- Functions accept all dependencies as parameters
- Example: `buildOperationsBatch(data, entityMap, relations)` - all inputs passed explicitly
- Example: `buildEntityMap(data, network)` - network passed as parameter

**Pure Functions:**
- Validation functions are pure: `validateSpreadsheet()`, `validateMetadata()`, etc.
- Parsing functions are pure: `parseMultiValueList()`, `normalizeEntityName()`, `parseDate()`, etc.
- No global state except logger verbosity

## Key Areas for Testing

**Critical Logic (if tests were added):**

1. **Validation** (`src/parsers/validators.ts`):
   - Input: ParsedSpreadsheet
   - Output: ValidationResult with categorized errors
   - Test coverage needed: metadata validation, type validation, entity deduplication, reference integrity

2. **Entity Resolution** (`src/processors/entity-processor.ts`):
   - Input: ParsedSpreadsheet, API results
   - Output: EntityMap with resolved IDs and actions
   - Test coverage needed: CREATE vs LINK decisions, multi-type entity handling, relation target collection

3. **Batch Building** (`src/processors/batch-builder.ts`):
   - Input: ParsedSpreadsheet, EntityMap, relations
   - Output: Op[] (Geo SDK operations)
   - Test coverage needed: property/type/entity operation generation, operation ordering, relation operations

4. **Cell Parsing Utilities** (`src/utils/cell-parsers.ts`):
   - Pure functions with wide variety of inputs
   - Test coverage needed: date parsing (Excel serials), time parsing (12-hour), normalization (whitespace/quotes), ID validation

5. **API Client** (`src/api/geo-client.ts`):
   - Network calls to GraphQL endpoint
   - Test coverage needed: batch searching, result deduplication, error handling (network failures)

6. **Relations** (`src/processors/relation-builder.ts`):
   - Input: ParsedSpreadsheet, EntityMap
   - Output: RelationToCreate[]
   - Test coverage needed: relation identification, multi-value splitting, target resolution

## Current Testing Approach

**Manual Testing:**
- CLI invoked directly with `node dist/index.js` or `tsx src/index.ts`
- Dry-run flag available: `--dry-run` validates without publishing
- Report generation for post-execution review

**Validation During Execution:**
```bash
npm run dev -- data.xlsx --dry-run  # Validate and preview
npm run build                        # Type check via tsc
npm run typecheck                    # Explicit type check
```

## Suggested Testing Structure (if tests were added)

**Layout:** Co-located pattern would be natural:
```
src/
├── parsers/
│   ├── validators.ts
│   ├── validators.test.ts     # Test validation logic
│   └── excel-parser.ts
├── processors/
│   ├── entity-processor.ts
│   ├── entity-processor.test.ts
│   ├── batch-builder.ts
│   └── batch-builder.test.ts
├── utils/
│   ├── cell-parsers.ts
│   └── cell-parsers.test.ts   # Wide variety of parser tests
└── api/
    ├── geo-client.ts
    └── geo-client.test.ts      # Mocked API tests
```

## Test Fixtures (if needed)

**Spreadsheet Data:**
Would use `ParsedSpreadsheet` objects created programmatically:

```typescript
const mockData: ParsedSpreadsheet = {
  metadata: {
    spaceId: 'test-space-id',
    spaceType: 'Personal',
  },
  types: [
    { name: 'Person', description: 'A person' },
  ],
  properties: [
    { name: 'Name', dataType: 'TEXT' },
    { name: 'Age', dataType: 'INTEGER' },
  ],
  entities: [
    {
      name: 'Alice',
      types: ['Person'],
      properties: { Name: 'Alice', Age: '30' },
      relations: {},
      sourceTab: 'Person',
    },
  ],
};
```

**API Responses:**
Would mock GraphQL responses:

```typescript
const mockGeoEntity: GeoEntity = {
  id: 'abc123def456',
  name: 'Person',
  types: [],
  spaceIds: ['root-space-id'],
};
```

**Entity Maps:**
Would build from fixtures:

```typescript
const mockEntityMap: EntityMap = {
  entities: new Map([
    ['alice', {
      name: 'Alice',
      id: 'gen-id-1',
      types: ['Person'],
      typeIds: ['existing-type-id'],
      action: 'CREATE'
    }],
  ]),
  types: new Map([...]),
  properties: new Map([...]),
  propertyDefinitions: new Map([...]),
};
```

## Integration Points (if testing)

**External Dependencies:**
- Geo GraphQL API (`geo-client.ts`) - would need mocking via vitest
- Viem client for wallet operations (`publisher.ts`) - would need mocking
- File system for Excel parsing - could test with fixture files or mocked fs

**Example Mock Pattern (vitest style):**
```typescript
import { vi } from 'vitest';

vi.mock('../api/geo-client.ts', () => ({
  searchEntitiesByNames: vi.fn().mockResolvedValue(new Map()),
  searchTypesByNames: vi.fn().mockResolvedValue(new Map()),
}));
```

## Error Scenarios (if testing)

**Validation Errors:**
- Duplicate entity names within same tab
- Entity references unknown type
- Entity uses unknown property
- Invalid data type in properties tab
- Malformed Geo IDs (if used)

**Processing Errors:**
- Entity without types
- Circular relations (unlikely but possible)
- Type resolution failure
- Property data type mismatch

**API Errors:**
- Network timeout during search
- GraphQL errors in response
- Invalid response format
- Rate limiting

**File Errors:**
- Missing required sheet tabs
- Invalid Excel format
- CSV parsing failures
- File not found

## Coverage Targets (if tests were added)

**High Priority (should have tests):**
- Validation logic: ~80% coverage minimum
- Cell parsers: ~95% coverage (many edge cases)
- Entity resolution: ~85% coverage
- Batch building: ~80% coverage

**Medium Priority:**
- Excel parsing: ~60% coverage (depends on xlsx library)
- API client: ~70% coverage (mocked, happy path + failures)

**Lower Priority:**
- Logger: ~40% coverage (mostly formatting)
- Publisher: ~50% coverage (depends on Geo SDK)

---

*Testing analysis: 2026-02-19*

## Note on Current State

This project is in active development with recent commits ("Fixing Bugs and Preparing for testing"). While testing infrastructure is not yet implemented, the architectural separation of concerns makes it well-suited for adding tests. The recommended approach would be to:

1. Add vitest as dev dependency
2. Create test files co-located with source
3. Start with highest-impact areas: validators, cell-parsers, entity-processor
4. Mock external dependencies (Geo API, file system)
