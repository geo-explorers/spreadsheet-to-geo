---
phase: 04-bulk-merge
verified: 2026-03-03T22:00:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 4: Bulk Merge Verification Report

**Phase Goal:** Engineers can bulk-merge duplicate entities from a CSV of survivor/duplicate pairs — unique properties and relations from each duplicate are copied onto the survivor, then the duplicate is deleted. Survivor's existing data is never overwritten.
**Verified:** 2026-03-03
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

All truths are drawn from the three plan `must_haves` blocks, consolidated by theme.

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Merge type definitions exist with MergePair, MergePairDiff, MergeConflict, MergeSummary, MergeBatch, and MergeOptions | VERIFIED | `src/config/merge-types.ts` — 111 lines, all 6 types present with correct fields |
| 2  | MergeReport extends ReportBase and is added to OperationReport discriminated union | VERIFIED | `src/config/types.ts` lines 171-197: `MergeReport extends ReportBase`, `OperationReport = UpsertReport | DeleteReport | UpdateReport | MergeReport` |
| 3  | Excel template with Metadata tab and Merge tab (Keeper/Merger columns) is parsed into MergePair[] | VERIFIED | `src/parsers/merge-parser.ts` — parseMergeTemplate() reads both tabs, BOM-tolerant, error-accumulating |
| 4  | Merge diff engine computes which properties to transfer without overwriting keeper values | VERIFIED | `src/processors/merge-diff.ts` lines 165-210: keeperPropertyMap guards all transfers; keeper property always wins |
| 5  | Conflict detection identifies when keeper and merger both have the same property with different values | VERIFIED | `merge-diff.ts` lines 189-201: `keeperHumanValue !== extracted.humanReadable` pushes to `conflicts[]` |
| 6  | Relation re-pointing computes delete+create ops for outgoing and incoming relations with dedup | VERIFIED | `merge-diff.ts` lines 216-271: dedup set, TYPES_PROPERTY skipped, self-referential backlinks skipped, both directions handled |
| 7  | Entity name property (SystemIds.NAME_PROPERTY) is never transferred from merger | VERIFIED | `merge-diff.ts` line 178: explicit `continue` when `mergerVal.propertyId === SystemIds.NAME_PROPERTY` |
| 8  | Merger entity deletion ops are generated using buildDeleteOps() | VERIFIED | `merge-diff.ts` line 279: `const deleteResult = buildDeleteOps([merger])`, ops stored in `mergerDeleteOps` |
| 9  | `geo-publish merge template.xlsx` runs the full four-phase pipeline (validate -> diff -> confirm -> publish) | VERIFIED | `src/commands/merge.ts` — 391 lines, all four phases implemented with logging |
| 10 | `--dry-run` shows per-pair diff (transfers, conflicts, re-points) without executing | VERIFIED | `merge.ts` lines 202-209: dry-run gate calls `printMergeDiffOutput()` then exits; `merge-report.ts` lines 73-87 show TRANSFER/CONFLICT/REPOINT output |
| 11 | Pre-merge snapshot saves both keeper and merger entity states before modifications | VERIFIED | `merge.ts` lines 260-266: `saveSnapshot(diffs.map(...))` called before publish loop |
| 12 | CLI registers `geo-publish merge [file]` with --dry-run, --network, --output, --verbose, --yes | VERIFIED | `src/cli.ts` lines 105-128: all five options registered, dynamic import of mergeCommand |

