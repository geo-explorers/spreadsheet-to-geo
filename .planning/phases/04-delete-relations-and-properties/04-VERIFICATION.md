---
phase: 04-delete-relations-and-properties
verified: 2026-03-05T12:30:00Z
status: human_needed
score: 9/11 requirements verified (P4-04 and P4-10 require live API/blockchain)
re_verification: false
human_verification:
  - test: "Validate relation IDs via live API (P4-04)"
    expected: "fetchRelationById() returns null for non-existent relation IDs, causing command to abort with all invalid IDs listed"
    why_human: "Requires live Geo GraphQL API connection. The root `relations(filter: { id: { is: $id } })` query pattern is inferred from existing API patterns; runtime behavior cannot be confirmed statically."
  - test: "Atomic publish of mixed deleteRelation + updateEntity(unset) ops (P4-10)"
    expected: "All ops (relation deletions + property unsets) succeed or fail together as a single transaction; no partial state on blockchain"
    why_human: "Requires live testnet blockchain transaction. Static code confirms all ops are passed to publishToGeo() in one batch, but atomicity is enforced by the Geo protocol layer, not the client code."
  - test: "Validate entity IDs for property unsets via live API (P4-05)"
    expected: "fetchEntityDetails() returns null for non-existent entity IDs, causing abort with all invalid IDs listed before any ops are built"
    why_human: "Integration behavior with live Geo API cannot be verified statically."
  - test: "End-to-end dry-run with sample spreadsheet"
    expected: "Running `geo-publish delete-triples sample.xlsx --dry-run` shows relation and property preview tables, saves report, exits 0, makes no blockchain calls"
    why_human: "Requires Excel file fixture and running the built CLI."
---

# Phase 04: Delete Relations and Properties — Verification Report

**Phase Goal:** Users can selectively delete specific relations and unset specific properties from entities (without deleting the entities themselves) via an Excel spreadsheet with separate Relations and Properties tabs, validated and published atomically

**Verified:** 2026-03-05T12:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Excel file with Relations tab is parsed into relation ID + space ID pairs | VERIFIED | `parseTriplesFile()` in triples-parser.ts:228 reads "Relations" sheet, columns "Relation ID" and "Space ID", returns `RelationEntry[]` |
| 2 | Excel file with Properties tab is parsed into entity ID + property ID + space ID triples | VERIFIED | `parsePropertiesTab()` in triples-parser.ts:122 reads "Properties" sheet with all three columns, returns `PropertyUnsetEntry[]` |
| 3 | Missing or empty tabs are tolerated as long as at least one tab has data | VERIFIED | triples-parser.ts:247 checks `relations.items.length === 0 && properties.items.length === 0` and only errors if BOTH are empty |
| 4 | Space ID consistency is enforced across both tabs | VERIFIED | triples-parser.ts:255-265 collects all space IDs into one Set and rejects if `size > 1` |
| 5 | Duplicate IDs are rejected with row-level error messages | VERIFIED | Relations: `seen.has(id)` check at triples-parser.ts:87. Properties: `seenPairs.has(pairKey)` at triples-parser.ts:193. Both include row number (`i + 2`) |
| 6 | deleteRelation ops are built for each validated relation ID | VERIFIED | delete-triples-builder.ts:39-42: `Graph.deleteRelation({ id: relation.relationId })` called per entry |
| 7 | updateEntity(unset) ops are grouped by entity ID for efficiency | VERIFIED | delete-triples-builder.ts:45-60: `Map<string, string[]>` groups propertyIds per entityId, then one `Graph.updateEntity({ id, unset: [...] })` per entity |
| 8 | Running `geo-publish delete-triples file.xlsx` parses, validates, and publishes atomically | VERIFIED (code path) | delete-triples.ts:31-324 implements full pipeline; cli.ts:106-137 registers subcommand |
| 9 | Running with --dry-run shows relation and property counts without publishing | VERIFIED (code path) | delete-triples.ts:161-205: builds ops, logs counts, renders preview tables, saves report, exits before publish |
| 10 | Invalid relation IDs or entity IDs cause fail-fast with all errors reported | VERIFIED (code path) | delete-triples.ts:109-116 collects all invalid relation IDs and exits; lines 144-151 collect all invalid entity IDs and exits |
| 11 | CLI help shows delete-triples as available subcommand | VERIFIED | cli.ts:106: `.command('delete-triples')` with description "Delete specific relations and unset specific properties from entities" |

