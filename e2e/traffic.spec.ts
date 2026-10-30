import { connectApp, expect, test } from './fixtures.js';

test('masks secrets in the table, the details, and exports, even inside echoed JSON', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  await page.goto(wslog.url);
  const app = await connectApp(wslog.proxyUrl(target, '?token=url-secret'));
  // The server echoes this back as a JSON string inside JSON, a classic way secrets slip past masking.
  app.send(JSON.stringify({ type: 'login', user: 'ada', token: 'abc123' }));
  app.send('42["auth","{\\"token\\":\\"abc123\\"}"]');

  const echo = page.locator('.table-row', { hasText: '"echo"' }).first();
  await expect(echo).toBeVisible();
  await expect(page.locator('.table-row')).toHaveCount(5); // connected + 2 out + 2 echoes
  await expect(page.locator('.traffic')).not.toContainText('abc123');
  await expect(page.locator('.sidebar')).not.toContainText('url-secret');

  await echo.click();
  await expect(page.locator('.detail')).toContainText('server → client');
  await expect(page.locator('.detail')).not.toContainText('abc123');

  const exported = await (await page.request.get(`${wslog.url}/api/export`)).text();
  const { messages } = JSON.parse(exported) as { messages: Array<{ payload: string }> };
  expect(messages.filter((m) => m.payload.includes('"echo"'))).toHaveLength(2);
  expect(exported).not.toMatch(/abc123|url-secret/);
  app.ws.close();
});

test('arrow keys move between messages, skipping connection rows; Escape closes details', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  await page.goto(wslog.url);
  const app = await connectApp(wslog.proxyUrl(target));
  for (const word of ['one', 'two', 'three']) app.send(word);
  await expect(page.locator('.table-row', { hasText: '"data":"three"' })).toBeVisible();

  await page.locator('.table').focus();
  await page.keyboard.press('ArrowUp'); // nothing selected: jumps to the newest message
  await expect(page.locator('.detail')).toContainText('three');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp');
  await expect(page.locator('.detail')).toContainText('one'); // stops at the first message, not the "connected" row
  await page.keyboard.press('Escape');
  await expect(page.locator('.detail')).toHaveCount(0);
  app.ws.close();
});

test('a dropped connection shows up in the message list where it happened', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(upstream.url);
  await page.goto(wslog.url);
  const app = await connectApp(wslog.proxyUrl(target, '/live?room=ops'));
  app.send('ping');
  app.send('die');
  expect((await app.closed).code).toBe(1006);

  const rows = page.locator('.table-row');
  await expect(rows.last()).toContainText('closed 1006 · dropped without a close frame (by server)');
  await expect(rows.first()).toContainText('connected /live?room=ops');
  await expect(page.locator('.sidebar')).toContainText('closed 1006');
});

test('clicking an old connection loads its messages from the server', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const old = await connectApp(wslog.proxyUrl(target, '/old'));
  for (let i = 1; i <= 5; i++) old.send(`old-${i}`);
  await expect.poll(() => wslog.ctx.store.count()).toBe(10);
  old.ws.close();
  // Push the old connection out of the newest 1,000 messages the dashboard loads first.
  const busy = await connectApp(wslog.proxyUrl(target, '/busy'));
  for (let i = 0; i < 600; i++) busy.send(`busy-${i}`);
  await expect.poll(() => wslog.ctx.store.count()).toBe(1210);

  await page.goto(wslog.url);
  await expect(page.locator('.toolbar-count')).toHaveText('1,000 messages');
  await page.locator('.conn-item', { hasText: '/old' }).click();
  await expect(page.locator('.toolbar-count')).toHaveText(/^10 of/);
  await expect(page.locator('.table-row', { hasText: 'old-1' }).first()).toBeVisible();
  busy.ws.close();
});

test('reloading during busy traffic never shows a message twice', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const app = await connectApp(wslog.proxyUrl(target));
  let n = 0;
  const timer = setInterval(() => app.send(`tick-${n++}`), 3);
  try {
    for (let round = 0; round < 3; round++) {
      await page.goto(wslog.url);
      await expect(page.locator('.table-row').first()).toBeVisible();
      await page.waitForTimeout(300);
      const ids = await page.locator('.table-row:not(.event-row) .col-id').allInnerTexts();
      expect(ids.length).toBeGreaterThan(5);
      expect(new Set(ids).size, `duplicate rows: ${ids.join(',')}`).toBe(ids.length);
    }
  } finally {
    clearInterval(timer);
    app.ws.close();
  }
});
