import { test, expect, type Page } from '@playwright/test';
import { loadJsonArray } from './utils/json-loader';

type AuthenticationCase = {
  email: string;
  password: string;
  TestResult: 'Success' | 'Failed';
  FailedValidation: string;
  testCaseName: string;
  scenario: string;
  enabled?: boolean;
};

const testData = loadJsonArray<AuthenticationCase>(
  './data/broadcare-authentication.json',
  __dirname
);

function resolveEnvironmentValue(value: string): string {
  return value.replace(/\{\{env\.([A-Z0-9_]+)\}\}/g, (_, name: string) => {
    const resolved = process.env[name];
    if (resolved === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return resolved;
  });
}

async function openAuth0Login(page: Page, baseUrl: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${baseUrl}/login`);
    await expect(page.getByRole('button', { name: 'Go to BroadCare login' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to BroadCare login' }).click();

    try {
      await page.waitForURL(/https:\/\/chs-dev\.uk\.auth0\.com\/u\/login\?state=.+/, {
        timeout: 30_000,
      });
      return;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
    }
  }
}

function shouldFillEmail(scenario: string): boolean {
  return scenario !== 'Blank email';
}

function shouldFillPassword(scenario: string): boolean {
  return scenario !== 'Blank password';
}

function normalizeValidationText(value: string): string {
  return value.trim().replace(/[.!?]+$/, '');
}

test.describe('BroadCare authentication', () => {
  for (const [index, entry] of testData.entries()) {
    test(`${index + 1}. ${entry.testCaseName}`, async ({ page }) => {
      test.setTimeout(180_000);
      test.skip(entry.enabled === false, 'Account lockout test requires a pre-blocked test account');
      const baseUrl = process.env.BASE_URL;
      if (!baseUrl) {
        throw new Error('Missing required environment variable: BASE_URL');
      }

      await openAuth0Login(page, baseUrl);
      await expect(page.getByRole('textbox', { name: 'Email address' })).toBeVisible();
      const passwordField = page.getByRole('textbox', { name: 'Password' });
      await expect(passwordField).toHaveAttribute('type', 'password');

      const showPasswordSwitch = page.getByRole('switch', { name: 'Show password' });
      await expect(showPasswordSwitch).toBeVisible();
      await showPasswordSwitch.click();
      await expect(passwordField).toHaveAttribute('type', 'text');
      await showPasswordSwitch.click();
      await expect(passwordField).toHaveAttribute('type', 'password');

      if (shouldFillEmail(entry.scenario)) {
        await page
          .getByRole('textbox', { name: 'Email address' })
          .fill(resolveEnvironmentValue(entry.email));
      }
      if (shouldFillPassword(entry.scenario)) {
        await passwordField.fill(resolveEnvironmentValue(entry.password));
      }
      await page.getByRole('button', { name: 'Continue' }).click();

      if (entry.TestResult === 'Success') {
        const broadcareRootUrl = new URL('/', baseUrl).toString();

        await expect(page).toHaveURL(
          new RegExp(
            `${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:callback#.+)?`
          ),
          { timeout: 120_000 }
        );
        expect(new URL(page.url()).hash).toMatch(/access_token=[^&]+/);

        await page.goto(broadcareRootUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForURL(
          (url) =>
            url.origin === new URL(baseUrl).origin &&
            url.pathname === new URL(broadcareRootUrl).pathname,
          { timeout: 120_000 }
        );
        await expect(page).toHaveURL(broadcareRootUrl, { timeout: 120_000 });
        await expect(page).toHaveTitle(/BroadCare/i);
        await expect(page.locator('body')).toBeVisible();
      } else {
        if (
          entry.scenario === 'Invalid password' ||
          entry.scenario === 'Invalid email' ||
          entry.scenario === 'Invalid email format'
        ) {
          await expect(
            page.getByText(
              /Wrong email or password|Your account has been blocked after multiple consecutive login attempts/,
              { exact: false }
            ).first()
          ).toBeVisible();
        } else if (entry.scenario === 'Account blocked') {
          await expect(
            page.getByText(normalizeValidationText(entry.FailedValidation), { exact: false })
          ).toBeVisible();
        } else {
          const validationError = page
            .locator('[data-is-error="true"]')
            .filter({ hasText: normalizeValidationText(entry.FailedValidation) })
            .first();
          await expect(validationError).toBeVisible();
        }
        await expect(page).toHaveURL(/chs-dev\.uk\.auth0\.com\/u\/login/);
      }
    });
  }
});
