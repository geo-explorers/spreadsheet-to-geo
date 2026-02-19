# Codebase Concerns

**Analysis Date:** 2026-02-19

## Tech Debt

**Incomplete API integration for properties:**
- Issue: `searchPropertiesByNames()` in `src/api/geo-client.ts` (lines 247-278) treats properties as entities and returns placeholder values for `dataTypeId` and `dataTypeName` (both empty strings)
- Files: `src/api/geo-client.ts:267-270`
- Impact: Property metadata (data type information) is not populated from API. Properties are still created correctly, but API doesn't provide the full property definition for already-created properties
- Fix approach: Implement proper GraphQL query for property lookup that returns actual `dataTypeId` and `dataTypeName` fields, or refactor to use entity-based property lookup if API supports it

**Mainnet RPC URL is a placeholder:**
- Issue: `NETWORKS[MAINNET].rpcUrl` is hardcoded as a placeholder in `src/publishers/publisher.ts:31`
- Files: `src/publishers/publisher.ts:31`
- Impact: Publishing to MAINNET will fail with invalid RPC connection
- Fix approach: Update with actual mainnet RPC URL before any production deployment

**Hardcoded DAO space requirements lack guidance:**
- Issue: DAO space publishing requires `DAO_SPACE_ADDRESS` and `CALLER_SPACE_ID` environment variables but error message provides no guidance on how to obtain these
- Files: `src/publishers/publisher.ts:206-213`
- Impact: Users attempting DAO space publishing without these variables get an error but no documentation on where to find them
- Fix approach: Add documentation link or more detailed error message explaining what these values represent and where to source them

## Known Limitations (by Design)

**Cannot modify linked entities:**
- Issue: Relations can only be created for entities with `action='CREATE'`. Entities with `action='LINK'` (existing in Geo) skip relation building
- Files: `src/processors/relation-builder.ts:54-58`
- Impact: If a curator wants to add relations to an entity that already exists in Geo, those relations will be silently skipped
- Workaround: Users must manually add relations in Geo UI for existing entities
- Justification: Modifying linked entities would require access to other spaces, which the SDK doesn't support

**Relation targets without types are skipped:**
- Issue: Entities referenced only as relation targets (not in any entity tab) with no types are skipped during batch creation
- Files: `src/processors/batch-builder.ts:242-244`
- Impact: If a relation target is not found in Geo API and has no type information, it won't be created. Relations referencing it will fail
- Workaround: Add relation target to an entity tab to assign it a type
- Justification: Per IDEA.md, types come from entity tabs only. Relation targets without tabs have no type context

## Performance Considerations

**Batch processing for entity search is sequential within each batch:**
- Issue: Type and property searches use `for...of` loops that search one at a time `src/api/geo-client.ts:226-236` (types) and `src/api/geo-client.ts:260-273` (properties)
- Files: `src/api/geo-client.ts:226-236`, `src/api/geo-client.ts:260-273`
- Impact: For 100+ types or properties, search time is linear with count. Entities are searched in parallel batches (line 172), but types/properties are fully sequential
- Improvement path: Switch types and properties to use `Promise.all()` within batches like entities do, or implement a single bulk query

**No caching of API results:**
- Issue: Each run queries Geo API for all entities, types, and properties from scratch
- Files: `src/processors/entity-processor.ts:61-65`
- Impact: Large spreadsheets with hundreds of unique names result in many API calls every run. No offline mode or result caching
- Improvement path: Implement optional result caching (e.g., `~/.geo-publish-cache.json`) with TTL, add `--use-cache` flag

## Fragile Areas

**Normalization is inconsistent across parsing:**
- Issue: Entity name normalization happens in `normalizeEntityName()` `src/utils/cell-parsers.ts:61-68`, but column name normalization happens separately in `normalizeColumnName()` `src/parsers/excel-parser.ts:91-93`
- Files: `src/utils/cell-parsers.ts:61-68`, `src/parsers/excel-parser.ts:91-93`
- Why fragile: If normalization logic differs between entity names and column names, mismatches could silently drop columns or link wrong entities
- Safe modification: Keep both normalization functions in sync; consider centralizing both to use identical logic

**Date/time parsing relies on `Date` constructor without strict validation:**
- Issue: `parseDate()` uses `new Date(trimmed)` which accepts many formats and silently parses others incorrectly
- Files: `src/utils/cell-parsers.ts:134`, `src/utils/cell-parsers.ts:200`
- Why fragile: JavaScript's `Date` constructor is very lenient. "2024-13-01" will silently wrap to next year. "2024/01/15" might work depending on timezone
- Safe modification: Use explicit regex patterns for each expected date format (YYYY-MM-DD, MM/DD/YYYY, etc.) before passing to Date constructor

**Error handling in entity processor uses thrown errors for normal control flow:**
- Issue: `resolveEntityId()`, `resolveTypeId()`, `resolvePropertyId()` throw errors that are caught in batch-builder as warnings, not as hard failures
- Files: `src/processors/entity-processor.ts:420-428`, `src/processors/batch-builder.ts:95-98`
- Why fragile: Mix of exceptions for control flow makes stack traces noisy and obscures whether an error is fatal or recoverable
- Safe modification: Return `Option<T>` or `Result<T, E>` types instead of throwing; let batch-builder decide what to do

