import { test, expect, type Page } from './utils/auth';

const SEARCH_URL = `${process.env.BASE_URL}/search/patients`;

// Helpers pointing to the three search controls
const searchBy    = (page: Page) => page.getByRole('combobox').first();
const searchInput = (page: Page) => page.getByRole('textbox');
// The ▶ button shares a parent div with the textbox — go up one level, then find the button
const searchBtn   = (page: Page) => page.getByRole('textbox').locator('xpath=..//button');
// Patient rows are links with href="#" inside the results section.
// Scoped to avoid matching hidden nav menu items that share the same href.
const resultRows  = (page: Page) =>
  page.getByRole('heading', { name: 'Patients' }).locator('..').locator('a[href="#"]');

async function runSearch(page: Page, term: string) {
  await searchBy(page).selectOption('Patient Search');
  await searchInput(page).fill(term);
  await searchBtn(page).click();
  await page.waitForLoadState('networkidle');
}

test.describe('Tickets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SEARCH_URL);
    await page.waitForLoadState('networkidle');
  });

  test('CB-1234', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Patient Search' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'All' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Current' })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();

    // Column headers are rendered as generic divs; scope to the results section to avoid
    // matching hidden sidebar elements. 'ID' is skipped — too short to scope safely.
    const resultsSection = page.getByRole('heading', { name: 'Patients' }).locator('..');
    for (const col of ['Surname', 'Forename', 'Local Stage', 'DOB', 'Date Closed', 'Date Deceased', 'NHS No.', 'Record Owner']) {
      await expect(resultsSection.getByText(col, { exact: true })).toBeVisible();
    }
  });
});