**Score (automated verification):** 9/11 truths fully verified; 2 require live API/blockchain (P4-04, P4-10)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config/delete-triples-types.ts` | 6 type interfaces for delete-triples pipeline | VERIFIED | Exports: `RelationEntry`, `PropertyUnsetEntry`, `TriplesParseResult`, `DeleteTriplesOptions`, `DeleteTriplesSummary`, `DeleteTriplesBatch`. File: 54 lines, fully substantive. |
| `src/parsers/triples-parser.ts` | Two-tab Excel parser | VERIFIED | Exports `parseTriplesFile()`. 276 lines. Full parse/validate/dedup logic for both tabs. BOM-tolerant via `getColumnValue()`. |
| `src/processors/delete-triples-builder.ts` | Op builder for deleteRelation + updateEntity(unset) | VERIFIED | Exports `buildDeleteTriplesOps()`. 71 lines. Pure function, no stubs, grouping logic present. |
| `src/api/geo-client.ts` | Relation existence validation via GraphQL | VERIFIED | `fetchRelationById()` exported at line 640. Full GraphQL query with try/catch, returns null on failure. |
| `src/config/types.ts` | DeleteTriplesReport type in OperationReport union | VERIFIED | `DeleteTriplesReport` interface at line 171. `OperationReport` union updated at line 189 to include it. |
| `src/commands/delete-triples.ts` | Full command handler pipeline | VERIFIED | Exports `deleteTriplesCommand()`. 325 lines. All pipeline steps implemented: parse, validate, dry-run, confirm, publish, report. No stubs. |
| `src/cli.ts` | delete-triples subcommand registration | VERIFIED | Lines 105-137: `deleteTriplesCmd` registered with all standard flags (-s, -n, --dry-run, -f, -o, -v). Dynamic import pattern consistent with other subcommands. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/parsers/triples-parser.ts` | `src/config/delete-triples-types.ts` | imports RelationEntry, PropertyUnsetEntry, TriplesParseResult | WIRED | Line 15-19: `import type { RelationEntry, PropertyUnsetEntry, TriplesParseResult } from '../config/delete-triples-types.js'` |
| `src/processors/delete-triples-builder.ts` | `src/config/delete-triples-types.ts` | imports DeleteTriplesBatch, DeleteTriplesSummary | WIRED | Lines 15-20: imports RelationEntry, PropertyUnsetEntry, DeleteTriplesBatch, DeleteTriplesSummary |
| `src/processors/delete-triples-builder.ts` | `@geoprotocol/geo-sdk` | Graph.deleteRelation() and Graph.updateEntity({ unset }) | WIRED | Line 40: `Graph.deleteRelation({ id: relation.relationId })`. Line 55: `Graph.updateEntity({ id: entityId, unset: [...] })` |
| `src/commands/delete-triples.ts` | `src/parsers/triples-parser.ts` | parseTriplesFile() | WIRED | Line 14: `import { parseTriplesFile } from '../parsers/triples-parser.js'`. Called at line 53. |
| `src/commands/delete-triples.ts` | `src/api/geo-client.ts` | fetchRelationById(), fetchEntityDetails() | WIRED | Line 15: `import { fetchRelationById, fetchEntityDetails } from '../api/geo-client.js'`. Used at lines 96 and 131. |
| `src/commands/delete-triples.ts` | `src/processors/delete-triples-builder.ts` | buildDeleteTriplesOps() | WIRED | Line 16: import. Called at line 158. |
| `src/commands/delete-triples.ts` | `src/publishers/publisher.ts` | publishToGeo() | WIRED | Line 17: import. Called at line 271. |
| `src/cli.ts` | `src/commands/delete-triples.ts` | dynamic import in subcommand action | WIRED | Line 128: `await import('./commands/delete-triples.js')`. Called at line 129. |

