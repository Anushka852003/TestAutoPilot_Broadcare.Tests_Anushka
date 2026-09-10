# AI Guide: Authoring AutoTestPilot Templates and Data Files

**Audience: an AI assistant working inside a Playwright test repository.**
Drop this file into the test repo (e.g. at the repo root or `tests/AI_GUIDE.md`). When a
user asks you to "create a template" or "generate test data" for AutoTestPilot, follow
this document exactly. You do **not** need the AutoTestPilot GUI — you write two JSON files
directly and the app loads them.

---

## 1. What you produce

For one logical form/feature with identifier `<slug>` (kebab-case, no spaces, no path
separators, no `..`), you create up to two files:

| File | Required | Purpose |
|---|---|---|
| `tests/templates/<slug>.json` | yes | The **template** — defines the fields of a data record. |
| `tests/data/<slug>.json` | yes | The **data file** — a JSON array of records shaped by that template. |
| `tests/templates/Lookups/<name>.json` | only if used | A shared dropdown option list: a JSON array of strings. |
| `tests/data/<slug>/<recordId>/<file>` | only if a record has file fields | Uploaded files, referenced by relative path from records. |

`<slug>` is the same string in both filenames and is stored inside the template as
`jsonFileName`. A Playwright spec becomes "data-driven" for this template when its source
references the string `data/<slug>.json`.

