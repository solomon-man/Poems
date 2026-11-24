const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { _electron } = require('playwright');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'poems-journal-'));
  const app = await _electron.launch({
    args: [path.resolve('.'), '--user-data-dir=' + path.join(dir, 'profile')]
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => (location.hash = '/hymn-library'));
    await page.getByPlaceholder('搜作者、歌手、歌名或歌词').fill('爱随着光释放');
    const open = () => page.getByTitle('写心迹').first().click();
    await open();
    const editor = page.getByRole('textbox', { name: '写下此刻的感悟' });
    await editor.fill('唱到这一句时，想起有人为我留过的一盏灯。');
    await page.getByText('记下心迹', { exact: true }).click();
    const entry = page.locator('.journal article');
    await entry.waitFor();
    await page.getByLabel('关闭心迹').click();
    await open();
    assert.match(await entry.innerText(), /一盏灯/);
    await page.getByLabel('编辑这则心迹').click();
    await page.locator('.journal textarea').fill('愿我也为别人留一盏灯。');
    await page.getByText('保存修改', { exact: true }).click();
    await entry.getByText('愿我也为别人留一盏灯。').waitFor();
    await page.locator('.journal').screenshot({ path: path.join(dir, 'light.png') });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    assert.equal(
      await page.locator('.journal').evaluate((el) => getComputedStyle(el).backgroundColor),
      'rgb(39, 35, 38)'
    );
    await page.locator('.journal').screenshot({ path: path.join(dir, 'dark.png') });
    const backup = path.join(dir, 'library.poems');
    await app.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = async () => ({ filePath: f });
      dialog.showOpenDialog = async () => ({ filePaths: [f] });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backup);
    await page.evaluate(() => window.api.invoke('poems:backup', {}));
    const archive = JSON.parse(zlib.gunzipSync(await fs.readFile(backup)));
    assert.equal(archive.version, 2);
    assert.ok(Object.keys(archive.files).some((k) => k.startsWith('SongReflections/')));
    await page.getByLabel('删除这则心迹').click();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('.journal .empty').waitFor();
    await page.evaluate(() => window.api.invoke('poems:restore'));
    await page.getByLabel('关闭心迹').click();
    await open();
    await entry.waitFor();
    archive.version = 1;
    for (const k of Object.keys(archive.files))
      if (k.startsWith('SongReflections/')) delete archive.files[k];
    await fs.writeFile(backup, zlib.gzipSync(JSON.stringify(archive)));
    await page.evaluate(() => window.api.invoke('poems:restore'));
    await page.getByLabel('关闭心迹').click();
    await open();
    await entry.waitFor();
    assert.deepEqual(
      await page.evaluate(() => window.api.invoke('poems:notes', 'local:another-song')),
      []
    );
    console.log('Journal CRUD, isolation and backup compatibility passed.', dir);
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
