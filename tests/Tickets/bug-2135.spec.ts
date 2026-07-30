import { test, expect, type Page } from '../utils/auth';

const PATIENT_ID = '6947';
const ASSIGN_TO = 'digambar.jalgaonkar@rheal.com';

// ── Helpers ──────────────────────────────────────────────────────────────────
async function navigateToPatientCaseManagement(page: Page, patientId: string = PATIENT_ID) {
    await page.goto(`${process.env.BASE_URL}/patient/${patientId}/case-management`);
    await page.waitForLoadState('networkidle');
}

async function navigateToActionsDashboard(page: Page) {
    await page.goto(`${process.env.BASE_URL}/`);
    await page.waitForLoadState('networkidle');
}

async function fillAssignActionTo(page: Page, panel: ReturnType<Page['locator']>, user: string) {
    const select2Trigger = panel.locator('.select2-selection, .select2-container').first();
    await select2Trigger.click();
    await page.locator('.select2-search__field').fill(user);
    await page.locator('.select2-results__option').first().click();
}

// The Email note dialog overlays the page on webkit slower than other browsers,
// so scope the Cancel click to the dialog itself and wait for it to disappear.
async function dismissEmailNoteDialog(page: Page) {
    const dialog = page.locator('.modal').filter({ hasText: 'Email note' });
    try {
        await dialog.waitFor({ state: 'visible', timeout: 6000 });
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForLoadState('networkidle');
    } catch {
        // dialog did not appear, continue
    }
}

async function applyActionsDashboardFilter(page: Page) {
    const applyBtn = page.getByRole('button', { name: 'Apply' });
    // 'Filter' button toggles the filter panel; open it if Apply is not yet visible
    if (!await applyBtn.isVisible()) {
        await page.getByRole('button', { name: 'Filter' }).click();
        await applyBtn.waitFor({ state: 'visible' });
    }
    // force:true bypasses the "covered by overlapping element" check
    // (.pull-right.buttons-heading / .action-record-count intercept pointer events)
    // while still dispatching a real mouse event that Ember's action handler catches.
    // scrollIntoViewIfNeeded is intentionally omitted — it waits for stability and
    // hangs when the filter panel is still animating open.
    await applyBtn.click({ force: true });
    await page.waitForLoadState('networkidle');
}

async function findAndExpandAction(page: Page, note: string) {
    const actionParagraph = page.locator('li p').filter({ hasText: note });
    await expect(actionParagraph).toBeVisible();
    await actionParagraph.click();
    await expect(page.locator('#modal-case-management-note')).toBeVisible();
    await expect(page.locator('#modal-case-management-note').getByText(note)).toBeVisible();
}

// ── Tests ────────────────────────────────────────────────────────────────────
test.describe('Tickets', () => {
    test.describe('BUG-2135', () => {
        test.setTimeout(90000);

        test('Add action via Patient Case Management and verify in Actions Dashboard', async ({ page }) => {
            const reason = 'Status Update';
            const note = `Case Mgmt action – ${Date.now()}`;

            // Step 1–4: Navigate to Patient/Provider > Case Management, fill and submit the form
            await navigateToPatientCaseManagement(page);
            await page.getByRole('button', { name: 'Add' }).click();
            await expect(page.getByRole('heading', { name: 'Case Management: Add' })).toBeVisible();

            const panel = page.locator('#modal-case-management-add-note-call');
            await panel.locator('select').first().selectOption(reason);

            // Due date is required for the action to appear in the Actions Dashboard
            await panel.locator('input.datepicker').first().fill('31/12/2026');

            await fillAssignActionTo(page, panel, ASSIGN_TO);

            await expect(page.locator('#draftfocus')).toBeEditable();
            await page.locator('#draftfocus').fill(note);

            const formFooter = page.getByRole('button', { name: 'Cancel' }).locator('..');
            await formFooter.getByRole('button', { name: 'Add' }).click();
            await page.waitForLoadState('networkidle');

            // Confirm the note landed in the patient's case management list before leaving
            await expect(page.locator('li', { hasText: note }).first()).toBeVisible();

            // Step 5: Navigate to Actions Dashboard and apply filter
            await navigateToActionsDashboard(page);
            await applyActionsDashboardFilter(page);

            // Step 6: Find the action and expand it to verify details
            await findAndExpandAction(page, note);
        });

        test('Add Action via Actions Dashboard and verify expansion', async ({ page }) => {
            const reason = 'General Action';
            const note = `Dashboard action – ${Date.now()}`;

            // Step 1: Navigate to Actions Dashboard
            await navigateToActionsDashboard(page);

            // Step 2: Click Add Action and fill the form
            await page.getByRole('button', { name: 'Add Action' }).click();
            await expect(page.getByRole('heading', { name: 'General Action: Add' })).toBeVisible();

            const panel = page.locator('#modal-dashboard-action-add');
            await panel.locator('select').first().selectOption(reason);
            await fillAssignActionTo(page, panel, ASSIGN_TO);
            await panel.locator('textarea').fill(note);

            // Step 3: Submit
            await page.locator('#modal-dashboard-action-add').getByRole('button', { name: 'Add' }).click();
            await page.waitForLoadState('networkidle');

            // Dismiss the Email Note dialog before interacting with the list
            await dismissEmailNoteDialog(page);

            // Step 4–5: Actions Dashboard now shows the new action — expand it
            await findAndExpandAction(page, note);
        });
    });
});
