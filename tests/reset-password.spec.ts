import { test, expect, type Page } from '@playwright/test';
import { loadJsonArray } from './utils/json-loader';
import fs from 'fs';
import path from 'path';

type ResetPasswordCase = {
  email: string;
  newPassword: string;
  reEnterNewPassword: string;
  TestResult: 'Success' | 'Failed';
  FailedValidation: string;
  testCaseName: string;
};

const testData = loadJsonArray<ResetPasswordCase>(
  './data/reset-password.json',
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

function updateEnvPassword(password: string): void {
  const envPath = path.resolve(process.cwd(), '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const updatedContent = envContent.match(/^PASSWORD=.*$/m)
    ? envContent.replace(/^PASSWORD=.*$/m, `PASSWORD=${password}`)
    : `${envContent.replace(/\s*$/, '')}\nPASSWORD=${password}\n`;

  fs.writeFileSync(envPath, updatedContent);
  process.env.PASSWORD = password;
}

async function openAuth0Login(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByRole('button', { name: 'Go to BroadCare login' }).click();

  await page.waitForURL(
    (url) => url.hostname === 'chs-dev.uk.auth0.com' && url.pathname === '/u/login',
    { timeout: 30_000 }
  );
  const emailField = page
    .getByRole('textbox', { name: 'Email address' })
    .or(page.locator('input[name="email"], input[type="email"]'))
    .first();
  await expect(emailField).toBeVisible({
    timeout: 30_000,
  });
}

async function openOutlookMailbox(page: Page): Promise<void> {
  const outlookUrl = process.env.OUTLOOK_URL;
  const storageState = process.env.OUTLOOK_STORAGE_STATE;

  if (!outlookUrl) {
    throw new Error('OUTLOOK_URL is required to read the reset email');
  }
  await page.goto(outlookUrl);
  // Outlook may first load a shell and redirect to Microsoft authorization a
  // moment later; wait before deciding whether authentication is required.
  await page.waitForTimeout(5_000);

  const emailField = page
    .locator('input[name="loginfmt"], input[name="username"], input[type="email"]')
    .first();
  const useAnotherAccount = page
    .getByText(/use another account/i)
    .or(page.getByRole('button', { name: /use another account/i }))
    .first();
  const isMicrosoftSignIn = /login\.microsoftonline\.com|authorize/i.test(page.url());
  const authenticationRequired =
    isMicrosoftSignIn ||
    (await emailField.isVisible({ timeout: 5_000 }).catch(() => false)) ||
    (await useAnotherAccount.isVisible({ timeout: 5_000 }).catch(() => false));

  if (authenticationRequired) {
    const outlookEmail = process.env.OUTLOOK_EMAIL;
    const outlookPassword = process.env.OUTLOOK_PASSWORD;
    if (!outlookEmail || !outlookPassword) {
      throw new Error(
        'OUTLOOK_EMAIL and OUTLOOK_PASSWORD are required when Outlook storage state is ' +
          'expired or unauthenticated'
      );
    }

    if (await useAnotherAccount.isVisible({ timeout: 30_000 }).catch(() => false)) {
      await useAnotherAccount.click();
    }

    await expect(emailField).toBeVisible({ timeout: 60_000 });
    await emailField.fill(outlookEmail);
    const nextButton = page
      .locator('#idSIButton9')
      .or(page.getByRole('button', { name: /next/i }))
      .or(page.locator('input[type="submit"]'))
      .first();
    await expect(nextButton).toBeVisible({ timeout: 15_000 });
    await nextButton.click();

    const passwordField = page.locator('#i0118, input[name="passwd"], input[type="password"]').first();
    await expect(passwordField).toBeVisible({ timeout: 30_000 });
    await passwordField.fill(outlookPassword);
    const signInButton = page
      .locator('#idSIButton9')
      .or(page.getByRole('button', { name: /sign in/i }))
      .or(page.locator('input[type="submit"]'))
      .first();
    await expect(signInButton).toBeVisible({ timeout: 15_000 });
    await signInButton.click();

    const noButton = page
      .locator('#idBtn_Back')
      .or(page.getByRole('button', { name: /^no$/i }))
      .or(page.getByText(/^no$/i))
      .first();
    if (await noButton.isVisible({ timeout: 30_000 }).catch(() => false)) {
      await noButton.click();
    }
  }

  const mailboxReady = page.locator(
    '[aria-label="New mail"], [title="Inbox"], [aria-label*="Inbox" i], ' +
      '[data-automation-id="splitViewListView"], ' +
      'button[aria-label*="New" i], button[aria-label*="Mail" i], ' +
      '[role="button"][aria-label*="Inbox" i]'
  ).first();

  try {
    await page.waitForURL(
      (url) => url.hostname === 'outlook.office.com' && url.pathname.startsWith('/mail'),
      { timeout: 180_000 }
    );
    await page.waitForLoadState('domcontentloaded');
    // Keep the page open while the user completes Microsoft MFA or account
    // selection; the mailbox is the only reliable completion signal.
    await expect(mailboxReady).toBeVisible({ timeout: 60_000 });
  } catch (error) {
    const currentUrl = page.url();
    if (/login\.microsoftonline\.com|authorize/i.test(currentUrl)) {
      throw new Error(
        `Microsoft authentication did not complete within 180 seconds. Enter the ` +
          `OUTLOOK_EMAIL and OUTLOOK_PASSWORD values if prompted, complete MFA, and ` +
          `return to the Outlook mailbox. ` +
          `Current URL: ${currentUrl}`,
        { cause: error }
      );
    }
    throw new Error(`Outlook mailbox UI was not found. Current URL: ${currentUrl}`, {
      cause: error,
    });
  }

  if (storageState) {
    await page.context().storageState({ path: path.resolve(process.cwd(), storageState) });
  }
}

async function openResetEmail(page: Page, recipient: string): Promise<Page> {
  const message = page
    .getByRole('row')
    .filter({ hasText: /help(?:me)?@chshealthcare\.co\.uk/i })
    .first();

  await expect(message).toBeVisible({ timeout: 60_000 });
  await message.click();
  await expect(
    page.getByText(/help(?:me)?@chshealthcare\.co\.uk/i, { exact: false })
  ).toBeVisible();
  await expect(page.getByText(recipient, { exact: false })).toBeVisible();

  const resetLink = page.getByRole('link', { name: /reset password/i }).first();
  await expect(resetLink).toBeVisible();
  const href = await resetLink.getAttribute('href');
  if (!href) {
    throw new Error('Reset password email link has no href');
  }
  await page.goto(new URL(href, page.url()).toString());
  return page;
}

test.describe('Reset password', () => {
  for (const [index, entry] of testData.entries()) {
    test(`${index + 1}. ${entry.testCaseName}`, async ({ page }) => {
      test.setTimeout(240_000);
      const baseUrl = process.env.BASE_URL;
      if (!baseUrl) {
        throw new Error('Missing required environment variable: BASE_URL');
      }

      const email = resolveEnvironmentValue(entry.email);
      const newPassword = resolveEnvironmentValue(entry.newPassword);
      const reEnterNewPassword = resolveEnvironmentValue(entry.reEnterNewPassword);

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

      await openOutlookMailbox(page);
      const resetPage = await openResetEmail(page, email);
      await resetPage.waitForURL(/\/u\/reset-password\/(?:change|request)/, {
        timeout: 30_000,
      });

      await resetPage.getByRole('textbox', { name: /new password/i }).first().fill(newPassword);
      await resetPage
        .getByRole('textbox', { name: /re-enter new password|confirm new password/i })
        .fill(reEnterNewPassword);
      await expect(
        resetPage.getByRole('textbox', { name: /new password/i }).first()
      ).toHaveAttribute('type', 'password');
      await resetPage
        .getByRole('button', { name: /continue|reset password|save|update password/i })
        .click();
      await expect(resetPage.getByText(/password.*changed|password.*reset|success/i)).toBeVisible();

      updateEnvPassword(newPassword);
      await openAuth0Login(resetPage, baseUrl);
      await resetPage
        .getByRole('textbox', { name: 'Email address' })
        .or(resetPage.locator('input[name="email"], input[type="email"]'))
        .first()
        .fill(email);
      await resetPage.getByRole('textbox', { name: 'Password' }).fill(newPassword);
      await resetPage.getByRole('button', { name: 'Continue' }).click();
      await expect(resetPage).not.toHaveURL(/\/u\/login/);
    });
  }
});
