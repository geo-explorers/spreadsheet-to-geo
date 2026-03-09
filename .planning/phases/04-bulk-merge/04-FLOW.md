# Merge Command — How It Works

**Command:** `geo-publish merge <file.xlsx> [options]`

Merges duplicate entities in Geo. The **keeper** survives, the **merger** gets absorbed and deleted.

## Template Format

Excel file with two tabs:

**Metadata tab** — Field/Value rows:
| Field | Value |
|-------|-------|
| Space ID | `<space-id>` |
| Operation type | MERGE |

**Merge tab** — one row per merge pair:
| Keeper ID | Merger ID | Keeper (optional) | Merger (optional) |
|-----------|-----------|-------|--------|
| `abc123...` | `def456...` | ChatGPT | GPT |
| `abc123...` | `ghi789...` | ChatGPT | Generative pre-trained transformer |

- **IDs are required** (32-char hex). Names are optional (for readability + cross-validation).
- N:1 merges: same Keeper ID on multiple rows = one keeper absorbs multiple mergers.

## Options

| Flag | Default | Purpose |
|------|---------|---------|
| `--dry-run` | false | Show diff only, don't publish |
| `--network` | TESTNET | TESTNET or MAINNET |
| `--yes` | false | Skip confirmation prompt |
| `--verbose` | false | Show skipped relations |
| `--output` | `./reports` | Report output directory |

---

## Pipeline (4 phases)

### Phase 1: VALIDATE

Parse the Excel template → extract pairs + space ID.

Parser validations:
- Both Keeper ID and Merger ID required per row
- Valid hex format (32 chars)
- Keeper ≠ Merger (can't merge entity into itself)
- No duplicate pairs
- No duplicate mergers (same merger into different keepers)
- No cycles (entity is keeper in one row, merger in another)

If names are provided, they're cross-validated against Geo (warn on mismatch, don't error).

### Phase 2: DIFF

For each pair:
1. **Fetch** keeper + merger details from Geo (by ID)
2. **Resolve names** — batch-fetch human-readable names for all property/type/relation IDs
3. **Compute diff:**