---

## Requirements Coverage

P4 requirements are defined in `04-RESEARCH.md` (not in REQUIREMENTS.md — they are phase-specific "implicit requirements" not in the v1 requirements table). The REQUIREMENTS.md traceability table does not include Phase 4 entries, which is a documentation gap noted below.

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| P4-01 | 04-01-PLAN | Parse Relations tab with Relation ID and Space ID columns | SATISFIED | `parseRelationsTab()` in triples-parser.ts:52-116 reads both columns with validation |
| P4-02 | 04-01-PLAN | Parse Properties tab with Entity ID, Property ID, Space ID columns | SATISFIED | `parsePropertiesTab()` in triples-parser.ts:122-213 reads all three columns |
| P4-03 | 04-01-PLAN | Allow empty/missing tabs (at least one must have data) | SATISFIED | triples-parser.ts:235-252: each tab checked independently; both-empty triggers error |
| P4-04 | 04-02-PLAN | Validate all relation IDs exist via API before building ops | NEEDS HUMAN | Code path wired (delete-triples.ts:88-118), but live API call not testable statically |
| P4-05 | 04-02-PLAN | Validate all entity IDs exist before building unset ops | NEEDS HUMAN | Code path wired (delete-triples.ts:122-155), but live API call not testable statically |
| P4-06 | 04-01-PLAN | Fail-fast: report ALL invalid IDs and abort | SATISFIED | Parser accumulates all errors (no fail-on-first). Command collects all invalid IDs in loop before exit. |
| P4-07 | 04-01-PLAN | Build deleteRelation ops for each relation ID | SATISFIED | delete-triples-builder.ts:39-42: `Graph.deleteRelation()` per relation |
| P4-08 | 04-01-PLAN | Build updateEntity(unset) ops grouped by entity | SATISFIED | delete-triples-builder.ts:45-60: Map-based grouping, one call per entity |
| P4-09 | 04-02-PLAN | Dry-run shows preview without publishing | SATISFIED (code path) | delete-triples.ts:161-205: preview, report save, exit(0) before any publishToGeo() call |
| P4-10 | 04-02-PLAN | All ops published as single atomic transaction | NEEDS HUMAN | delete-triples.ts:271: single `publishToGeo()` call with all ops in one batch; atomicity is protocol-layer guarantee |
| P4-11 | 04-01-PLAN | Enforce single space ID across both tabs | SATISFIED | triples-parser.ts:255-265: `allSpaceIds.size > 1` check with descriptive error listing all found IDs |

**Requirements not in REQUIREMENTS.md:** P4-01 through P4-11 are defined only in 04-RESEARCH.md. The REQUIREMENTS.md traceability table stops at UPD-06 (Phase 3) and has no Phase 4 entries. This is a documentation debt, not a code issue.

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None | — | — | — |

No TODO, FIXME, placeholder returns, or stub patterns found in any Phase 4 files. All implementations are substantive. TypeScript compilation passes with zero errors (confirmed via `npx tsc --noEmit`).

---

## Commit Verification

All four phase commits verified against actual git history:

| Commit | Description | Files | Status |
|--------|-------------|-------|--------|
| `abf37b3` | Add delete-triples types and two-tab Excel parser | delete-triples-types.ts, triples-parser.ts (+328 lines) | VERIFIED |
| `95844ab` | Add relation validation and delete-triples ops builder | geo-client.ts (+40 lines), delete-triples-builder.ts (+70 lines) | VERIFIED |
| `efbbdb6` | Add DeleteTriplesReport type and command handler | delete-triples.ts (+325 lines), types.ts (+19 lines) | VERIFIED |
| `d00146c` | Register delete-triples subcommand in CLI router | cli.ts (+35 lines) | VERIFIED |

