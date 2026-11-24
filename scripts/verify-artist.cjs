const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'poems-artist-'));
  const args = ['--user-data-dir=' + profile];
  const executablePath = process.env.POEMS_TEST_EXE;
  if (!executablePath) args.unshift(path.resolve('.'));
  const app = await _electron.launch({ args, executablePath });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(25000);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('localMusicDB', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('local_music', { keyPath: 'id' });
        r.onsuccess = () => resolve(r.result);
        r.onerror = reject;
      });
      const tx = db.transaction('local_music', 'readwrite');
      for (const id of ['1', '2'])
        tx.objectStore('local_music').put({
          id,
          title: '曲目' + id,
          artist: '作者验收',
          album: '合辑',
          lyrics: '测试唱段',
          filePath: 'test' + id,
          duration: 120000
        });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
      db.close();
      location.hash = '/hymn-library';
    });
    const search = page.getByPlaceholder('搜作者、歌手、歌名或歌词');
    await page.locator('.document-row').first().waitFor();
    assert.equal(await page.locator('.document-row').count(), 60);
    await page.getByText('显示更多歌曲', { exact: true }).click();
    assert.equal(await page.locator('.document-row').count(), 120);
    await search.fill('作者验收');
    await page.locator('.people-list button').filter({ hasText: '作者验收' }).click();
    await page.locator('.person-hero').getByText('2 首作品').waitFor();
    assert.equal(await page.locator('.local-result').count(), 2);
    await page.getByText('‹ 所有作者与歌手').click();
    await search.fill('爱随着光释放');
    await page
      .locator('.document-row')
      .first()
      .getByText(/爱随着光释放/)
      .waitFor();
    await search.fill('祂儿子名分中的恩典');
    await page.locator('.document-row').filter({has:page.getByText('044',{exact:true})}).first().getByTitle('打开 PDF').click();
    const img = page.locator('.clean-page img');
    await img.waitFor();
    await page.getByText('下一页', { exact: true }).click();
    await page.getByText('2 / 4', { exact: true }).waitFor();
    assert.ok((await img.evaluate((el) => el.naturalWidth)) > 1000);
    console.log(
      'Verified one artist with two songs, unified search, 60-row paging and score 44 page navigation.'
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
