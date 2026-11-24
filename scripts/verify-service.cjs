const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poems-service-'));
  const profile = path.join(root, 'profile');
  const backup = path.join(root, 'test.poems');
  const app = await _electron.launch({ args: [path.resolve('.'), '--user-data-dir=' + profile] });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => console.error(e.message));
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      location.hash = '/hymn-library';
    });
    const query = page.getByPlaceholder('搜作者、歌手、歌名或歌词');
    await query.fill('爱随着光释放');
    console.log('search ready');
    const row = page.locator('.document-row').first();
    await row.getByText(/爱随着光释放/).waitFor();
    await row.getByTitle('校对、从匹配句播放或加入歌单').click();
    const line = page.locator('.n-modal input.flex-1').first();
    await line.waitFor();
    console.log('editor ready');
    await line.fill('校对检索验收');
    await page.getByText('保存校对', { exact: true }).click();
    await page.getByText('已保存', { exact: true }).waitFor();
    await page.getByText('加入歌单', { exact: true }).click();
    await page.getByText('投影当前行', { exact: true }).click();
    const projection = await app
      .waitForEvent('window', { predicate: (p) => p.url().startsWith('data:'), timeout: 2500 })
      .catch(() => app.windows().find((p) => p.url().startsWith('data:')));
    assert.ok(projection);
    console.log('projection open');
    console.log('Projected text:', await projection.locator('main').innerText());
    await projection.waitForFunction(
      () => document.querySelector('main')?.textContent === '校对检索验收'
    );
    await page.getByText('结束投影', { exact: true }).click();
    await app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = async () => ({ filePath: f });
      dialog.showOpenDialog = async () => ({ filePaths: [f] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backup);
    await page.getByText('备份歌库', { exact: true }).click();
    await page.getByText('备份已保存', { exact: true }).waitFor();
    assert.ok((await fs.stat(backup)).size > 0);
    console.log('backup written');
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      page.getByText('恢复备份', { exact: true }).click()
    ]);
    await query.waitFor();
    await query.fill('校对检索验收');
    await row.getByText('校对检索验收', { exact: true }).waitFor();
    console.log(
      'Passed: lyric search, manual correction, set list, projection, backup and restore'
    );
  } finally {
    await app.close();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
