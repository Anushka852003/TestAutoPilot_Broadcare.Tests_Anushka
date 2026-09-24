import { test as base, expect, type Browser, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.BASE_URL!;
const EMAIL = process.env.EMAIL!;
const PASSWORD = process.env.PASSWORD!;

/** Logs in through the BroadCare login form. */
export async function login(page: Page, baseURL: string, email: string, password: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${baseURL}/login`);
    await expect(page.getByRole('button', { name: 'Go to BroadCare login' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to BroadCare login' }).click();

    try {
      await page.waitForURL(/https:\/\/chs-dev\.uk\.auth0\.com\/u\/login\?state=.+/, {
        timeout: 30_000,
      });
      break;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
    }
  }

  const emailField = page.getByRole('textbox', { name: 'Email address' });
  const passwordField = page.getByRole('textbox', { name: 'Password' });
  await expect(emailField).toBeVisible({ timeout: 30_000 });
  await emailField.fill(email);
  await passwordField.fill(password);

  await Promise.all([
    page.waitForURL(
      new RegExp(
        `${baseURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(?:callback#.+)?`
      ),
      { timeout: 120_000 }
    ),
    page.getByRole('button', { name: 'Continue' }).click(),
  ]);

  await expect(page).toHaveURL(/\/callback(?:#|$)/);
  expect(new URL(page.url()).hash).toMatch(/access_token=[^&]+/);
  await page.waitForLoadState('networkidle');

  const broadcareRootUrl = new URL('/', baseURL).toString();
  await page.goto(broadcareRootUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Go to BroadCare login' })).not.toBeVisible({ timeout: 30_000 });
}

const AUTH_DIR = path.resolve(__dirname, '..', '..', '.auth');
const AUTH_FILE = path.join(AUTH_DIR, 'user.json');
const AUTH_LOCK_FILE = path.join(AUTH_DIR, 'user.lock');

/**
 * Logs in exactly once for the whole test run - not once per worker - and every test across every
 * spec file reuses that single session via storageState. Playwright assigns different spec files
 * to different workers by default, so a naive "once per worker" cache still logs in once per
 * worker (e.g. one per spec file); this instead uses an exclusive-create lock file as a
 * cross-process mutex so only the first worker to reach this code performs the login, while every
 * other worker just polls for the file it produces.
 */
async function ensureLoggedIn(browser: Browser): Promise<string> {
  if (fs.existsSync(AUTH_FILE)) {
    return AUTH_FILE;
  }
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  let acquiredLock = false;
  try {
    fs.closeSync(fs.openSync(AUTH_LOCK_FILE, 'wx'));
    acquiredLock = true;
  } catch {
    // Another worker already holds the lock and is logging in; fall through to polling below.
  }

  if (acquiredLock) {
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await login(page, BASE_URL, EMAIL, PASSWORD);
      await context.storageState({ path: AUTH_FILE });
      await context.close();
    } finally {
      fs.rmSync(AUTH_LOCK_FILE, { force: true });
    }
    return AUTH_FILE;
  }

  const deadline = Date.now() + 60000;
  while (!fs.existsSync(AUTH_FILE) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return AUTH_FILE;
}

/**
 * Every test still gets its own fixture-managed page/context (required for Playwright to actually
 * capture video/trace/screenshots for it), but they all share the one storageState from
 * `ensureLoggedIn`.
 */
export const test = base.extend<{}, { workerStorageState: string }>({
  storageState: async ({ workerStorageState }, use) => {
    await use(workerStorageState);
  },
  workerStorageState: [
    async ({ browser }, use) => {
      const fileName = await ensureLoggedIn(browser);
      await use(fileName);
    },
    { scope: 'worker', timeout: 180_000 },
  ],
});

export { expect };
export type { Page };
