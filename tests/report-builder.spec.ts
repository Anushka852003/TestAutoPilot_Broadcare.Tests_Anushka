import { test as base, expect, type Page } from '@playwright/test';
import { loadJsonArray, loadJsonObject } from './utils/json-loader';
import { uniqueNameToken } from './utils/common';
import { login } from './utils/auth';

type ReportBuilderCase = {
  testCaseName: string;
  patientPage: string;
  patientSection: string;
  reportAttributes: string[];
  reportName: string;
  TestResult: 'Success' | 'Failed';
  FailedValidation: string;
};

type SectionLookup = Record<string, string[]>;
type AttributeLookup = Record<string, SectionLookup>;

const testData = loadJsonArray<ReportBuilderCase>('./data/report-builder.json', __dirname);
const sectionLookup = loadJsonObject<SectionLookup>(
  './templates/Lookups/LkpSecondChoice.json',
  __dirname,
);
const attributeLookup = loadJsonObject<AttributeLookup>(
  './templates/Lookups/LkpThirdChoice.json',
  __dirname,
);
const test = base;

function getDependentOptions<T extends object>(lookup: T, parent: string, fieldName: string): string[] {
  const options = (lookup as Record<string, unknown>)[parent];
  if (!Array.isArray(options)) {
    throw new Error(`No lookup options found for ${fieldName} parent "${parent}"`);
  }
  return options as string[];
}

async function selectProvidedOption(page: Page, sectionHeading: string, option: string): Promise<void> {
  const field = page.getByLabel(sectionHeading, { exact: true }).first();
  if (await field.count()) {
    await expect(field).toBeVisible({ timeout: 30_000 });
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase());
    if (tagName === 'select') {
      await field.selectOption({ label: option });
      return;
    }
    await field.click();
  } else {
    const section = page
      .getByRole('heading', { name: sectionHeading, exact: true })
      .locator('xpath=ancestor::*[self::div or self::section][1]');
    await expect(section).toBeVisible({ timeout: 30_000 });
    const providedOption = section.getByText(option, { exact: true }).first();
    await expect(providedOption).toBeVisible({ timeout: 30_000 });
    await providedOption.click();
    return;
  }

  await page.getByRole('option', { name: option, exact: true }).click();
}

async function selectAllThirdChoiceOptions(page: Page, sectionHeading: string, options: string[]): Promise<void> {
  const field = page.getByLabel('Third choice', { exact: true }).first();
  if (await field.count()) {
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase());
    if (tagName === 'select') {
      await field.selectOption(options.map((option) => ({ label: option })));
      return;
    }
  }

  const thirdChoiceSection = page
    .getByRole('heading', { name: sectionHeading, exact: true })
    .locator('xpath=ancestor::*[self::div or self::section][1]');
  await expect(thirdChoiceSection).toBeVisible({ timeout: 30_000 });

  for (const option of options) {
    const checkbox = thirdChoiceSection.getByRole('checkbox', { name: option, exact: true }).first();
    if (await checkbox.count()) {
      await checkbox.check();
      continue;
    }
    const thirdChoice = thirdChoiceSection.getByText(option, { exact: true }).first();
    await expect(thirdChoice).toBeVisible({ timeout: 30_000 });
    await thirdChoice.click();
  }
}

test.describe('Report Builder', () => {
  for (const [index, entry] of testData.entries()) {
    test(`${index + 1}. Run report builder`, async ({ page }) => {
      test.setTimeout(300_000);
      const baseUrl = process.env.BASE_URL;
      const email = process.env.EMAIL;
      const password = process.env.PASSWORD;
      if (!baseUrl || !email || !password) {
        throw new Error('BASE_URL, EMAIL, and PASSWORD are required');
      }

      await login(page, baseUrl, email, password);
      await page.goto(`${baseUrl}/reports`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/\/login(?:$|\?)/, { timeout: 30_000 });
      await page.getByRole('link', { name: 'Report Builder', exact: true }).click();
      await expect(page).toHaveURL(/\/reports\/generator$/);

      const availableSections = getDependentOptions(sectionLookup, entry.patientPage, 'patientSection');
      expect(availableSections).toContain(entry.patientSection);
      const pageAttributes = attributeLookup[entry.patientPage];
      if (!pageAttributes) {
        throw new Error(`No attribute lookup found for patient page "${entry.patientPage}"`);
      }
      const availableAttributes = getDependentOptions(
        pageAttributes,
        entry.patientSection,
        'reportAttributes',
      );
      expect(entry.reportAttributes.every((attribute) => availableAttributes.includes(attribute))).toBe(true);

      await selectProvidedOption(page, 'Patients', entry.patientPage);
      await selectProvidedOption(page, entry.patientPage, entry.patientSection);
      await selectAllThirdChoiceOptions(page, entry.patientSection, entry.reportAttributes);

      await page.getByRole('button', { name: 'Run', exact: true }).click();

      const reportModal = page.locator('#modal-custom-report-name');
      await expect(reportModal).toBeVisible({ timeout: 30_000 });
      const reportName = entry.reportName.replace(/\{\{run\}\}/g, uniqueNameToken());
      const reportNameField = reportModal.locator('input[type="text"]').first();
      await expect(reportNameField).toBeVisible({ timeout: 30_000 });
      await reportNameField.fill(reportName);
      await reportModal.getByRole('button', { name: 'Run', exact: true }).click();

      if (entry.TestResult === 'Success') {
        await expect(
          page.getByText('Your report will be built and emailed shortly.', { exact: true }),
        ).toBeVisible({ timeout: 180_000 });
      } else if (entry.FailedValidation) {
        await expect(page.getByText(entry.FailedValidation, { exact: false })).toBeVisible();
      }
    });
  }
});