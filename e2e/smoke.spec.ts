import { test, expect } from '@playwright/test';

// Public/client smoke tests - no Firebase backend required. These guard the surface refactored
// recently: the one-page landing, the create/browse/join popups, i18n, the /play redirects, and PWA.

test.describe('Landing page', () => {
  test('renders the hero and CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Race to your last card');
    await expect(page.getByRole('link', { name: 'Create a Room' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse Rooms' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Join with Code' })).toBeVisible();
  });

  test('has the anchored one-page sections', async ({ page }) => {
    await page.goto('/');
    for (const id of ['how-to-play', 'about']) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
  });
});

test.describe('Room popups (URL-driven)', () => {
  const titles: Record<string, string> = {
    create: 'Create a room',
    browse: 'Open rooms',
    join: 'Join a room',
    rules: 'House rules',
  };
  for (const [param, title] of Object.entries(titles)) {
    test(`/?${param} opens the ${param} dialog`, async ({ page }) => {
      await page.goto(`/?${param}`);
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    });
  }

  test('the hero "Create a Room" CTA opens the create dialog', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Create a Room' }).click();
    await expect(page).toHaveURL(/\?create/); // client-side nav; auto-retry until the URL updates
    await expect(page.getByText('Create a room', { exact: true })).toBeVisible();
  });
});

test.describe('Legacy /play routes redirect to home dialogs', () => {
  test('/play?create -> /?create', async ({ page }) => {
    await page.goto('/play?create=1');
    expect(page.url()).toContain('/?create');
    expect(page.url()).not.toContain('/play');
  });

  test('/play (no room) -> home', async ({ page }) => {
    await page.goto('/play');
    expect(page.url()).not.toContain('/play');
  });
});

test('language toggle switches the page to Vietnamese', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Về đích với lá bài cuối');
});

test.describe('PWA + security', () => {
  test('manifest is linked and served', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    const res = await page.request.get('/manifest.webmanifest');
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('manifest');
  });

  test('security headers are present', async ({ page }) => {
    const res = await page.request.get('/');
    const h = res.headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
  });
});