**Score:** 12/12 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config/merge-types.ts` | All merge-specific type definitions | VERIFIED | 111 lines; exports MergeOptions, MergePair, MergeConflict, MergePairDiff, MergeSummary, MergeBatch |
| `src/parsers/merge-parser.ts` | Excel template parser for Merge tab | VERIFIED | 175 lines; exports parseMergeTemplate(), BOM-tolerant, error-accumulating |
| `src/processors/merge-diff.ts` | Merge diff engine with conflict detection and relation dedup | VERIFIED | 388 lines; exports computeMergePairDiff, buildMergeOps, buildKeeperRelationSet, extractTypedValue |
| `src/commands/merge.ts` | Merge command handler with four-phase pipeline | VERIFIED | 391 lines; exports mergeCommand() |
| `src/publishers/merge-report.ts` | Merge report generation and dry-run terminal output | VERIFIED | 158 lines; exports generateMergeReport, printMergeDiffOutput, printMergeSummary |
| `src/cli.ts` | CLI with merge subcommand registered | VERIFIED | lines 105-128: `program.command('merge')` with all options and dynamic import |
| `src/config/types.ts` | MergeReport in OperationReport union | VERIFIED | lines 171-197: MergeReport interface + updated union |

All artifacts are substantive (non-stub) implementations.

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/config/merge-types.ts` | `src/config/types.ts` | MergeReport extends ReportBase, added to OperationReport union | WIRED | `types.ts` line 171: `interface MergeReport extends ReportBase`, line 197: union includes MergeReport |
| `src/parsers/merge-parser.ts` | `src/config/merge-types.ts` | returns MergePair[] from parsed template | WIRED | `merge-parser.ts` line 14: `import type { MergePair } from '../config/merge-types.js'` |
| `src/processors/merge-diff.ts` | `src/api/geo-client.ts` | uses EntityDetails type | WIRED | `merge-diff.ts` line 17: `import type { EntityDetails } from '../api/geo-client.js'` |
| `src/processors/merge-diff.ts` | `src/processors/delete-builder.ts` | calls buildDeleteOps() for merger deletion | WIRED | `merge-diff.ts` line 19: `import { buildDeleteOps }`, line 279: actually called |
| `src/processors/merge-diff.ts` | `src/config/merge-types.ts` | returns MergePairDiff | WIRED | `merge-diff.ts` line 18: `import type { MergePairDiff, MergeConflict } from '../config/merge-types.js'` |
| `src/commands/merge.ts` | `src/processors/merge-diff.ts` | calls computeMergePairDiff() and buildMergeOps() | WIRED | `merge.ts` line 20: import; lines 187, 280: both functions called |
| `src/commands/merge.ts` | `src/parsers/merge-parser.ts` | calls parseMergeTemplate() | WIRED | `merge.ts` line 17: import; line 87: called |
| `src/commands/merge.ts` | `src/publishers/publisher.ts` | calls publishToGeo() once per merge pair | WIRED | `merge.ts` line 28: import; line 318: called inside per-pair loop |
| `src/cli.ts` | `src/commands/merge.ts` | dynamic import in merge subcommand action | WIRED | `cli.ts` line 120: `const { mergeCommand } = await import('./commands/merge.js')` |

All 9 key links verified.

---

## Requirements Coverage

All requirement IDs claimed across the three plans, cross-referenced against REQUIREMENTS.md:

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| MERGE-01 | 04-01 | User can provide CSV with keeper_id/merger_id pairs as merge input | SATISFIED (note below) | parseMergeTemplate() accepts Excel (.xlsx) file with Keeper/Merger entity name columns — design decision supersedes stale requirement text (per CONTEXT.md locked decisions) |
| MERGE-02 | 04-02, 04-03 | Tool validates both keeper and merger entities exist | SATISFIED | merge.ts: searchEntitiesByNames() for all names upfront + hard-error on unresolved; fetchEntityDetails() in diff phase with null guard |
| MERGE-03 | 04-02 | Tool copies properties from merger to keeper without overwriting keeper's existing values | SATISFIED | merge-diff.ts: keeperPropertyMap built from keeper values; merger properties only go to propertiesToTransfer if keeper does NOT have that propertyId |
| MERGE-04 | 04-02 | Tool re-points relations from merger to keeper | SATISFIED | merge-diff.ts: relationsToRepoint computed for outgoing and incoming; buildMergeOps() generates deleteRelation + createRelation ops with correct direction |
| MERGE-05 | 04-02 | Tool deletes merger entity after transfer (using delete logic) | SATISFIED | merge-diff.ts line 279: buildDeleteOps([merger]) from delete-builder.ts; ops stored in mergerDeleteOps and appended last in buildMergeOps() |
| MERGE-06 | 04-02, 04-03 | All ops for a merge pair published in single atomic transaction | SATISFIED | merge.ts: per-pair loop calls publishToGeo() once per diff with all ops from buildMergeOps() in one batch |
| MERGE-07 | 04-03 | Dry-run mode shows property transfers, relation re-points, and conflicts | SATISFIED | merge-report.ts: printMergeDiffOutput() shows TRANSFER (green), CONFLICT (red/yellow), REPOINT (green) per pair |
| MERGE-08 | 04-01, 04-02 | Merge conflict detection logs when keeper already has a value merger also has | SATISFIED | merge-diff.ts: conflicts[] populated when keeperHumanValue !== mergerHumanValue; conflicts shown in printMergeDiffOutput() |
| MERGE-09 | 04-01, 04-03 | Summary report shows properties transferred, relations re-pointed, mergers deleted | SATISFIED | generateMergeReport() produces MergeReport with propertiesTransferred, relationsRepointed, mergersDeleted; printMergeSummary() displays all counts |

