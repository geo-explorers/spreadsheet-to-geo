# Spreadsheet-to-Geo: Bug Review

---


## Bug 1 — Script blocked on valid spreadsheets (FIXED)

**What was happening:** The validator rejected entities whose type came from the tab name.

Example: A "Skill" tab existed in the spreadsheet. Each row in that tab has type "Skill" (per IDEA.md: tab name = default type). But the validator only checked the Types tab for known types — so it threw an error: `Entity "Leadership" references unknown type "Skill"`. The script would not run at all.

**Fix applied:** The validator now also accepts entity tab names as valid types, exactly as IDEA.md describes.

---


## Bug 2 — Undeclared columns silently dropped (FIXED)

**What was happening:** Some entity tabs had columns not listed in the Properties tab (12 columns total across Industry, Product, Topic, Role, and Skill tabs). These columns were silently dropped during publishing — the curator's data was lost with no clear feedback.

**Fix applied (two parts):**

1. **Validator fix:** The script now catches undeclared columns at step 3 (early), before any API calls, and blocks publishing with a clear error message listing exactly which columns are missing and which tab they're in.

2. **Template fix:** All 13 missing columns have been added to the Properties tab in the template with correct data types and `Points to type(s)` values (verified against the Geo API). The Skill type was also added to the Types tab.

**Decision:** Undeclared columns are an **error** that blocks publishing. This forces the template to be complete before data goes to Geo — the engineer must add missing columns to the Properties tab or remove them from entity tabs. This protects curators from silent data loss.

---


## Bug 3 — Relation target warnings were vague and repetitive (FIXED)

**What was happening:** When a relation target wasn't found in the spreadsheet (e.g., "Chicago, Illinois, United States" referenced via "Place of birth"), the warning said:
```
Entity "Sam Altman" references "Chicago, Illinois, United States" via Place of birth - ensure this entity exists in Geo or add it to a tab
```
And for entities referenced by multiple people (like "United States"), the same warning fired once per person — 4 times for "United States".

**Fix applied:**
- Warning now shows the expected type from the Properties tab: `"Chicago, Illinois, United States" (expects: City, Country, Place) not found in spreadsheet — ensure it exists in Geo or add it to an entity tab`
- Each unique target now warns only once per column, not once per entity that references it

---


## Bug 4 — Pre-publish summary showed wrong entity counts (FIXED)

**What was happening:** The pre-publish summary said "Entities to Create: 13" but only 8 entities were actually created. The other 5 (cities and "Safe Superintelligence Inc.") were listed as "will be created" but then silently skipped during the operations step because they had no type assigned.

This meant the engineer would tell the team "13 new entities will be created" and then only 8 would appear in Geo.

**Fix applied:** The summary now shows accurate counts from the actual operations batch (8 entities created). The 5 skipped entities are shown separately in a "Entities Skipped — no types" section with a clear explanation.

---



## Bug 6 — Description column required exact capitalisation (FIXED)

**What was happening:** The script only read the description column if the curator named it exactly `Description` (capital D). If the curator wrote `description` (lowercase), the field was silently ignored and entities were published without descriptions.

**Fix applied:** The script now looks for the description column case-insensitively — `description`, `Description`, and `DESCRIPTION` all work correctly.

---


## Bug 7 — TIME and DATETIME values were stripped to date-only (FIXED)

**What was happening:** Property columns with data type TIME or DATETIME were being processed by the same function as DATE columns. This function always returns a `YYYY-MM-DD` string, so:
- A TIME value like `14:30:00` was silently dropped (the function couldn't parse it)
- A DATETIME value like `2024-01-15 14:30:00` was trimmed to `2024-01-15`, losing the time

The Geo SDK expects:
- TIME → `HH:MM:SSZ`
- DATETIME → `YYYY-MM-DDTHH:MM:SSZ`

**Fix applied:** TIME and DATETIME now use their own dedicated parsing functions that return the correct formats. DATE is unchanged.

---


## Bug 8 — Linked entity count was understated in batch summary (FIXED)

**What was happening:** The batch summary (shown before publishing) correctly counted entities that had their own row in the spreadsheet. But entities that existed only as relation targets (e.g., "United States" referenced in "Country of origin") and were found in Geo via API were not counted in the "Will Link" total.

The pre-publish summary and the batch summary showed different numbers — confusing, and the batch summary was always lower than reality.

**Fix applied:** The batch summary now also counts relation-target entities that are linked to existing Geo entries.

---


## Bug 9 — Boolean values "y" and "n" silently dropped (FIXED)

**What was happening:** A curator can enter boolean values in many natural ways. The script accepted `true`, `yes`, `1`, `false`, `no`, `0` — but not `y` or `n`, even though these are common shorthand.

If a curator typed `y` in a BOOLEAN column, the script silently dropped that value. The entity was published without that property.

**Fix applied:** Added `y` and `n` to the accepted boolean values.

---


## Bug 10 — Location names with commas (NOT A BUG)

**What was investigated:** Whether the location type check was case-sensitive, which would incorrectly split `"Chicago, Illinois, United States"` into three targets.

**Finding:** The code already lowercases the `pointsToTypes` field before comparing, so `"City"`, `"CITY"`, and `"city"` all match correctly. No fix needed.

---


## Summary Table

| Bug | Severity | Status |
|-----|----------|--------|
| Tab names not accepted as valid types | Blocked all valid runs | Fixed |
| Undeclared columns silently dropped | Data loss, late warning | Fixed — error + template updated |
| Vague/repetitive relation target warnings | Poor feedback | Fixed |
| Pre-publish summary showed wrong counts | Misleading for engineer | Fixed |
| 400 Bad Request spam on dry run | Log noise | Fixed |
| Description column case-sensitive | Silent data loss | Fixed |
| TIME/DATETIME stripped to date-only | Data loss | Fixed |
| Linked entity count understated | Cosmetic mismatch | Fixed |
| Boolean "y"/"n" silently dropped | Silent data loss | Fixed |
| Location names with commas | Investigated — not a bug | N/A |
