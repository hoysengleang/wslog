import { allowConsoleError, connectApp, expect, rejectedStatus, test } from './fixtures.js';

test('the first screen has no sidebar until there is something to list', async ({ page, wslog }) => {
  await page.goto(wslog.url);
  await expect(page.getByRole('heading', { name: 'Watch every WebSocket message' })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);

  // An app knocking on an unknown proxy URL is worth listing.
  await rejectedStatus(`${wslog.wsBase}/p/deadbeef`);
  await expect(page.locator('.sidebar .conn-item')).toContainText('failed');
});

test('adding a target that is down warns right away, before any app tries it', async ({ page, wslog, upstream }) => {
  wslog.ctx.targets.add(`${upstream.url}/quiet`);
  await page.goto(wslog.url);
  await page.getByRole('button', { name: 'Add' }).click();
  const input = page.locator('.sidebar').getByLabel('Target WebSocket URL');
  await input.fill('ws://127.0.0.1:1/down');
  await input.press('Enter');
  await expect(page.locator('.toast')).toContainText('Added, but nothing is listening on 127.0.0.1:1 right now. Is your server running?');
});

test('search marks what it matched; the detail tree decodes JSON sent as a string', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const app = await connectApp(wslog.proxyUrl(target));
  app.send(JSON.stringify({ order: 'Banana split', qty: 2 }));
  await page.goto(wslog.url);

  await page.getByLabel('Search payloads').fill('banana');
  const marks = page.locator('.table-row mark');
  await expect(marks.first()).toHaveText('Banana');
  await expect(marks).toHaveCount(2); // the message and its echo

  await page.locator('.table-row', { hasText: '"echo"' }).click();
  await expect(page.locator('.json-encoded')).toHaveText('JSON string');
  await expect(page.locator('.json-tree')).toContainText('"qty": 2');
  app.ws.close();
});

test('while wslog is unreachable the page says it may be out of date', async ({ page, wslog, upstream }) => {
  allowConsoleError(page, /WebSocket connection to .* failed/);
  wslog.ctx.targets.add(`${upstream.url}/quiet`);
  await page.goto(wslog.url);
  await expect(page.locator('.app')).not.toHaveClass(/offline/);
  await wslog.close();
  await expect(page.locator('.banner')).toContainText('What you see may be out of date.');
  await expect(page.locator('.app')).toHaveClass(/offline/);
});

test('on a phone the connections list keeps room even with several targets', async ({ page, wslog, upstream }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const targets = ['a', 'b', 'c', 'd'].map((p) => wslog.ctx.targets.add(`${upstream.url}/quiet/${p}`));
  const app = await connectApp(wslog.proxyUrl(targets[0]!));
  app.send('hi');
  await page.goto(wslog.url);
  await expect(page.locator('.conn-item')).toHaveCount(1);
  const list = (await page.locator('.side-section-grow').boundingBox())!;
  expect(list.height).toBeGreaterThanOrEqual(110);
  app.ws.close();
});

test('the hex view keeps each dump line whole', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const app = await connectApp(wslog.proxyUrl(target));
  app.ws.send(Buffer.from([0xde, 0xad, 0xbe, 0xef, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), { binary: true });
  await page.goto(wslog.url);
  await page.locator('.table-row', { hasText: 'binary 16 B' }).click();
  const dump = page.locator('.raw.hex');
  await expect(dump).toHaveText('00000000  de ad be ef 00 01 02 03 04 05 06 07 08 09 0a 0b  ................');
  await expect(dump).toHaveCSS('white-space', 'pre');
  app.ws.close();
});
