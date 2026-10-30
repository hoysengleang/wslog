import { allowConsoleError, connectApp, expect, rejectedStatus, test } from './fixtures.js';

test('first run: rejects bad URLs, then hands out a proxy URL', async ({ page, wslog, upstream }) => {
  allowConsoleError(page, /status of 400/);
  await page.goto(wslog.url);
  await expect(page.getByRole('heading', { name: 'Watch every WebSocket message' })).toBeVisible();
  // Before there is anything to show, the sidebar does not talk about proxy URLs or targets.
  await expect(page.getByRole('heading', { name: 'Targets' })).toHaveCount(0);

  const input = page.getByLabel('Target WebSocket URL');
  await input.fill('ftp://nope');
  await input.press('Enter');
  await expect(page.getByText('Target must be a ws:// or wss:// URL')).toBeVisible();
  await input.fill(`${upstream.url}/quiet`);
  await expect(page.getByText('Target must be a ws:// or wss:// URL')).toHaveCount(0);
  await input.press('Enter');

  await expect(page.getByRole('heading', { name: 'Waiting for your app to connect' })).toBeVisible();
  const proxyUrl = wslog.proxyUrl(wslog.ctx.targets.list()[0]!);
  await expect(page.locator('.proxy-pill code')).toHaveText(proxyUrl);

  const app = await connectApp(proxyUrl);
  await expect(page.getByRole('heading', { name: 'Connected. Waiting for the first message' })).toBeVisible();
  app.send('hello');
  await expect(page.locator('.table-row', { hasText: '{"type":"echo","data":"hello"}' })).toBeVisible();
  await expect(page.locator('.event-row', { hasText: 'connected /' })).toBeVisible();
  app.ws.close();
});

test('an app using a proxy URL wslog does not know is explained, not a silent 404', async ({ page, wslog }) => {
  await page.goto(wslog.url);
  expect(await rejectedStatus(`${wslog.wsBase}/p/deadbeef/chat`)).toBe(404);
  await expect(page.getByRole('alert')).toContainText('Your app used a proxy URL wslog does not know');
  await expect(page.getByRole('alert')).toContainText('/p/deadbeef/chat');
});

test('an unreachable server is explained in the main view', async ({ page, wslog }) => {
  const target = wslog.ctx.targets.add('ws://127.0.0.1:1/down');
  await page.goto(wslog.url);
  expect(await rejectedStatus(wslog.proxyUrl(target))).toBe(502);
  await expect(page.getByRole('alert')).toContainText('could not reach your server');
  await expect(page.getByRole('alert')).toContainText('ECONNREFUSED');
});

test('a server that refuses the handshake is explained in the main view', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/auth`);
  await page.goto(wslog.url);
  expect(await rejectedStatus(wslog.proxyUrl(target))).toBe(401);
  await expect(page.getByRole('alert')).toContainText('Your server refused the connection');
  await expect(page.getByRole('alert')).toContainText('401');
});
