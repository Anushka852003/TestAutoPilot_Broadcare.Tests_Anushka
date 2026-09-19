# CLAUDE.md

Playwright end-to-end tests for the **BroadCare** web app.

## Commands

- `npm test` — run the full suite across all 5 browser projects (chromium, firefox, webkit,
  chrome, msedge)
- `npx playwright test --project=chromium` — run against one browser only
- `npx playwright test tests/patient-case-management-note.spec.ts` — run one spec
- `npx playwright test tests/broadcare-authentication.spec.ts` — run authentication cases
- `npx playwright test tests/create-new-user.spec.ts` — run create-user cases
- `npx playwright test -g "Add Note 1"` — run tests matching a title
- `npx playwright show-report` — open the last HTML report

## Environment

Tests read config from a `.env` file (loaded via `dotenv`): `BASE_URL`, `EMAIL`,
`PASSWORD`. Login happens once per run and the session is shared across all workers via
`storageState` (see [tests/utils/auth.ts](tests/utils/auth.ts) — import `test`/`expect`
from there, not directly from `@playwright/test`).

The authentication spec intentionally imports directly from `@playwright/test` so each
case starts unauthenticated. Credentials in `tests/data/broadcare-authentication.json`
use `{{env.EMAIL}}` and `{{env.PASSWORD}}` placeholders; secrets are never stored in test data.
The reset-password spec uses `OUTLOOK_URL`, `OUTLOOK_EMAIL`, and `OUTLOOK_PASSWORD` from
`.env` to read the Auth0 email in the same Playwright page. `OUTLOOK_STORAGE_STATE` is optional
and is refreshed after successful Outlook authentication when provided. The spec selects
"Use another account" when shown, enters the Outlook credentials, and supports interactive MFA.
It then opens the reset link in the same page, fills both password fields from the test data,
updates `PASSWORD` in `.env` after a successful reset, and verifies that the user can log in
again with `EMAIL` and the updated password.

## AutoTestPilot templates & data

Tests are data-driven from JSON. When asked to "create a template" or "generate test data",
follow [creating-templates-and-data.md](creating-templates-and-data.md) exactly. In short,
for a feature `<slug>` (kebab-case):

- `tests/templates/<slug>.json` — field definitions (`templateName`, `jsonFileName`, `Fields`)
- `tests/data/<slug>.json` — array of records; `id` from 1, plus auto keys `testCaseName`,
  `TestResult` (`Success`/`Failed`), `FailedValidation`
- `tests/templates/Lookups/Lkp<Thing>.json` — shared dropdown option lists (string arrays),
  referenced via `"optionsSource": "Lookups/Lkp<Thing>.json"` (forward slashes)

Use the `{{run}}` placeholder in free-text values that must be unique per run; the spec
substitutes it.

## Conventions

- Spec structure: nested `test.describe` blocks; one `test()` per data record, looped with
  `for (const [index, entry] of testData.entries())`
- Locators are verified against the live DOM and commented as such
- Utilities live in [tests/utils/](tests/utils/): `json-loader.ts`, `auth.ts`, `common.ts`
