import { test, expect, type Page } from './utils/auth';
import { loadJsonArray } from './utils/json-loader';
import { uniqueNameToken } from './utils/common';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const testData: Array<{
  patientId: string;
  patientName: string;
  reason: string;
  assignActionTo: string;
  actionDueDate: string;
  note: string;
  TestResult: 'Success' | 'Failed';
  FailedValidation: string;
}> = loadJsonArray('./data/patient-case-management-create-note.json', __dirname);

/** Unique per test run so notes never collide with ones left behind by a previous run. */
const RUN_ID = uniqueNameToken();

// ── Locators (verified against live DOM) ────────────────────────────────────
const searchInput = (page: Page) => page.locator('#search-field');
const searchBtn = (page: Page) => page.locator('#go-button');
const resultRows = (page: Page) =>
  page.getByRole('heading', { name: 'Patients' }).locator('..').locator('a[href="#"]');

// ── Helpers ──────────────────────────────────────────────────────────────────
async function searchForPatient(page: Page, id: string) {
  await searchInput(page).fill(id);
  await searchBtn(page).click();
  await page.waitForLoadState('networkidle');
}

async function navigateToPatientCaseManagement(page: Page, patientId: string) {
  await page.goto(`${process.env.BASE_URL}/patient/${patientId}/case-management`);
  await page.waitForLoadState('networkidle');
}

// ── Data-driven add-note tests (one test per entry in patient-add-note.json) ──
test.describe('Patient', () => {
  test.describe('Case Management', () => {
    test.describe('Note / Call', () => {
      test.describe('Create & Delete', () => {
        for (const [index, entry] of testData.entries()) {
          test(`Add Note ${index + 1}`, async ({ page }) => {
            await navigateToPatientCaseManagement(page, entry.patientId);

            await page.getByRole('button', { name: 'Add' }).click();
            await expect(page.getByRole('heading', { name: 'Case Management: Add' })).toBeVisible();

            const panel = page.locator('#modal-case-management-add-note-call');

            // Reason
            if (entry.reason) {
              await panel.locator('select').first().selectOption(entry.reason);
            }

            // Action Due Date
            if (entry.actionDueDate) {
              await panel.locator('input.datepicker').first().fill(entry.actionDueDate);
            }

            // Assign Action To — Select2 search widget; skip when empty
            if (entry.assignActionTo) {
              const select2Trigger = panel.locator('.select2-selection, .select2-container').first();
              await select2Trigger.click();
              await page.locator('.select2-search__field').fill(entry.assignActionTo);
              await page.locator('.select2-results__option').first().click();
            }

            // Note — {{run}} is replaced with a token unique to this test run
            let note = '';
            if (entry.note) {
              note = entry.note.replace(/\{\{run\}\}/g, RUN_ID);
              await expect(page.locator('#draftfocus')).toBeEditable();
              await page.locator('#draftfocus').fill(note);
            }

            const formFooter = page.getByRole('button', { name: 'Cancel' }).locator('..');

            if (entry.TestResult === 'Success') {
              // ── Happy path: submit and verify entry appears in the list ──────────
              await formFooter.getByRole('button', { name: 'Add' }).click();
              await page.waitForLoadState('networkidle');

              // A note with an "Assign Action To" user triggers an "Email note" prompt
              // before the list re-renders; skip sending and move on. Both this prompt
              // and the delete confirmation below reuse the same #modal-confirm dialog
              // (only the heading/body text differs), so every button click here is
              // scoped to #modal-confirm and guarded by its heading text.
              const emailPrompt = page.getByRole('heading', { name: 'Email note' });
              const showedEmailPrompt = await emailPrompt
                .waitFor({ state: 'visible', timeout: 5000 })
                .then(() => true)
                .catch(() => false);
              if (showedEmailPrompt) {
                await page.locator('#modal-confirm').getByRole('button', { name: 'Cancel' }).click();
              }

              await expect(page.locator('li', { hasText: note }).first()).toBeVisible();

              // ── Clean up: delete the note we just added ──────────────────────────
              // The card has two icon-only buttons (delete, pin); delete is the
              // "btn-danger" one, so target it by class rather than accessible name.
              const noteCard = page.locator('.case-management-note').filter({ hasText: note });
              await noteCard.locator('button.btn-danger.case-management-delete').click();
              await expect(page.getByRole('heading', { name: 'Delete' })).toBeVisible();
              await page.locator('#modal-confirm').getByRole('button', { name: 'Continue' }).click();
              await page.waitForLoadState('networkidle');
              await expect(noteCard).toHaveCount(0);

            } else {
              // ── Failure path: form should stay open and NOT submit ────────────────

              // If a specific validation message is expected, assert it is visible
              if (entry.FailedValidation) {
                if (entry.FailedValidation.toLowerCase().includes('note')) {
                  await formFooter.getByRole('button', { name: 'Add' }).click();
                  await page.waitForLoadState('networkidle');

                  const noteSection = page.locator('.input-group', {
                    has: page.locator('#draftfocus')
                  });
                  await noteSection.locator('#draftfocus').click(); // Trigger validation message

                  await expect(noteSection.locator('.validation-message')).toContainText(new RegExp(entry.FailedValidation, 'i'));

                  return; // Validation message found, no need to check further
                }
              }

              // Submit button should be disabled ("Form Invalid"), not the active "Add"
              // await expect(formFooter.getByRole('button', { name: 'Add' })).not.toBeVisible();
              await expect(formFooter.locator('button', { hasText: 'Form Invalid' })).toBeVisible();

              // Modal is still open — form was not submitted
              await expect(page.getByRole('heading', { name: 'Case Management: Add' })).toBeVisible();
            }
          });
        }

      });
    });
  });
});