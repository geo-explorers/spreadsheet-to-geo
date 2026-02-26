---
status: resolved
trigger: "Investigate the root cause of the CSV parser issue in the spreadsheet-to-geo project."
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T14:45:00Z
---

## Current Focus

hypothesis: Need to modify parser to read both Space ID (column 0) and Entity ID (column 1), validate single space ID per CSV, make --space optional with CSV as primary source
test: Design implementation approach and identify all code locations requiring changes
expecting: Complete implementation plan addressing all 4 user questions
next_action: Form hypotheses for implementation approach and answer user questions

## Symptoms

expected: Parser should read entity IDs from the "Entity ID" column in CSV
actual: Parser reads column 0 (Space ID) as entity IDs
errors: N/A
reproduction: Run delete command with user's CSV template
started: User decision to change from --space flag to CSV-based space ID reading

## Eliminated

## Evidence

- timestamp: 2026-02-25T00:05:00Z
  checked: CSV template structure
  found: CSV has "Space ID,Entity ID" as headers (column 0 = Space ID, column 1 = Entity ID)
  implication: Current parser reads column 0, which would read Space IDs instead of Entity IDs

- timestamp: 2026-02-25T00:06:00Z
  checked: entity-id-parser.ts line 54-55
  found: Parser uses `Object.values(row)[0]` to read entity IDs (column index 0)
  implication: This reads Space ID column instead of Entity ID column from user's CSV

- timestamp: 2026-02-25T00:07:00Z
  checked: delete.ts line 130
  found: Command receives `options.space` from CLI flag and passes to fetchEntityDetails (line 174)
  implication: Space ID is currently required via --space flag, not read from CSV

- timestamp: 2026-02-25T00:08:00Z
  checked: cli.ts line 44
  found: --space is defined as requiredOption (32-char hex)
  implication: CLI enforces space ID as mandatory flag

- timestamp: 2026-02-25T00:09:00Z
  checked: Parser function signature (line 31)
  found: parseEntityIds(filePath: string, tabName: string): EntityIdParseResult
  implication: Parser does not currently return space IDs, only entity IDs

- timestamp: 2026-02-25T00:10:00Z
  checked: Parser return type (lines 12-15)
  found: EntityIdParseResult { ids: string[]; errors: string[]; }
  implication: Type must be extended to include space IDs

- timestamp: 2026-02-25T00:11:00Z
  checked: Upsert command (upsert.ts)
  found: Upsert uses parseExcelFile (different parser), not parseEntityIds
  implication: This change is isolated to delete command only

- timestamp: 2026-02-25T00:12:00Z
  checked: Test files for parser
  found: No test files exist for entity-id-parser.ts
  implication: No existing tests to update, may want to add tests for new behavior

- timestamp: 2026-02-25T00:13:00Z
  checked: CSV structure via XLSX.utils.sheet_to_json with headers
  found: Parser uses sheet_to_json which returns objects with header keys as properties
  implication: Can access row['Space ID'] and row['Entity ID'] by header name instead of index

- timestamp: 2026-02-25T00:14:00Z
  checked: Multiple space ID support requirement
  found: fetchEntityDetails and all API calls expect single space ID, validation happens per-entity
  implication: Should validate single unique space ID across entire CSV for consistency

## Resolution

root_cause: Parser reads column index 0 (Space ID) as entity IDs, when CSV template has Entity ID in column 1. Space ID is required via --space CLI flag, but user decision is to read it from CSV instead.

fix: DIAGNOSIS COMPLETE - Ready for implementation phase

### ANSWER TO USER QUESTIONS:

**1. Exact code locations that need to change:**

- **src/parsers/entity-id-parser.ts**
  - Line 12-15: EntityIdParseResult interface - Add `spaceId: string` field
  - Line 54-74: Main parsing loop - Change from `Object.values(row)[0]` to named columns `row['Space ID']` and `row['Entity ID']`
  - Line 31-78: Add space ID validation logic - collect space IDs, validate single unique value across CSV
  - Line 19: Update JSDoc to reflect new two-column expectation

- **src/commands/delete.ts**
  - Line 148: parseEntityIds call - Capture returned spaceId from parser result
  - Line 130: Remove `options.space` from logging (will use parsed space)
  - Line 174: Change `options.space` to parsed spaceId in fetchEntityDetails
  - Line 191: Change `options.space` to parsed spaceId in error message
  - Line 222: Change `options.space` to parsed spaceId in DeleteReport
  - Line 282-285: Change `options.space` to parsed spaceId in Metadata
  - Line 323: Change `options.space` to parsed spaceId in final report

- **src/cli.ts**
  - Line 44: Change `requiredOption` to `option` - make --space optional
  - Line 50-56: Update action handler types - make `space` optional
  - Line 63-70: Add logic to handle optional space (if provided as flag, use it; otherwise rely on CSV)

- **src/config/delete-types.ts**
  - Line 13: Change `space: string` to `space?: string` - make optional

**2. Whether --space should become optional (with CSV as primary source) or removed entirely:**

**RECOMMENDATION: Make --space OPTIONAL with CSV as primary source**

**Reasoning:**
- CSV should be the primary source (user decision)
- Keep --space as optional override for backward compatibility or edge cases
- Priority order: CLI flag (if provided) > CSV value > error
- This provides flexibility without breaking existing workflows
- If flag provided AND conflicts with CSV, validation should fail with clear error

**3. Impact on upsert command:**

**NO IMPACT - Upsert is isolated**

Evidence:
- Upsert uses parseExcelFile (src/parsers/excel-parser.ts), not parseEntityIds
- Upsert has different spreadsheet structure with Types, Properties, Entities tabs
- Upsert extracts space ID from Entities tab metadata field, not from --space flag
- No shared code path between upsert and delete parsers

**4. Whether multiple space IDs per CSV should be supported or rejected:**

**RECOMMENDATION: REJECT multiple space IDs - enforce single space per CSV**

**Reasoning:**
- API design: fetchEntityDetails, publishToGeo, all operations work with single space context
- Report structure: DeleteReport has single `spaceId` field, not array
- Transaction atomicity: Geo transactions are space-scoped, can't delete across spaces in one tx
- User clarity: One CSV = one space operation keeps mental model simple
- Error prevention: Mixing entities from different spaces likely indicates user error

**Implementation:**
- Collect all space IDs from CSV rows into Set
- After parsing, validate Set.size === 1
- If multiple space IDs found, return error: "CSV contains multiple space IDs: [id1, id2]. Each CSV must target a single space."
- If --space flag provided AND differs from CSV space, return error: "Space ID mismatch: --space flag (X) differs from CSV Space ID column (Y)"

### FILES TO MODIFY:
1. src/parsers/entity-id-parser.ts - Core parser changes
2. src/commands/delete.ts - Use parsed space ID instead of options.space
3. src/cli.ts - Make --space optional
4. src/config/delete-types.ts - Make space optional in type

### VALIDATION LOGIC TO ADD:
- Single space ID per CSV (reject if multiple)
- --space flag vs CSV space ID conflict detection (reject if mismatch)
- At least one space ID present (from CSV or flag)
- Space ID format validation (32-char hex)

verification: Diagnosis complete - ready for implementation
files_changed: []