**Rules for `<slug>`:** non-empty, no `/`, no `\`, no `..`. Use lowercase kebab-case, e.g.
`patient-add-note`, `admin-create-person`.

---

## 2. Template file format (`tests/templates/<slug>.json`)

### 2.1 Top level

```json
{
  "templateName": "Patient - Add Note",
  "jsonFileName": "patient-add-note",
  "Fields": [ /* field objects and/or section objects, in display order */ ]
}
```

| Key | Type | Notes |
|---|---|---|
| `templateName` | string | Human-readable, shown in pickers. |
| `jsonFileName` | string | Equals `<slug>`. No `.json`. Must be unique. |
| `Fields` | array | Ordered field objects and/or section objects. This is the order they render in. Always use `Fields` (a legacy top-level `sections` array is also accepted on load but do not produce it). |

### 2.2 Reserved keys — never define fields for these

The app **automatically** adds these to every record; do not put them in `Fields`:

- `id` — auto-assigned integer.
- `testCaseName` — an automatic "Test Case Name" text field is prepended. Only define your
  own field named `testCaseName` if you deliberately want to control its placement.
- `TestResult` — auto "Expected Test Result" dropdown (`Success` / `Failed`), always
  required.
- `FailedValidation` — auto textarea, only used when `TestResult` is `Failed`. To make it
  a dropdown of canned reasons instead of a textarea, add one field to `Fields` whose
  `name` is exactly `FailedValidation` (case-insensitive) with your chosen `type` /
  `options`; the app renders it in its fixed slot, not inline.

### 2.3 Field object — common properties

| Property | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | **Required.** camelCase. The key the value is saved under. Unique within its container (top level, or one section). |
| `label` | string | — | **Required.** Display label. |
| `type` | string | `"text"` | See 2.4. |
| `required` | boolean | `false` | Red `*`, blocks save when empty. Ignored for a plain checkbox (both true/false are complete). |
| `showInTable` | boolean | `true` when the key is omitted | Set `false` to keep the field out of the Data Manager table. Omit for "shown". |
| `fullWidth` | boolean | `false` | Force onto its own row. `textarea`, `richtext`, `file`, `group`, and a `checkbox` with `options` are always effectively full width. |

### 2.4 Field types and the value each stores in a record

| `type` | Extra template props | Record value |
|---|---|---|
| `text` | — | string |
| `textarea` | — | string |
| `date` | — | `"YYYY-MM-DD"` |
| `time` | — | `"HH:MM"` (24h) |
| `richtext` | — | HTML string, e.g. `"<p>Hello <b>world</b></p>"` |
| `dropdown` | `options` and/or `optionsSource`; optional `subFields` | string (one option, or `""`) |
| `radio` | `options` and/or `optionsSource` | string (one option, or `""`) |
| `checkbox` (no `options`) | — | boolean |
| `checkbox` (with `options`) | `options` and/or `optionsSource` | array of checked option strings |
| `file` | `multiple` (bool), `filters` | single: relative path string; multiple: array of relative path strings |
| `group` | `fields` (array of sub-field defs) | array of objects, one per entry |
| `break` | — (no `label`/flags needed; `name` any unique placeholder) | not stored — layout only |

**`options`** — inline array of strings: `"options": ["Clinical", "Billing"]`.

**`optionsSource`** — reference a lookup file instead:
`"optionsSource": "Lookups/LkpReasonForNote.json"` (forward slashes, matching this repo's
convention; `"LookUps\\file.json"` with double-backslash and a bare `"file.json"` also
resolve to the lookup folder). If both `options` and `optionsSource` are present,
`optionsSource` wins at load. Applies to `dropdown`, `radio`, and `checkbox` (and to
`group` sub-fields of those types).

**`filters`** (for `file`): `[{ "name": "PDF Files", "extensions": ["pdf"] }]`. Omit for
all files.

**`subFields`** (for `dropdown` only) — reveal extra inputs when a specific option is
selected:

```json
{
  "name": "personType", "label": "Person Type", "type": "dropdown",
  "options": ["Employee", "Contractor"],
  "subFields": [
    { "name": "agency", "label": "Agency", "type": "text", "compareValue": "Contractor" }
  ]
}
```
Each sub-field: `{ name, label, type, compareValue, ...type-specific }`, where `type` is
one of `text`, `textarea`, `date`, `time`, `dropdown`, `file`. Constraints:
- A sub-field's `optionsSource` is **not** resolved — a `dropdown` sub-field must use
  inline `options`.
- Sub-field values are stored at the record's **top level**, never nested under a section.
  Do not place a dropdown-with-subFields inside a section if you need those values.

**`group`** — repeatable set of fields:

```json
{
  "name": "addresses", "label": "Addresses", "type": "group",
  "fields": [
    { "name": "line1", "label": "Line 1", "type": "text" },
    { "name": "city",  "label": "City",   "type": "text" },
    { "name": "state", "label": "State",  "type": "dropdown", "optionsSource": "Lookups/lkpState.json" }
  ]
}
```
Group sub-field entries are `{ name, label, type, options?, optionsSource? }` only — no
`required` / `showInTable` / `fullWidth`. Allowed sub-field types: `text`, `textarea`,
`date`, `time`, `dropdown`, `radio`, `checkbox`. **Not allowed in a group:** `file`,
`richtext`, nested `group`, `break`.

### 2.5 Section object

A section groups fields under a heading and **nests their values** in the record.

```json
{
  "sectionTitle": "User Details",
  "sectionId": "userDetails",
  "fullWidth": true,
  "fields": [ /* field objects and/or nested section objects */ ]
}
```

| Property | Type | Notes |
|---|---|---|
| `sectionTitle` | string | **Required.** Heading. |
| `sectionId` | string | **Required.** camelCase. Values of fields in this section are saved as `record.<sectionId>.<fieldName>`. |
| `fields` | array | **Required** (may be empty). Fields and/or further sections. |
| `fullWidth` | boolean | Layout hint; effect varies by depth (see 2.6). |
| `conditionField` | string | Optional. `name` of a `dropdown`-type field **anywhere** in the template (not inside a group). |
| `conditionValue` | string | Optional, paired with `conditionField`. Section is hidden until that field equals this value. Hidden sections are skipped for required-validation and keep prior values. |

### 2.6 Section nesting depth (affects layout only, not the JSON value path)

- **Depth 0** (section directly in top-level `Fields`): plain heading; `fullWidth` has no
  visual effect.
- **Depth 1** (section inside a section): a bordered card; siblings tile side by side.
  `fullWidth: true` makes the card span the row alone.
- **Depth 2+**: an inline header divider inside the depth-1 card; `fullWidth` has no
  effect.

Value nesting still follows every `sectionId` in the chain regardless of depth:
`record.<outerId>.<innerId>.<fieldName>`.

### 2.7 Lookup files

`tests/templates/Lookups/<name>.json` — a flat JSON array of strings (this repo names its
lookup files `Lkp<Thing>.json`, e.g. `LkpReasonForNote.json`):

```json
["Female", "Male", "Non-binary", "Prefer not to say"]
```

Create one whenever the same option list is reused, or the list is long. Reference it from
fields via `optionsSource`.

---

## 3. Data file format (`tests/data/<slug>.json`)

A JSON array of **record objects**. Each record's shape is fully determined by the
template. Produce records with keys in this order:

1. `id` — integer, starts at `1`, strictly increasing, unique, never reused. Do not skip
   numbers.
2. `testCaseName` — string. A short description of the scenario (unless the template
   defines its own `testCaseName` field, in which case follow the template).
3. One key per template field, in template order:
   - Top-level field → key is the field `name`.
   - Field inside section(s) → nested object(s) keyed by each `sectionId`.
   - Dropdown `subFields` → keys at the **top level** of the record (not nested), present
     only when the parent dropdown equals the sub-field's `compareValue` (otherwise omit
     or use `""`).
   - `break` fields → produce nothing.
   - Value type must match the field type per the table in 2.4.
4. `TestResult` — `"Success"` or `"Failed"`.
5. `FailedValidation` — a non-empty message string **only** when `TestResult` is
   `"Failed"`; otherwise `""`.

### 3.1 Value rules

| Field type | Example record value |
|---|---|
| `text` / `textarea` | `"Ada Lovelace"` |
| `date` | `"2026-03-14"` |
| `time` | `"09:30"` |
| `richtext` | `"<p>Return in <b>2 weeks</b>.</p>"` |
| `dropdown` / `radio` | `"Clinical"` — must be exactly one of the field's options/lookup values, or `""` |
| `checkbox` no options | `true` / `false` |
| `checkbox` with options | `["VIP", "Billable"]` — subset of the field's options |
| `file` single | `"data/<slug>/<id>/report.pdf"` |
| `file` multiple | `["data/<slug>/<id>/a.pdf", "data/<slug>/<id>/b.pdf"]` |
| `group` | `[ { "line1": "12 Baker St", "city": "London" } ]` — objects keyed by the group's sub-field names |

### 3.2 File-field values

If a record uses a `file` field, also create the referenced file(s) under
`tests/data/<slug>/<id>/` and reference them by the **repo-relative** path
`data/<slug>/<id>/<filename>` (forward slashes, no leading slash, never an absolute path).
If you cannot supply a real file, leave the value `""` (single) or `[]` (multiple).

### 3.3 Coverage guidance

Unless the user says otherwise, generate at least:
- One `TestResult: "Success"` record exercising a normal happy path (all required fields
  filled with valid values).
- One `TestResult: "Failed"` record per meaningful negative scenario, each with a clear
  `FailedValidation` message describing the expected failure.
- Records that exercise each conditional section / dropdown sub-field branch (set the
  controlling field so the branch is active, and fill its fields).

Keep values realistic and internally consistent (e.g. a `state` matching a `city`).

### 3.4 Run-unique tokens in string values

Specs in this repo replace the literal placeholder `{{run}}` in a string value with a
token unique to each test run (see `tests/utils/common.ts` → `uniqueNameToken`, wired up in
the spec). Use `{{run}}` inside any free-text value that must not collide with data left
behind by a previous run — typically a `text`/`textarea` field that the test later searches
for or deletes, e.g. `"note": "Post-op review {{run}}"`. The spec is responsible for doing
the substitution; the data file just carries the placeholder.

---

## 4. Procedure

1. **Clarify the form.** From the user's description, the target app's UI, or an existing
   spec, list every input: label, type, whether required, and valid values.
2. **Choose `<slug>`** (kebab-case). Check `tests/templates/` and `tests/data/` for an
   existing file — extend it rather than duplicating.
3. **Create any lookup files** in `tests/templates/Lookups/` for reused/long option lists.
4. **Write `tests/templates/<slug>.json`.** Order fields to match the real form. Group
   related fields into sections (with `sectionId`) when the app nests them. Mark required
   fields. Set `showInTable: false` on noisy/long fields.
5. **Write `tests/data/<slug>.json`** as an array of records following §3, starting with
   `id: 1`.
6. **Create referenced files** under `tests/data/<slug>/<id>/` if any record has file
   fields.
7. **Validate** against the checklist below.
8. **Tell the user** which files you created/changed and summarise the records (id, name,
   TestResult).

---

## 5. Validation checklist

Template:
- [ ] Valid JSON; top level has `templateName`, `jsonFileName`, `Fields`.
- [ ] `jsonFileName` === `<slug>` === both filenames; no `/`, `\`, or `..`.
- [ ] Every field has non-empty `name` (camelCase) and `label`; `name` unique per container.
- [ ] No field named `id`, `TestResult`; `testCaseName`/`FailedValidation` only if intentional.
- [ ] Every `type` is from §2.4; type-specific props are valid.
- [ ] Every `optionsSource` file exists in `tests/templates/Lookups/` and is a string array.
- [ ] Every section has `sectionTitle` and `sectionId`; `conditionField` names a real `dropdown` field.
- [ ] No `file` / `richtext` / `group` / `break` inside a `group`.

Data:
- [ ] Valid JSON array.
- [ ] `id` integers from 1, increasing, unique.
- [ ] Each record has `testCaseName`, `TestResult` (`Success`|`Failed`), `FailedValidation` (`""` unless Failed).
- [ ] Every non-break template field has a value of the correct type; section fields nested under `sectionId`.
- [ ] Dropdown/radio values are exactly an allowed option (or `""`); checkbox-group values are a subset of options.
- [ ] File values are `data/<slug>/<id>/...` relative paths, and those files exist (or value is `""` / `[]`).
- [ ] Required fields are non-empty in every record where their section is visible.
- [ ] Conditional branches are covered by at least one record each.

---

## 6. Worked example

**Request:** "Template + data for adding a patient note. Fields: note title, category
(Clinical / Administrative / Billing), rich-text body, and a follow-up date that only
applies when category is Clinical."

`tests/templates/Lookups/LkpNoteCategory.json`
```json
["Administrative", "Billing", "Clinical"]
```

`tests/templates/patient-add-note.json`
```json
{
  "templateName": "Patient - Add Note",
  "jsonFileName": "patient-add-note",
  "Fields": [
    { "name": "noteTitle", "label": "Note Title", "type": "text", "required": true },
    { "name": "category", "label": "Category", "type": "dropdown", "required": true, "optionsSource": "Lookups/LkpNoteCategory.json" },
    { "name": "noteBody", "label": "Note Body", "type": "richtext", "required": true },
    {
      "sectionTitle": "Clinical Details",
      "sectionId": "clinicalDetails",
      "fullWidth": true,
      "conditionField": "category",
      "conditionValue": "Clinical",
      "fields": [
        { "name": "followUpDate", "label": "Follow-up Date", "type": "date", "required": true }
      ]
    }
  ]
}
```

`tests/data/patient-add-note.json`
```json
[
  {
    "id": 1,
    "testCaseName": "Add a clinical note with follow-up",
    "noteTitle": "Post-op review",
    "category": "Clinical",
    "noteBody": "<p>Wound healing well. Review in <b>2 weeks</b>.</p>",
    "clinicalDetails": { "followUpDate": "2026-03-28" },
    "TestResult": "Success",
    "FailedValidation": ""
  },
  {
    "id": 2,
    "testCaseName": "Add a billing note",
    "noteTitle": "Invoice query",
    "category": "Billing",
    "noteBody": "<p>Patient disputes co-pay amount.</p>",
    "TestResult": "Success",
    "FailedValidation": ""
  },
  {
    "id": 3,
    "testCaseName": "Reject note with empty title",
    "noteTitle": "",
    "category": "Administrative",
    "noteBody": "<p>Address change requested.</p>",
    "TestResult": "Failed",
    "FailedValidation": "Note Title is required — save should be blocked and an inline error shown."
  }
]
```

Record 1 exercises the `Clinical` branch (so `clinicalDetails.followUpDate` is present);
records 2 and 3 use categories where that section is hidden, so it is omitted.
