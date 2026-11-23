const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const sampleLines = ['在清晨我们一起歌唱', '在夜晚我们仰望星光'];

async function makePdf(app, destination, scanned) {
  const bytes = await app.evaluate(
    async ({ BrowserWindow }, { lines, scanned }) => {
      const win = new BrowserWindow({ show: false });
      try {
        await win.loadURL('about:blank');
        await win.webContents.executeJavaScript(`(async () => {
        const lines = ${JSON.stringify(lines)};
        document.body.style.font = '30px "Microsoft YaHei", sans-serif';
        ${
          scanned
            ? `const canvas = document.createElement('canvas');
        canvas.width = 1100; canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1100, 200);
        ctx.fillStyle = 'black'; ctx.font = '44px "Microsoft YaHei", sans-serif';
        lines.forEach((line,i) => ctx.fillText(line, 48, 75 + 75*i));
        const img = new Image(); img.width = 650; img.src = canvas.toDataURL();
        await img.decode(); document.body.append(img);`
            : `for (const line of lines) {
          const p = document.createElement('p'); p.textContent = line; document.body.append(p);
        }`
        }
      })()`);
        return [...(await win.webContents.printToPDF({ printBackground: true }))];
      } finally {
        win.destroy();
      }
    },
    { lines: sampleLines, scanned }
  );
  await fs.writeFile(destination, Buffer.from(bytes));
}

async function selectFile(app, file) {
  await app.evaluate(({ dialog }, choice) => {
    dialog.showOpenDialog = async () => ({ canceled: !choice, filePaths: choice ? [choice] : [] });
  }, file);
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'love-hymn-lyrics-'));
  let app;
  try {
    const executable = process.env.LOVE_HYMN_TEST_EXECUTABLE;
    const args = ['--user-data-dir=' + profile];
    if (!executable) args.unshift(path.join(root, 'out', 'main', 'index.js'));
    app = await electron.launch({ executablePath: executable, args });
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.api?.recognizeLyrics === 'function');
    await selectFile(app, '');
    assert.ok(
      (await page.evaluate(() => window.api.recognizeLyrics({ source: 'audio' }))).canceled
    );
    const textPdf = path.join(profile, '001.pdf');
    const scanPdf = path.join(profile, '扫描歌谱.pdf');
    await makePdf(app, textPdf, false);
    await makePdf(app, scanPdf, true);

    for (const file of [textPdf, scanPdf]) {
      await selectFile(app, file);
      const result = await page.evaluate(() => window.api.recognizeLyrics({ source: 'pdf' }));
      assert.equal(result.timing, 'none', JSON.stringify(result));
      assert.match(result.text, /清晨/);
      assert.match(result.text, /星光/);
    }

    const book = await page.evaluate(() => window.api.createCustomHymnBook('歌词识别测试'));
    await selectFile(app, textPdf);
    await page.evaluate((id) => window.api.importCustomHymnPdfs(id), book.id);
    const id = await page.evaluate(
      async (bookId) =>
        (await window.api.listHymnDocuments()).documents.find((doc) => doc.bookId === bookId).id,
      book.id
    );
    const result = await page.evaluate(
      (documentId) => window.api.recognizeLyrics({ source: 'pdf', documentId }),
      id
    );
    assert.match(result.text, /清晨/);

    const manifestFile = path.join(profile, 'CustomHymnLibrary', 'library.json');
    const vocal = process.env.LOVE_HYMN_TEST_VOCAL;
    const audio = vocal || path.join(root, 'test-fixtures', 'test-hymn.wav');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    manifest.audioLinks[id] = { path: audio, duration: 10000, title: '001', artist: '测试' };
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    const playback = await page.evaluate((id) => window.api.getHymnPlayback(id), id);
    assert.match(playback.lyrics, /^\[\d+:\d+\.\d+\].*清晨/m);
    const estimated = await page.evaluate(
      (documentId) => window.api.recognizeLyrics({ source: 'pdf', documentId }),
      id
    );
    assert.equal(estimated.timing, 'estimated');
    // 0.2 PDF results have only "source" and "lines". The first correction must keep their timing.
    const prior = await page.evaluate((id) => window.api.getRecognizedLyrics(id), id);
    assert.equal(prior.text, estimated.text);
    const lines = prior.text.split('\n');
    lines[0] = '清晨歌唱';
    const edit = { documentId: id, originalText: prior.text, originalLrc: prior.lrc, lines };
    const changed = await page.evaluate((edit) => window.api.applyLyricsReview(edit), edit);
    assert.equal(changed.text, lines.join('\n'));
    assert.deepEqual(changed.lrc.match(/^\[[^\]]+\]/gm), prior.lrc.match(/^\[[^\]]+\]/gm));
    const stale = await page.evaluate((edit) => window.api.applyLyricsReview(edit), edit);
    assert.ok(stale.message, 'An obsolete suggestion must not overwrite saved lyrics');
    assert.equal(
      (await page.evaluate((id) => window.api.getHymnPlayback(id), id)).lyrics,
      changed.lrc
    );
    let lrc = changed.lrc;
    if (vocal) {
      const timed = await page.evaluate(
        (documentId) => window.api.recognizeLyrics({ source: 'audio', documentId }),
        id
      );
      assert.equal(timed.timing, 'recognized', JSON.stringify(timed));
      assert.ok(timed.text.trim());
      assert.match(timed.lrc, /^\[\d+:\d+\.\d+\]/m);
      assert.equal(
        (await page.evaluate((id) => window.api.getHymnPlayback(id), id)).lyrics,
        timed.lrc
      );
      const selected = timed.text.split('\n');
      selected[0] += '。';
      const accepted = await page.evaluate((edit) => window.api.applyLyricsReview(edit), {
        documentId: id,
        originalText: timed.text,
        originalLrc: timed.lrc,
        lines: selected
      });
      assert.deepEqual(accepted.lrc.match(/^\[[^\]]+\]/gm), timed.lrc.match(/^\[[^\]]+\]/gm));
      assert.equal(
        (await page.evaluate((id) => window.api.getHymnPlayback(id), id)).lyrics,
        accepted.lrc
      );
      lrc = accepted.lrc;
    }
    const dest = path.join(profile, '导出.lrc');
    await app.evaluate(({ dialog }, dest) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: dest });
    }, dest);
    assert.ok(await page.evaluate((lrc) => window.api.saveRecognizedLyrics(lrc, 'lrc'), lrc));
    assert.equal(await fs.readFile(dest, 'utf8'), lrc);
    console.log(
      'Passed: file selection, text PDF, scanned PDF, saved lyrics, estimated timing, playback, LRC export' +
        (vocal ? ', audio transcription' : '')
    );
  } finally {
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