**Private key validation only checks format, not actual validity:**
- Issue: `validatePrivateKey()` only validates the format (66 chars, hex), not whether it's actually a valid Secp256k1 key
- Files: `src/publishers/publisher.ts:271-282`
- Why fragile: An invalid key will pass validation but fail later during wallet initialization with a cryptic error
- Safe modification: Attempt to initialize a test wallet with the key and report any errors early

## Missing Protections

**No dedupe within a single entity tab:**
- Issue: Validator doesn't catch duplicate entity names in the same entity tab (only warns if across tabs)
- Files: `src/parsers/validators.ts:214-230` — only errors on duplicates in same tab by accident, inconsistently
- Risk: If a tab has the same entity twice, both rows will be processed, and batch-builder will skip the second by deduplication map
- Recommendation: Validator should error explicitly on duplicate names within same tab; let user fix it

**No validation that relation targets will be found:**
- Issue: Validator warns if relation target is not in spreadsheet, but doesn't verify it exists in Geo (dry-run only checks via warning)
- Files: `src/parsers/validators.ts:318-330`
- Risk: Relation will be created to a non-existent entity ID if target is not in spreadsheet AND not in Geo, causing silent failures
- Recommendation: During `buildEntityMap()`, log entity creation for relation targets with no types; explicitly mark them as "will fail if not in Geo"

**No size limits on operations batch:**
- Issue: No validation that the total operations count won't exceed SDK or blockchain limits
- Files: `src/processors/batch-builder.ts` generates ops but doesn't validate total count
- Risk: Spreadsheet with thousands of entities could generate a batch too large to submit
- Recommendation: Add check after Phase 4 that `ops.length < MAX_OPS_PER_BATCH` and warn user if exceeded

## Test Coverage Gaps

**No tests for error paths:**
- What's not tested: Invalid private keys, API failures, transaction rejections, malformed spreadsheet data
- Files: `src/publishers/publisher.ts`, `src/api/geo-client.ts`, `src/parsers/excel-parser.ts`
- Risk: Errors in these paths may silently produce confusing output or crash unexpectedly
- Priority: High — these are user-facing error cases

**No integration tests with actual Geo API:**
- What's not tested: Actual API connectivity, entity search accuracy, transaction submission
- Files: `src/api/geo-client.ts`, `src/publishers/publisher.ts`
- Risk: Changes to API query format or SDK version could break in production without detection
- Priority: High — critical path functionality

**No round-trip validation:**
- What's not tested: Data integrity after publish (e.g., verify created entities have correct properties/relations in Geo)
- Files: `src/publishers/publisher.ts`
- Risk: Publish could succeed but silently drop properties or relations without user awareness
- Priority: Medium — affects data correctness

## Security Considerations

**Environment variable handling:**
- Risk: `PRIVATE_KEY` is loaded from `.env` but never validated for correctness until wallet initialization (late in the flow)
- Files: `src/index.ts:144-156`
- Current mitigation: Format validation before use
- Recommendations:
  1. Validate key format immediately after load, before any other processing
  2. Warn if `.env` file is world-readable
  3. Clear key from memory after wallet initialization (not currently done)

**No rate limiting on API requests:**
- Risk: Large spreadsheets could send many rapid API queries, hitting rate limits or being blocked
- Files: `src/api/geo-client.ts:172-182` (batches 20 at a time but no backoff)
- Current mitigation: Batching limits concurrent requests to 20 entities per batch
- Recommendations:
  1. Add exponential backoff on 429/rate limit responses
  2. Add configurable `--api-delay` flag for slower environments

**No input sanitization on entity/property names:**
- Risk: Excel cell content (entity names, property values) is used directly in API queries without escaping special characters
- Files: `src/api/geo-client.ts:114-138`, `src/processors/batch-builder.ts:209-215`
- Current mitigation: GraphQL variable injection is prevented by using `variables` parameter (not string interpolation)
- Recommendations: Verify GraphQL library properly escapes all variable inputs (likely safe)

## Dependencies at Risk

**`@geoprotocol/geo-sdk` pinned to `latest`:**
- Risk: Package.json specifies `"@geoprotocol/geo-sdk": "latest"` which means every install could pull a different version
- Files: `package.json:17`
- Impact: Builds are non-reproducible; breaking changes in SDK could silently break deployments
- Migration plan: Pin to specific version (e.g., `"^1.2.3"`) and manually test SDK updates

**`xlsx` library (0.18.5) is large and not regularly audited in this project:**
- Risk: XLSX parsing could have security vulnerabilities in formula evaluation or cell content processing
- Files: `src/parsers/excel-parser.ts`
- Current mitigation: Script only reads cell values, doesn't evaluate formulas
- Recommendations: Consider `sheetjs/xlsx` alternatives for smaller footprint, or run `npm audit`

---

*Concerns audit: 2026-02-19*
