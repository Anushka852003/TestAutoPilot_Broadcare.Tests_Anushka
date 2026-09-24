import { test, expect, type Page } from '@playwright/test';
import { loadJsonArray } from './utils/json-loader';
import fs from 'fs';
import path from 'path';

type ResetPasswordCase = {
  email: string;
  newPassword: string;
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
  await page
    .getByRole('button', { name: /go to broadcare|return to broadcare/i })
    .click();

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
  // Outlook can redirect to Microsoft sign-in more than once before rendering
  // the form, so wait for a control rather than relying on the current URL.
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);

  const emailField = page
    .locator('#i0116, input[name="loginfmt"], input[name="username"], input[type="email"]')
    .first();
  const passwordField = page
    .locator('#i0118, input[name="passwd"], input[type="password"]')
    .first();
  const useAnotherAccount = page
    .getByText(/use another account/i)
    .or(page.getByRole('button', { name: /use another account/i }))
    .first();
  const mailboxReady = page.locator(
    '[aria-label="New mail"], [title="Inbox"], [aria-label*="Inbox" i], ' +
      '[data-automation-id="splitViewListView"], ' +
      'button[aria-label*="New" i], button[aria-label*="Mail" i], ' +
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
      throw new Error(
        'OUTLOOK_EMAIL and OUTLOOK_PASSWORD are required when Outlook storage state is ' +
          'expired or unauthenticated'
      );
    }

    if (await useAnotherAccount.isVisible({ timeout: 10_000 }).catch(() => false)) {
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

    await expect(passwordField).toBeVisible({ timeout: 30_000 });
    await passwordField.fill(outlookPassword);
    const signInButton = page
      .locator('#idSIButton9')
      .or(page.getByRole('button', { name: /sign in/i }))
      .or(page.locator('input[type="submit"]'))
      .first();
    await expect(signInButton).toBeVisible({ timeout: 15_000 });
    await signInButton.click();

    const staySignedInPrompt = page.getByText(/stay signed in\?/i).first();
    await expect(staySignedInPrompt).toBeVisible({ timeout: 60_000 });

    const noButton = page
      .getByRole('button', { name: /^No$/i })
      .or(page.locator('#idBtn_Back'))
      .first();
    await expect(noButton).toBeVisible({ timeout: 15_000 });
    await noButton.click();
  }

  try {
    await expect(mailboxReady).toBeVisible({ timeout: 180_000 });
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

async function openResetEmail(
  page: Page,
  sender: string,
  subject: string
): Promise<Page> {
  const message = page
    .getByRole('listbox', { name: /message list/i })
    .getByRole('option')
    .filter({ hasText: new RegExp(sender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
    .filter({ hasText: new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
    .first();

  await page.waitForTimeout(10_000);
  await expect(message).toBeVisible({ timeout: 60_000 });
  await message.click();
  await page.waitForURL(/outlook\.office\.com\/mail\/inbox\/id\//, { timeout: 30_000 });
  const readingPane = page.getByRole('main', { name: /reading pane/i });
  await expect(readingPane.getByText(sender, { exact: false }).first()).toBeVisible();
  await expect(readingPane.getByText(subject, { exact: false }).first()).toBeVisible();

  const resetControl = readingPane
    .locator('a[href]')
    .filter({ hasText: /^\s*Reset password\s*$/i })
    .first();
  await expect(resetControl).toBeVisible();

  const auth0ResetUrl = await resetControl.evaluate((anchor) => {
    const values = [
      anchor.getAttribute('href'),
      anchor.getAttribute('data-url'),
      anchor.getAttribute('data-href'),
      anchor.getAttribute('onclick'),
      anchor.outerHTML,
    ].filter((value): value is string => Boolean(value));
    const decodedValues = values.flatMap((value) => {
      const decoded = value.replace(/&amp;/g, '&');
      const decodedAgain = decodeURIComponent(decoded);
      return [value, decoded, decodedAgain];
    });
    return decodedValues
      .map((value) =>
        value.match(
          /https:\/\/chs-dev\.uk\.auth0\.com\/(?:u\/reset-verify\?ticket=|u\/reset-password\/change\?)[^"'<>\s]+/i
        )
      )
      .find((match): match is RegExpMatchArray => Boolean(match))?.[0] ?? null;
  });
  if (!auth0ResetUrl) {
    throw new Error('Reset password email button does not contain an Auth0 reset URL');
  }

  const popupPromise = page.waitForEvent('popup', { timeout: 10_000 }).catch(() => null);
  await resetControl.click();
  const resetPage = (await popupPromise) ?? page;
  const auth0Navigation = resetPage
    .waitForURL(
      /chs-dev\.uk\.auth0\.com\/u\/(?:reset-verify\?ticket=|reset-password\/change\?)/,
      { timeout: 10_000 }
    )
    .then(() => true)
    .catch(() => false);
  if (!(await auth0Navigation)) {
    await resetPage.goto(auth0ResetUrl);
  }
  await resetPage.waitForURL(/chs-dev\.uk\.auth0\.com\/u\/reset-password\/change\?/, {
    timeout: 30_000,
  });
  return resetPage;
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
      const resetEmailSender = process.env.RESET_EMAIL_SENDER;
      const resetEmailSubject = process.env.RESET_EMAIL_SUBJECT;
      if (!resetEmailSender || !resetEmailSubject) {
        throw new Error(
          'RESET_EMAIL_SENDER and RESET_EMAIL_SUBJECT are required to read the reset email'
        );
      }
      const newPassword = resolveEnvironmentValue(entry.newPassword);

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
      const resetPage = await openResetEmail(
        page,
        resetEmailSender,
        resetEmailSubject
      );

      await resetPage.getByRole('textbox', { name: /new password/i }).first().fill(newPassword);
      await resetPage
        .getByRole('textbox', { name: /re-enter new password|confirm new password/i })
        .fill(newPassword);
      await expect(
        resetPage.getByRole('textbox', { name: /new password/i }).first()
      ).toHaveAttribute('type', 'password');
      await resetPage.getByRole('button', { name: /^reset password$/i }).click();
      const resetRedirected = await resetPage
        .waitForURL(/(?:testing4\.broadcare\.co\.uk|\/login)/, { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (!resetRedirected) {
        await expect(resetPage.getByText(/password.*changed|password.*reset|success/i)).toBeVisible({
          timeout: 15_000,
        });
      }

      updateEnvPassword(newPassword);
      await openAuth0Login(resetPage, baseUrl);
      await resetPage
        .getByRole('textbox', { name: 'Email address' })
        .or(resetPage.locator('input[name="email"], input[type="email"]'))
        .first()
        .fill(email);
      await resetPage
        .getByRole('textbox', { name: /password/i })
        .fill(newPassword);
      await resetPage.getByRole('button', { name: /^continue$/i }).click();
      await expect(resetPage).not.toHaveURL(/\/u\/login/);
    });
  }
});
