import { test, expect } from '@playwright/test';
import { ensureTestAdmin, cleanupTestAdmin } from './helpers';

test.describe('admin user + token + key daily-ops', () => {
  let adminEmail: string;
  let adminPassword: string;

  test.beforeAll(async () => {
    const admin = await ensureTestAdmin();
    adminEmail = admin.email;
    adminPassword = admin.password;
  });

  test.afterAll(async () => {
    await cleanupTestAdmin();
  });

  test('login → dashboard renders with nav links', async ({ page }) => {
    // Navigate to login
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText(/login|sign in/i);

    // Fill credentials
    await page.fill('input[type=email]', adminEmail);
    await page.fill('input[type=password]', adminPassword);

    // Submit (button type=submit inside the form)
    await page.click('button[type=submit]');

    // Should redirect to /admin
    await page.waitForURL(/\/admin$/, { timeout: 15_000 });
    await expect(page.locator('h1')).toContainText(/dashboard/i);

    // Nav links should be visible (admin role)
    await expect(page.locator('nav a[href="/admin/users"]')).toBeVisible();
    await expect(page.locator('nav a[href="/admin/api-keys"]')).toBeVisible();
    await expect(page.locator('nav a[href="/admin/github-tokens"]')).toBeVisible();

    // Logged-in email visible somewhere (appears in nav and in body — use first)
    await expect(page.locator('text=' + adminEmail).first()).toBeVisible();
  });

  test('navigate users → api-keys → github-tokens pages render', async ({ page }) => {
    // Login (reuse pattern)
    await page.goto('/login');
    await page.fill('input[type=email]', adminEmail);
    await page.fill('input[type=password]', adminPassword);
    await page.click('button[type=submit]');
    await page.waitForURL(/\/admin$/, { timeout: 15_000 });

    // Users page
    await page.click('a[href="/admin/users"]');
    await page.waitForURL(/\/admin\/users$/);
    await expect(page.locator('h1')).toContainText(/users/i);
    await expect(page.locator('text=Invite a user')).toBeVisible();

    // API keys page
    await page.click('a[href="/admin"]'); // back to dashboard
    await page.click('a[href="/admin/api-keys"]');
    await page.waitForURL(/\/admin\/api-keys$/);
    await expect(page.locator('h1')).toContainText(/api keys/i);
    await expect(page.locator('text=Filter:')).toBeVisible();

    // GitHub tokens page
    await page.click('a[href="/admin"]');
    await page.click('a[href="/admin/github-tokens"]');
    await page.waitForURL(/\/admin\/github-tokens$/);
    await expect(page.locator('h1')).toContainText(/github tokens/i);
    await expect(page.locator('text=Add a token')).toBeVisible();
  });
});
