---
status: complete
phase: 04-bulk-merge
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md]
started: 2026-03-05T00:00:00Z
updated: 2026-03-05T00:01:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Merge CLI subcommand exists
expected: Running `npx ts-node src/cli.ts merge --help` shows the merge subcommand with all five options (--dry-run, --network, --output, --verbose, --yes)
result: pass

### 2. Parse merge template from Excel
expected: Running merge against a valid Excel template with Metadata and Merge tabs successfully parses keeper/merger pairs without errors. Invalid templates (missing columns, same entity as keeper and merger) produce clear error messages.
result: pass

### 3. Dry-run merge diff preview
expected: Running `geo-publish merge template.xlsx --dry-run` fetches entity details, computes diffs, and prints a colored terminal diff showing property transfers, conflicts (keeper wins), relation re-points, and type unions -- without publishing anything.
result: pass

### 4. Per-pair atomic publishing
expected: Running merge (non-dry-run) publishes each keeper/merger pair as a separate atomic transaction. If one pair fails, already-published pairs remain committed and remaining pairs continue processing.
result: pass

### 5. Pre-merge snapshot saving
expected: Before publishing, the tool saves both keeper and merger entity states to .snapshots/ directory for recovery purposes.
result: pass

### 6. Merge summary and report output
expected: After merge completes, a summary prints aggregate counts (pairs processed, succeeded, failed) and per-pair publish results. With --output, a JSON report file is saved following the OperationReport format.
result: pass

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
