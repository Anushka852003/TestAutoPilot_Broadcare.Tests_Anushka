import { test, expect, type Page } from './utils/auth';
import { loadJsonArray } from './utils/json-loader';
import { uniqueNameToken } from './utils/common';

type CreateUserCase = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  TestResult: 'Success' | 'Failed';
  FailedValidation: string;
  testCaseName: string;
};

type Permission = {
  RoleID: number;
  Resource: string;
  CanCreate: boolean;
};

const testData = loadJsonArray<CreateUserCase>('./data/create-new-user.json', __dirname);
const RUN_ID = uniqueNameToken();

function resolveRunValue(value: string): string {
  return value.replace(/\{\{run\}\}/g, RUN_ID);
}

async function readUserRoleIds(page: Page): Promise<number[]> {
  try {
    await page.waitForFunction(() => {
      const storedRoles = localStorage.getItem('UserRoles');
      if (!storedRoles) {
        return false;
      }

      try {
        const parsedRoles = JSON.parse(storedRoles);
        return Array.isArray(parsedRoles) && parsedRoles.length > 0;
      } catch {
        return false;
      }
    }, undefined, { timeout: 60_000 });
  } catch (error) {
    const storageKeys = await page.evaluate(() => Object.keys(localStorage));
    throw new Error(
      `Authenticated application did not populate localStorage.UserRoles within 60 seconds. ` +
        `Current URL: ${page.url()}. Available localStorage keys: ${storageKeys.join(', ') || '(none)'}`,
      { cause: error }
    );
  }

  return page.evaluate(() => {
    const storedRoles = localStorage.getItem('UserRoles');
    if (!storedRoles) {
      return [];
    }

    const parsedRoles: unknown = JSON.parse(storedRoles);
    const roleValues = Array.isArray(parsedRoles)
      ? parsedRoles
      : typeof parsedRoles === 'object' && parsedRoles !== null
        ? Object.values(parsedRoles)
        : [];

    return roleValues
      .map((role) => (typeof role === 'object' && role !== null ? (role as { RoleID?: unknown }).RoleID : role))
      .map(Number)
      .filter(Number.isFinite);
  });
}

async function loadRolePermissions(page: Page, roleIds: number[]): Promise<Permission[]> {
  const query = new URLSearchParams({ num: '0' });
  roleIds.forEach((roleId) => query.append('Role', String(roleId)));

  const response = await page.request.get(`/api/role-permissions?${query.toString()}`, {
    headers: { Accept: 'application/x.broadcare.role-permission+json' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();

  const body: unknown = await response.json();
  return Array.isArray(body)
    ? (body as Permission[])
    : ((body as { items?: Permission[] }).items ?? []);
}

async function fillFirstMatching(page: Page, names: RegExp[], value: string): Promise<void> {
  for (const name of names) {
    const field = page.getByRole('textbox', { name }).first();
    if (await field.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await field.fill(value);
      return;
    }
  }
  throw new Error(`Could not find a visible user form field matching ${names.join(', ')}`);
}

test.describe('Create-new-user', () => {
  for (const [index, entry] of testData.entries()) {
    test(`${index + 1}. ${entry.testCaseName}`, async ({ page }) => {
      test.setTimeout(120_000);

      const baseUrl = process.env.BASE_URL;
      if (!baseUrl) {
        throw new Error('Missing required environment variable: BASE_URL');
      }

      const email = process.env.EMAIL;
      const password = process.env.PASSWORD;
      if (!email || !password) {
        throw new Error('EMAIL and PASSWORD are required to authenticate the create-user test');
      }

      await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
      const returnToBroadCare = page
        .getByRole('button', { name: /return to broadcare|go to broadcare login/i })
        .or(page.getByRole('link', { name: /return to broadcare|go to broadcare login/i }))
        .first();
      await expect(returnToBroadCare).toBeVisible({ timeout: 30_000 });
      await returnToBroadCare.click();

      await page.waitForURL(
        (url) => url.hostname === 'chs-dev.uk.auth0.com' && url.pathname === '/u/login',
        { timeout: 30_000 }
      );
      await page.getByRole('textbox', { name: 'Email address' }).fill(email);
      await page.getByRole('textbox', { name: 'Password' }).fill(password);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForURL(
        (url) => url.origin === new URL(baseUrl).origin && url.pathname !== '/login',
        { timeout: 60_000 }
      );

      await page.goto(`${baseUrl}/administration/security/users`);
      await page.waitForLoadState('networkidle');

      const roleIds = await readUserRoleIds(page);
      expect(roleIds, 'The signed-in user should have at least one role').not.toEqual([]);

      const permissions = await loadRolePermissions(page, roleIds);
      const canCreateUser = permissions.some(
        (permission) =>
          roleIds.includes(Number(permission.RoleID)) &&
          permission.Resource === 'User' &&
          permission.CanCreate === true
      );

      const newUserButton = page.getByRole('button', { name: 'New', exact: true });
      if (!canCreateUser) {
        await expect(newUserButton).toBeHidden();
        return;
      }

      await expect(newUserButton).toBeVisible();
      await newUserButton.click();

      await fillFirstMatching(page, [/first name/i, /given name/i], resolveRunValue(entry.firstName));
      await fillFirstMatching(page, [/last name/i, /surname/i], resolveRunValue(entry.lastName));
      await fillFirstMatching(page, [/email/i], resolveRunValue(entry.email));
      await fillFirstMatching(page, [/password/i], resolveRunValue(entry.password));
      await fillFirstMatching(
        page,
        [/confirm password/i, /re-enter password/i, /repeat password/i],
        resolveRunValue(entry.confirmPassword)
      );

      const roleSelect = page
        .locator(
          'select[name*="role" i], select[id*="role" i], ' +
            'input[name="UserRoleID"], input[name="userRoleId"], input[id="UserRoleID"]'
        )
        .first();
      if (await roleSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
        if (await roleSelect.evaluate((element) => element.tagName === 'SELECT')) {
          await roleSelect.selectOption(String(roleIds[0]));
        } else {
          await roleSelect.fill(String(roleIds[0]));
        }
      }

      if (entry.TestResult === 'Success') {
        await page.getByRole('button', { name: /save|create|add/i }).last().click();
        await expect(
          page.getByText(/user.*created|successfully.*user|saved successfully/i).first()
        ).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(resolveRunValue(entry.email), { exact: false })).toBeVisible();
      } else {
        await expect(page.getByText(entry.FailedValidation, { exact: false })).toBeVisible();
      }
    });
  }
});