import { test, expect, type Page } from './utils/auth';
import { loadJsonArray } from './utils/json-loader';

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
}> = loadJsonArray('./data/patient-add-note.json', __dirname);

const PATIENT_ID = '6947';

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

async function navigateToPatientCaseManagement(page: Page, patientId: string = PATIENT_ID) {
  await page.goto(`${process.env.BASE_URL}/patient/${patientId}/case-management`);
  await page.waitForLoadState('networkidle');
}

// ── Data-driven add-note tests (one test per entry in patient-add-note.json) ──
test.describe('Case Management', () => {
  test.describe('Add Notes', () => {

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

        // Note — append timestamp for uniqueness across re-runs
        let note = '';
        if (entry.note) {
          note = `${entry.note} – ${Date.now()}`;
          await expect(page.locator('#draftfocus')).toBeEditable();
          await page.locator('#draftfocus').fill(note);
        }

        const formFooter = page.getByRole('button', { name: 'Cancel' }).locator('..');

        if (entry.TestResult === 'Success') {
          // ── Happy path: submit and verify entry appears in the list ──────────
          await formFooter.getByRole('button', { name: 'Add' }).click();
          await page.waitForLoadState('networkidle');
          await expect(page.locator('li', { hasText: note }).first()).toBeVisible();

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