---

## Human Verification Required

### 1. Relation ID Validation via Live API (P4-04)

**Test:** With a sample spreadsheet containing a known-valid relation ID and a known-invalid relation ID in the Relations tab, run `geo-publish delete-triples sample.xlsx --dry-run` against testnet.

**Expected:** The command prints both invalid relation IDs, logs "All relation IDs must exist. Aborting.", and exits 1 without building or publishing any ops.

**Why human:** The `fetchRelationById()` GraphQL query uses `relations(filter: { id: { is: $id }, spaceId: { is: $spaceId } })`. Research notes that root `id` filter support on the `relations` query needs runtime confirmation. If unsupported, the function returns null on error (due to try/catch), which still triggers abort — but the error message would differ.

### 2. Atomic Publish of Mixed Ops (P4-10)

**Test:** With a valid spreadsheet containing at least one relation ID and one entity+property pair, run against testnet (live publish, not dry-run).

**Expected:** Single transaction hash returned. Explorer shows one transaction containing both deleteRelation and updateEntity(unset) ops. If the transaction fails mid-way, neither the relation deletion nor the property unset should be persisted.

**Why human:** Atomicity is guaranteed by the Geo protocol's transaction layer, not by client code. Static analysis confirms all ops go in one `publishToGeo()` call, but the atomic guarantee requires live blockchain verification.

### 3. Entity ID Validation for Property Unsets (P4-05)

**Test:** Spreadsheet with Properties tab containing one valid entity ID and one invalid entity ID. Run with --dry-run.

**Expected:** Command logs both invalid entity IDs and aborts before dry-run preview. Specifically, does NOT proceed to the dry-run section.

**Why human:** Requires live API call to `fetchEntityDetails()`.

### 4. End-to-End Dry Run

**Test:** Create a sample `.xlsx` file with "Relations" tab (columns: Relation ID, Space ID) and "Properties" tab (columns: Entity ID, Property ID, Space ID). Run `geo-publish delete-triples sample.xlsx --dry-run`.

**Expected:** Prints "Dry Run Preview" section with counts and preview tables for both relations and properties. Saves a JSON report to `./reports/`. Exits with 0. Makes no API calls to publisher.

**Why human:** Requires running the built CLI with an actual Excel fixture.

---

## Documentation Gap (Non-Blocking)

**Issue:** P4 requirements (P4-01 through P4-11) are defined in `04-RESEARCH.md` but are absent from `REQUIREMENTS.md` and its traceability table. The REQUIREMENTS.md table ends at UPD-06 / Phase 3.

**Impact:** No impact on code correctness or feature completeness. The phase delivered all intended behavior. This is a documentation hygiene issue.

**Suggested fix:** Add P4-01 through P4-11 to REQUIREMENTS.md under a new "Delete Triples Operation" section and add Phase 4 rows to the traceability table.

**Template file (noted, not blocking):** CONTEXT.md decision 56 mentions shipping a "Geo delete-triples template.xlsx" file. This was not included in any plan's tasks or must_haves and is not listed as a P4 requirement. No plan committed it. This should be tracked as a follow-on task if desired.

---

## Summary

Phase 04 goal is **substantially achieved**. All 7 core artifacts are present, substantive (not stubs), and correctly wired. All 11 P4 requirements have code implementations. TypeScript compiles clean with no errors. Four commits are verified in git history.

Three items require human verification with a live environment (P4-04, P4-05, P4-10) — these are integration behaviors that depend on live API and blockchain, not gaps in code implementation. The code paths for all three are present and correctly wired.

The one documentation gap (P4 requirements absent from REQUIREMENTS.md) does not affect feature delivery.

---

_Verified: 2026-03-05T12:30:00Z_
_Verifier: Claude (gsd-verifier)_
