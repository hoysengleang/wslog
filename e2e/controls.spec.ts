import { connectApp, expect, test } from './fixtures.js';

test('pause holds new messages behind an obvious bar; resume shows them', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const app = await connectApp(wslog.proxyUrl(target));
  app.send('before');
  await page.goto(wslog.url);
  await expect(page.locator('.table-row', { hasText: 'before' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('status')).toContainText('Paused.');
  app.send('during');
  await expect(page.getByRole('status')).toContainText('2 new messages waiting.');
  await expect(page.locator('.table-row', { hasText: 'during' })).toHaveCount(0);

  await page.getByRole('status').getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('.table-row', { hasText: 'during' }).first()).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  app.ws.close();
});

test('clear asks first, then starts fresh: messages, finished connections, and counters', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const gone = await connectApp(wslog.proxyUrl(target, '/gone'));
  gone.send('old');
  gone.ws.close();
  await gone.closed;
  const live = await connectApp(wslog.proxyUrl(target, '/live'));
  live.send('hello');
  await page.goto(wslog.url);
  await expect(page.locator('.conn-item')).toHaveCount(2);

  const clear = page.locator('.topbar-actions').getByRole('button', { name: 'Clear' });
  await clear.click();
  await expect(page.locator('.topbar-actions')).toContainText('Clear for everyone?');
  expect(wslog.ctx.store.count()).toBe(4); // one click deletes nothing

  await page.locator('.topbar-actions').getByRole('button', { name: 'Clear for everyone?' }).click();
  await expect(page.getByRole('heading', { name: 'Connected. Waiting for the first message' })).toBeVisible();
  await expect(page.locator('.conn-item')).toHaveCount(1);
  await expect(page.locator('.conn-item')).toContainText('↑0');
  await expect(page.getByRole('button', { name: 'Latest' })).toHaveCount(0);

  live.send('fresh');
  await expect(page.locator('.table-row', { hasText: 'fresh' }).first()).toBeVisible();
  await expect(page.locator('.table-row', { hasText: '"data":"old"' })).toHaveCount(0);
  live.ws.close();
});

test('search and direction filters narrow the table', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const app = await connectApp(wslog.proxyUrl(target));
  for (const word of ['apple', 'banana', 'cherry']) app.send(word);
  await page.goto(wslog.url);
  await expect(page.locator('.toolbar-count')).toHaveText('6 messages');

  await page.getByLabel('Search payloads').fill('banana');
  await expect(page.locator('.toolbar-count')).toHaveText('2 of 6');
  await expect(page.locator('.event-row')).toHaveCount(0); // connection rows are hidden while searching

  await page.getByRole('button', { name: '↑ Out' }).click();
  await expect(page.locator('.toolbar-count')).toHaveText('1 of 6');
  await page.getByLabel('Search payloads').fill('nothing-matches');
  await expect(page.getByText('No messages match the current filter.')).toBeVisible();
  app.ws.close();
});

test('the share dialog explains the link and closes with Escape', async ({ page, wslog, upstream }) => {
  wslog.ctx.targets.add(`${upstream.url}/quiet`);
  await page.goto(wslog.url);
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('read-only');
  await expect(dialog.locator('input, code').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