| What | Rule |
|------|------|
| Properties only merger has | **Transfer** to keeper |
| Properties both have (same value) | Skip |
| Properties both have (different value) | **Conflict** — keeper wins |
| Relations only merger has | **Re-point** to keeper |
| Relations both have (same target+type) | Skip (duplicate) |
| Types only merger has | **Add** to keeper |
| Merger entity | **Delete** (unset all properties, remove all relations) |
| Name property | Always skipped (keeper's name is canonical) |
| Description | Transfer only if keeper has none |

`--dry-run` stops here — prints the diff and exits.

### Phase 3: CONFIRM

Show a colored diff of all planned operations. Ask for confirmation (unless `--yes`).

```
[MERGE] ChatGPT ← GPT
  TRANSFER  Description = "GPT is a large language model..."
  CONFLICT  Founded: keeper="2022" / merger="2020" (keeper wins)
  REPOINT   [outgoing] Created By → OpenAI
  ADD TYPE  AI Model
  DELETE    GPT (def456...)
```

### Phase 4: PUBLISH

1. Save pre-merge snapshot to `.snapshots/` (for recovery)
2. For each pair, build SDK ops in order:
   - `Graph.updateEntity()` — transfer properties
   - `Graph.createRelation()` — assign types
   - Delete old relation + create new one — re-point relations
   - `buildDeleteOps()` — clean up merger
3. Publish each pair as a **separate atomic transaction**
4. Save report + print summary with explorer URLs

If a pair fails, already-published pairs stay committed. Snapshot file path is shown for recovery.

---

## File Map

```
src/
├── commands/merge.ts          4-phase orchestrator
├── parsers/merge-parser.ts    Excel → pairs + spaceId
├── processors/merge-diff.ts   Diff engine + op builder
├── processors/delete-builder.ts  Merger cleanup ops
├── publishers/merge-report.ts    Terminal diff + report
├── api/geo-client.ts          fetchEntityDetails, fetchEntityNamesByIds
└── config/merge-types.ts      MergePair, MergePairDiff, MergeSummary
```

## Key Rules

1. **Keeper wins** — conflicts always resolve in keeper's favor
2. **IDs required, names optional** — no ambiguous name matching
3. **Per-pair atomic** — each pair is a separate on-chain transaction
4. **Pre-merge snapshot** — full entity state saved before mutations
5. **Entity shell survives** — merger is emptied, not truly deleted (indexer limitation)
6. **Error accumulation** — parser collects all errors, reports them together

---

## Walkthrough: ChatGPT 3-Way Merge

Three curators published the same thing under different names:

**Entity A — ChatGPT** (keeper, published first)
- Type: AI model · Developer: OpenAI · Released: 2022
- Description: "OpenAI's flagship generative AI model..."
- Related topics: natural language processing, large language models, mainstream AI products

**Entity B — GPT** (merger #1)
- Type: AI model · Developer: OpenAI · Released: 2022
- Description: "A large-scale conversational language model..."
- Related topics: AI, large language models, AI tools

**Entity C — Generative pre-trained transformer** (merger #2)
- Type: AI model · Developer: OpenAI · Released: 2022
- Description: "OpenAI's most popular AI product"
- Related topics: AI models, large language models, AI tools

### Template

| Keeper ID | Merger ID | Keeper | Merger |
|-----------|-----------|--------|--------|
| `aaa...aaa` | `bbb...bbb` | ChatGPT | GPT |
| `aaa...aaa` | `ccc...ccc` | ChatGPT | Generative pre-trained transformer |

### What the diff engine computes

**Pair 1: ChatGPT ← GPT**

| Field | Keeper | Merger | Result |
|-------|--------|--------|--------|
| Name | ChatGPT | GPT | Skip (keeper canonical) |
| Type | AI model | AI model | Skip (same) |
| Developer | OpenAI | OpenAI | Skip (same) |
| Description | "OpenAI's flagship..." | "A large-scale..." | Conflict — keeper wins |
| Released | 2022 | 2022 | Skip (same) |
| Related: NLP | ✓ | ✗ | Already on keeper |
| Related: large language models | ✓ | ✓ | Skip (duplicate) |
| Related: mainstream AI products | ✓ | ✗ | Already on keeper |
| Related: AI | ✗ | ✓ | **Re-point to keeper** |
| Related: AI tools | ✗ | ✓ | **Re-point to keeper** |
| GPT entity | — | — | **Delete** |

**Pair 2: ChatGPT ← Generative pre-trained transformer**

| Field | Keeper | Merger | Result |
|-------|--------|--------|--------|
| Name | ChatGPT | Generative pre-trained transformer | Skip |
| Type | AI model | AI model | Skip (same) |
| Developer | OpenAI | OpenAI | Skip (same) |
| Description | "OpenAI's flagship..." | "OpenAI's most popular..." | Conflict — keeper wins |
| Released | 2022 | 2022 | Skip (same) |
| Related: AI models | ✗ | ✓ | **Re-point to keeper** |
| Related: large language models | ✓ | ✓ | Skip (duplicate) |
| Related: AI tools | ✓ (from Pair 1) | ✓ | Skip (duplicate) |
| Gen. PT entity | — | — | **Delete** |

### Terminal output

```
[MERGE] ChatGPT ← GPT
  CONFLICT  Description: keeper="OpenAI's flagship..." / merger="A large-scale..." (keeper wins)
  REPOINT   [outgoing] Related topics → AI
  REPOINT   [outgoing] Related topics → AI tools
  DELETE    GPT (bbb...bbb)

[MERGE] ChatGPT ← Generative pre-trained transformer
  CONFLICT  Description: keeper="OpenAI's flagship..." / merger="OpenAI's most popular..." (keeper wins)
  REPOINT   [outgoing] Related topics → AI models
  DELETE    Generative pre-trained transformer (ccc...ccc)

Summary:
  Pairs: 2 | Conflicts: 2 | Relations re-pointed: 3 | Mergers deleted: 2
```

### Final state

**ChatGPT** — the only surviving entity:
- Type: AI model · Developer: OpenAI · Released: 2022
- Description: "OpenAI's flagship generative AI model..." (unchanged)
- Related topics: NLP, large language models, mainstream AI products, **AI**, **AI tools**, **AI models**

**GPT** — empty shell (all data removed)
**Generative pre-trained transformer** — empty shell (all data removed)