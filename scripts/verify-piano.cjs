const { _electron } = require('playwright');
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'poems-score-'));
  const app = await _electron.launch({
    args: [path.resolve('.'), '--user-data-dir=' + path.join(tmp, 'profile')]
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => (location.hash = '/hymn-library'));
    const filter = page.getByPlaceholder('搜作者、歌手、歌名或歌词');
    await filter.fill('宣信');
    await page.locator('.document-row').first().getByText('宣信', { exact: true }).waitFor();
    const file = path.join(tmp, '练习.pdf');
    const bytes = await app.evaluate(async ({ BrowserWindow }) => {
      const w = new BrowserWindow({ show: false });
      try {
        await w.loadURL(
          'data:text/html;charset=utf-8,' +
            encodeURIComponent(
              '<meta charset=utf-8><p>作曲：示例作者</p><p>C　　 Am　　 G7</p><p>晨光　照亮　琴房</p>'
            )
        );
        return Array.from(await w.webContents.printToPDF({}));
      } finally {
        w.destroy();
      }
    });
    await fs.writeFile(file, Buffer.from(bytes));
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ filePaths: [f], canceled: false });
    }, file);
    await page.getByText('识别蓝版 / 白版 PDF', { exact: true }).click();
    await page.getByText(/识别结果：白版/).waitFor();
    await page.getByText('确认导入', { exact: true }).click();
    await page.locator('.score').waitFor();
    await page.getByText('加入司琴歌单', { exact: true }).click();
    assert.equal(
      await page.locator('.score').evaluate((el) => getComputedStyle(el).backgroundColor),
      'rgb(255, 255, 255)'
    );
    assert.ok((await page.locator('.score').innerText()).includes('G7'));
    await page.keyboard.press('Escape');
    await filter.fill('示例作者');
    await page.locator('.document-row').first().getByText('示例作者', { exact: true }).waitFor();
    await page.evaluate(() => (location.hash = '/set'));
    await page.getByRole('button', { name: /Nord 极光/ }).click();
    assert.equal(await page.locator('html').getAttribute('data-palette'), 'nord');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-palette'), 'nord');
    await page.getByRole('button', { name: /Catppuccin 拿铁/ }).click();
    assert.equal(await page.locator('html').getAttribute('data-palette'), 'latte');
    const scan = path.join(tmp, '扫描测试.pdf');
    const scanBytes = await app.evaluate(async ({ BrowserWindow }) => {
      const w = new BrowserWindow({ show: false });
      try {
        await w.loadURL('about:blank');
        await w.webContents.executeJavaScript(`(async()=>{
          const c=document.createElement('canvas');c.width=900;c.height=220;const ctx=c.getContext('2d');
          ctx.fillStyle='white';ctx.fillRect(0,0,900,220);ctx.fillStyle='black';ctx.font='42px Arial';
          ctx.fillText('C     Am     F     G7',30,75);ctx.fillText('Sing with me',30,160);
          const img=new Image();img.src=c.toDataURL();await img.decode();img.width=650;document.body.append(img)
        })()`);
        return Array.from(await w.webContents.printToPDF({}));
      } finally {
        w.destroy();
      }
    });
    await fs.writeFile(scan, Buffer.from(scanBytes));
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ filePaths: [f], canceled: false });
    }, scan);
    const scanned = await page.evaluate(() => window.api.invoke('poems:score-read'));
    assert.equal(scanned.scanned, true);
    assert.match(scanned.raw, /Sing/i);
    const blue = path.resolve('songbooks/儿童诗歌/00/001.pdf');
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ filePaths: [f], canceled: false });
    }, blue);
    const result = await page.evaluate(() => window.api.invoke('poems:score-read'));
    assert.equal(result.edition, 'blue');
    console.log('Scanned OCR and blue numbered score detection passed.');
    console.log(
      'Author filter, white PDF recognition and import, pianist list and persistent themes passed.'
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
