import { test, expect } from '@playwright/test';

test('home screen renders app title and description', async ({ page }) => {
  await page.goto('index.html#home');
  await expect(page.locator('[data-testid="app-title"]')).toHaveText('Taskboard');
  await expect(page.locator('[data-testid="home-description"]')).toBeVisible();
});

test('login screen renders all form elements', async ({ page }) => {
  await page.goto('index.html#login');
  await expect(page.locator('[data-testid="login-title"]')).toHaveText('Sign In');
  await expect(page.locator('[data-testid="login-email"]')).toBeVisible();
  await expect(page.locator('[data-testid="login-password"]')).toBeVisible();
  await expect(page.locator('[data-testid="login-submit"]')).toBeVisible();
});

test('login with valid credentials navigates to dashboard', async ({ page }) => {
  await page.goto('index.html#login');
  await page.fill('[data-testid="login-email"]', 'user1@demo.test');
  await page.fill('[data-testid="login-password"]', 'demo123');
  await page.click('[data-testid="login-submit"]');
  await expect(page.locator('[data-testid="dashboard-title"]')).toHaveText('Dashboard');
});

test('login with wrong password shows error', async ({ page }) => {
  await page.goto('index.html#login');
  await page.fill('[data-testid="login-email"]', 'user1@demo.test');
  await page.fill('[data-testid="login-password"]', 'wrongpassword');
  await page.click('[data-testid="login-submit"]');
  await expect(page.locator('#login-error')).toBeVisible();
});

test('dashboard renders task list with default tasks', async ({ page }) => {
  await page.goto('index.html#login');
  await page.fill('[data-testid="login-email"]', 'user1@demo.test');
  await page.fill('[data-testid="login-password"]', 'demo123');
  await page.click('[data-testid="login-submit"]');
  await expect(page.locator('[data-testid="dashboard-title"]')).toHaveText('Dashboard');
  await expect(page.locator('[data-testid="task-list"]')).toBeVisible();
  await expect(page.locator('[data-testid="task-item"]')).toHaveCount(3);
});

test('dashboard creates a new task', async ({ page }) => {
  await page.goto('index.html#login');
  await page.fill('[data-testid="login-email"]', 'user1@demo.test');
  await page.fill('[data-testid="login-password"]', 'demo123');
  await page.click('[data-testid="login-submit"]');
  await page.fill('[data-testid="task-title-input"]', 'My new task');
  await page.click('[data-testid="create-task-btn"]');
  await expect(page.locator('[data-testid="task-item"]')).toHaveCount(4);
});

test('clicking task item opens task detail', async ({ page }) => {
  await page.goto('index.html#login');
  await page.fill('[data-testid="login-email"]', 'user1@demo.test');
  await page.fill('[data-testid="login-password"]', 'demo123');
  await page.click('[data-testid="login-submit"]');
  await page.click('[data-testid="task-item"]:first-child');
  await expect(page.locator('[data-testid="task-detail-title"]')).toBeVisible();
  await expect(page.locator('[data-testid="task-back-btn"]')).toBeVisible();
});

test('task complete button changes task status', async ({ page }) => {
  await page.goto('index.html#login');
  await page.fill('[data-testid="login-email"]', 'user1@demo.test');
  await page.fill('[data-testid="login-password"]', 'demo123');
  await page.click('[data-testid="login-submit"]');
  // Click second task (pending)
  await page.click('[data-testid="task-item"]:nth-child(2)');
  await expect(page.locator('[data-testid="task-complete-btn"]')).toBeVisible();
  await page.click('[data-testid="task-complete-btn"]');
  await expect(page.locator('[data-testid="task-reopen-btn"]')).toBeVisible();
});

test('profile screen shows user info and stats', async ({ page }) => {
  await page.goto('index.html#login');
  await page.fill('[data-testid="login-email"]', 'user1@demo.test');
  await page.fill('[data-testid="login-password"]', 'demo123');
  await page.click('[data-testid="login-submit"]');
  await page.goto('index.html#profile');
  await expect(page.locator('[data-testid="profile-title"]')).toHaveText('Profile');
  await expect(page.locator('[data-testid="profile-name"]')).toBeVisible();
  await expect(page.locator('[data-testid="profile-role"]')).toBeVisible();
});

test('logout returns to home screen', async ({ page }) => {
  await page.goto('index.html#login');
  await page.fill('[data-testid="login-email"]', 'user1@demo.test');
  await page.fill('[data-testid="login-password"]', 'demo123');
  await page.click('[data-testid="login-submit"]');
  await page.goto('index.html#profile');
  await page.click('[data-testid="profile-logout-btn"]');
  await expect(page.locator('[data-testid="app-title"]')).toBeVisible();
});

test('navigation links connect authenticated screens', async ({ page }) => {
  await page.goto('index.html#login');
  await page.fill('[data-testid="login-email"]', 'user1@demo.test');
  await page.fill('[data-testid="login-password"]', 'demo123');
  await page.click('[data-testid="login-submit"]');
  await page.click('[data-testid="nav-profile"]');
  await expect(page.locator('[data-testid="profile-title"]')).toBeVisible();
  await page.click('[data-testid="nav-dashboard"]');
  await expect(page.locator('[data-testid="dashboard-title"]')).toBeVisible();
  await page.click('[data-testid="nav-home"]');
  await expect(page.locator('[data-testid="app-title"]')).toBeVisible();
});
