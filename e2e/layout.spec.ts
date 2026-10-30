import { connectApp, expect, test } from './fixtures.js';

test('at laptop width the top bar is one row and the table keeps a readable payload column', async ({ page, wslog, upstream }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  wslog.ctx.targets.add(`${upstream.url}/quiet/other`);
  const app = await connectApp(wslog.proxyUrl(target));
  app.send('x'.repeat(200));
  await page.goto(wslog.url);
  await expect(page.locator('.table-row', { hasText: 'xxxx' }).first()).toBeVisible();

  const topbar = await page.locator('.topbar').boundingBox();
  expect(topbar!.height).toBeLessThan(56);

  await page.locator('.table-row', { hasText: 'xxxx' }).first().click();
  await expect(page.locator('.detail')).toBeVisible();
  const payload = await page.locator('.table-row:not(.event-row) .col-preview').first().boundingBox();
  expect(payload!.width).toBeGreaterThan(200);
  app.ws.close();
});

test('the detail pane resizes from its edge and remembers the width', async ({ page, wslog, upstream }) => {
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet`);
  const app = await connectApp(wslog.proxyUrl(target));
  app.send('resize me');
  await page.goto(wslog.url);
  await page.locator('.table-row', { hasText: 'resize me' }).first().click();
  const detail = page.locator('.detail');
  const before = (await detail.boundingBox())!.width;

  const handle = page.getByRole('separator', { name: 'Resize message details' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 150, box.y + 100, { steps: 5 });
  await page.mouse.up();
  const wider = (await detail.boundingBox())!.width;
  expect(wider).toBeGreaterThan(before + 100);

  await page.reload();
  await page.locator('.table-row', { hasText: 'resize me' }).first().click();
  expect(Math.abs((await detail.boundingBox())!.width - wider)).toBeLessThan(4);

  await handle.dblclick(); // back to the default
  expect(Math.abs((await detail.boundingBox())!.width - before)).toBeLessThan(4);
  app.ws.close();
});

test('on a phone nothing scrolls sideways', async ({ page, wslog, upstream }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const target = wslog.ctx.targets.add(`${upstream.url}/quiet/a-rather-long-path/that-keeps-going?with=query&and=more`);
  const app = await connectApp(wslog.proxyUrl(target));
  app.send(JSON.stringify({ long: 'y'.repeat(500) }));
  await page.goto(wslog.url);
  await expect(page.locator('.table-row', { hasText: 'yyyy' }).first()).toBeVisible();
  // A string, because this tsconfig has no DOM types (it also covers the server).
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth');
  expect(overflow).toBeLessThanOrEqual(0);
  app.ws.close();
});
