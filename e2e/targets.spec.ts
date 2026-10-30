import { connectApp, expect, startTestWslog, test } from './fixtures.js';

test('targets on one host are told apart, and clicking one filters the traffic', async ({ page, wslog, upstream }) => {
  const one = wslog.ctx.targets.add(`${upstream.url}/quiet/orders`);
  const two = wslog.ctx.targets.add(`${upstream.url}/quiet/billing`);
  await page.goto(wslog.url);
  const appOne = await connectApp(wslog.proxyUrl(one));
  const appTwo = await connectApp(wslog.proxyUrl(two));
  appOne.send('from-orders');
  appTwo.send('from-billing');
  await expect(page.locator('.table-row', { hasText: 'from-billing' }).first()).toBeVisible();

  // Both paths are readable even though the host is the same and the sidebar is narrow.
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.locator('.target-path', { hasText: '/quiet/orders' })).toBeVisible();
  await expect(sidebar.locator('.target-path', { hasText: '/quiet/billing' })).toBeVisible();

  await sidebar.getByRole('button', { name: /\/quiet\/orders/ }).click();
  await expect(page.locator('.table-row', { hasText: 'from-orders' }).first()).toBeVisible();
  await expect(page.locator('.table-row', { hasText: 'from-billing' })).toHaveCount(0);
  await expect(page.locator('.proxy-pill code')).toHaveText(wslog.proxyUrl(one));

  await sidebar.getByRole('button', { name: 'All targets' }).click();
  await expect(page.locator('.table-row', { hasText: 'from-billing' }).first()).toBeVisible();
  appOne.ws.close();
  appTwo.ws.close();
});

test('adding a target from the sidebar selects it and shows its proxy URL', async ({ page, wslog, upstream }) => {
  const first = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const app = await connectApp(wslog.proxyUrl(first));
  app.send('hi');
  await page.goto(wslog.url);
  await expect(page.locator('.table-row', { hasText: '"data":"hi"' })).toBeVisible();

  await page.getByRole('button', { name: 'Add' }).click();
  const input = page.locator('.sidebar').getByLabel('Target WebSocket URL');
  await input.fill(`${upstream.url}/second`);
  await input.press('Enter');

  await expect(page.getByRole('heading', { name: 'Waiting for your app to connect' })).toBeVisible();
  const second = wslog.ctx.targets.list().find((t) => t.url.endsWith('/second'))!;
  await expect(page.locator('.proxy-pill code')).toHaveText(wslog.proxyUrl(second));
  await expect(input).toHaveCount(0); // the form closes after adding
  app.ws.close();
});

test('removing a target asks first, then disconnects the apps using it', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const app = await connectApp(wslog.proxyUrl(target));
  app.send('hi');
  await page.goto(wslog.url);
  await expect(page.locator('.table-row', { hasText: '"data":"hi"' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove target' }).click();
  await expect(page.getByRole('status')).toHaveText('Click ✕ again to remove and disconnect 1 open connection.');
  expect(app.ws.readyState).toBe(app.ws.OPEN);

  await page.getByRole('button', { name: 'Confirm remove target' }).click();
  expect(await app.closed).toEqual({ code: 1001, reason: 'Target removed in wslog' });
  await expect(page.locator('.event-row', { hasText: 'closed 1001 · going away "Target removed in wslog" (by proxy)' })).toBeVisible();
  expect(wslog.ctx.targets.list()).toHaveLength(0);
});

test('the remove confirmation expires on its own', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const app = await connectApp(wslog.proxyUrl(target));
  app.send('hi');
  await page.goto(wslog.url);
  await page.getByRole('button', { name: 'Remove target' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Remove target' })).toBeVisible();
  expect(wslog.ctx.targets.list()).toHaveLength(1);
  app.ws.close();
});

test('targets survive a restart, so the proxy URL in your app keeps working', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const oldProxyPath = target.proxyPath;
  await wslog.close();

  const restarted = await startTestWslog({ targetsFile: wslog.ctx.config.targetsFile });
  try {
    const remembered = restarted.ctx.targets.list();
    expect(remembered.map((t) => t.proxyPath)).toEqual([oldProxyPath]);
    const app = await connectApp(restarted.proxyUrl(remembered[0]!));
    app.send('after-restart');
    await page.goto(restarted.url);
    await expect(page.locator('.table-row', { hasText: 'after-restart' }).first()).toBeVisible();
    app.ws.close();
  } finally {
    await restarted.close();
  }
});
