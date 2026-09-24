import { test, expect, type Page } from '@playwright/test';
import { loadJsonArray } from './utils/json-loader';
import path from 'path';

type BroadCareResetPasswordCase = {
  email: string;
  TestResult: 'Success' | 'Failed';
  FailedValidation: string;
  testCaseName: string;
};

const testData = loadJsonArray<BroadCareResetPasswordCase>(
  './data/broadcare-reset-password.json',
  __dirname
);

function resolveEnvironmentValue(value: string): string {
  return value.replace(/\{\{env\.([A-Z0-9_]+)\}\}/g, (_, name: string) => {
    const resolved = process.env[name];
    if (!resolved) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return resolved;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openAuth0Login(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page
    .getByRole('button', { name: /go to broadcare|return to broadcare/i })
    .click();
  await page.waitForURL(
    (url) => url.hostname === 'chs-dev.uk.auth0.com' && url.pathname === '/u/login',
    { timeout: 30_000 }
  );
  await expect(
    page
      .getByRole('textbox', { name: 'Email address' })
      .or(page.locator('input[name="email"], input[type="email"]'))
      .first()
  ).toBeVisible({ timeout: 30_000 });
}

async function openOutlookMailbox(page: Page): Promise<void> {
  const outlookUrl = process.env.OUTLOOK_URL;
  const storageState = process.env.OUTLOOK_STORAGE_STATE;
  if (!outlookUrl) {
    throw new Error('OUTLOOK_URL is required to read the reset email');
  }

  await page.goto(outlookUrl);
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);

  const emailField = page
    .locator('#i0116, input[name="loginfmt"], input[name="username"], input[type="email"]')
    .first();
  const passwordField = page.locator('#i0118, input[name="passwd"], input[type="password"]').first();
  const useAnotherAccount = page
    .getByText(/use another account/i)
    .or(page.getByRole('button', { name: /use another account/i }))
    .first();
  const mailboxReady = page.locator(
    '[aria-label="New mail"], [title="Inbox"], [aria-label*="Inbox" i], ' +
      '[data-automation-id="splitViewListView"], button[aria-label*="Mail" i], ' +
      '[role="button"][aria-label*="Inbox" i]'
  ).first();

  const authenticationRequired = await Promise.race([
    emailField.isVisible({ timeout: 180_000 }).then(() => true).catch(() => false),
    useAnotherAccount.isVisible({ timeout: 180_000 }).then(() => true).catch(() => false),
    mailboxReady.isVisible({ timeout: 180_000 }).then(() => false).catch(() => false),
  ]);

  if (authenticationRequired) {
    const outlookEmail = process.env.OUTLOOK_EMAIL;
    const outlookPassword = process.env.OUTLOOK_PASSWORD;
    if (!outlookEmail || !outlookPassword) {
      throw new Error('OUTLOOK_EMAIL and OUTLOOK_PASSWORD are required');
    }

    if (await useAnotherAccount.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await useAnotherAccount.click();
    }
    await expect(emailField).toBeVisible({ timeout: 60_000 });
    await emailField.fill(outlookEmail);
    await page.locator('#idSIButton9, input[type="submit"]').first().click();
    await expect(passwordField).toBeVisible({ timeout: 30_000 });
    await passwordField.fill(outlookPassword);
    await page.locator('#idSIButton9, input[type="submit"]').first().click();

    await expect(page.getByText(/stay signed in\?/i).first()).toBeVisible({ timeout: 60_000 });
    const noButton = page.getByRole('button', { name: /^No$/i }).or(page.locator('#idBtn_Back')).first();
    await expect(noButton).toBeVisible({ timeout: 15_000 });
    await noButton.click();
  }

  await expect(mailboxReady).toBeVisible({ timeout: 180_000 });
  if (storageState) {
    await page.context().storageState({ path: path.resolve(process.cwd(), storageState) });
  }
}

test.describe('BroadCare reset password email', () => {
  for (const [index, entry] of testData.entries()) {
    test(`${index + 1}. ${entry.testCaseName}`, async ({ page }) => {
      test.setTimeout(240_000);
      const baseUrl = process.env.BASE_URL;
      if (!baseUrl) {
        throw new Error('BASE_URL is required');
      }

      const email = resolveEnvironmentValue(entry.email);
      await openAuth0Login(page, baseUrl);
      await page.getByRole('link', { name: 'Reset password' }).click();
      await expect(page).toHaveURL(/\/u\/reset-password\/request\/UserDB\?state=/);
      await page.getByRole('textbox', { name: 'Email address' }).fill(email);
      await page.getByRole('button', { name: 'Continue' }).click();

      if (entry.TestResult === 'Failed') {
        await expect(page.getByText(entry.FailedValidation, { exact: false })).toBeVisible();
        return;
      }

      await expect(page.getByText(/email.*sent|check your email/i)).toBeVisible();
    });
  }
});