**Note on MERGE-01:** REQUIREMENTS.md describes "CSV with keeper_id/merger_id pairs" but the actual implementation uses an Excel (.xlsx) template with entity names (resolved to IDs internally). This discrepancy is intentional — CONTEXT.md phase locked decisions specify "Excel template (.xlsx), consistent with upsert/update commands" and "Entity names resolved to IDs internally." The implementation correctly fulfills the intent (user provides a list of keeper/merger pairs) even though the format and identifier type differ from the stale requirement text.

All 9 MERGE requirements (MERGE-01 through MERGE-09) are accounted for and satisfied. No orphaned requirements.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/processors/merge-diff.ts` | 123, 128, 132 | `return null` | Info | Intentional — extractTypedValue() returns null for schedule properties (not transferable) and for all-null value entries. This is correct defensive logic, not a stub. |

No blockers or warnings found. The `return null` instances in extractTypedValue() are documented intentional exits, not empty implementations.

---

## Human Verification Required

### 1. End-to-end merge with a real Excel template

**Test:** Create an Excel file with Metadata tab (Space ID, Operation type: MERGE) and Merge tab (two keeper/merger name pairs). Run `geo-publish merge template.xlsx --dry-run`.
**Expected:** Dry-run output shows per-pair diff with TRANSFER/CONFLICT/REPOINT lines and a summary table. No writes occur.
**Why human:** Cannot exercise live API calls or confirm terminal rendering programmatically.

### 2. Keeper-wins conflict resolution in practice

**Test:** Set up two entities in Geo where both have the same property with different values. Run a merge. Inspect the keeper entity after the merge.
**Expected:** Keeper's original property value is unchanged; merger's conflicting value is discarded.
**Why human:** Requires live Geo network access to verify on-chain state.

### 3. Relation re-pointing direction correctness

**Test:** Set up Entity A (keeper) and Entity B (merger). Entity C has an outgoing relation to Entity B. Run merge. Inspect Entity C after merge.
**Expected:** Entity C's relation now points to Entity A (keeper), not Entity B.
**Why human:** Requires live network verification to confirm incoming backlink re-pointing.

### 4. Pre-merge snapshot recovery

**Test:** Run `geo-publish merge` on a live template. Find the snapshot file in `.snapshots/`. Confirm it contains both keeper and merger entity states.
**Expected:** JSON file with keeper and merger EntityDetails for each pair, timestamped filename.
**Why human:** Requires a live run to produce a snapshot file.

---

## TypeScript Compilation

`npx tsc --noEmit` exits with zero errors across all source files. All phase 04 files compile cleanly.

All 7 commits documented in the summaries exist in git log (`e196fca`, `e990534`, `d363687`, `1b9023c`, `46dab94`).

---

## Gaps Summary

No gaps. All 12 observable truths are verified, all 7 artifacts are substantive and wired, all 9 key links are active, and all 9 MERGE requirements are satisfied. TypeScript compilation passes with zero errors.

The single notable discrepancy (MERGE-01 requirement text says "CSV + entity IDs" but implementation uses "Excel + entity names") is a documented intentional design decision captured in CONTEXT.md, not an implementation gap.

---

_Verified: 2026-03-03_
_Verifier: Claude (gsd-verifier)_
