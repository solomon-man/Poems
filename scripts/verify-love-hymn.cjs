const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const mainEntry = path.join(root, 'out', 'main', 'index.js');
const musicDirectory = path.join(root, 'test-fixtures');
const fixture = path.join(musicDirectory, 'test-hymn.wav');
const artifacts = path.join(root, 'test-artifacts');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(check, timeout = 10000, interval = 100) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw lastError || new Error(`Condition not met within ${timeout}ms`);
}

function readStorage(page, key) {
  return page.evaluate((storageKey) => {
    const value = localStorage.getItem(storageKey);
    return value ? JSON.parse(value) : null;
  }, key);
}

async function launch(profile) {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LOVE_HYMN_TEST_MUSIC_DIR: musicDirectory
    }
  });
}

async function openAdvancedOption(page, index) {
  await page.locator('.advanced-controls-btn').hover();
  const options = page.locator('.n-dropdown-option');
  await options.nth(index).waitFor({ state: 'visible' });
  await options.nth(index).click();
}

function attachPageDiagnostics(page, errors) {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
}

async function findPiniaStore(page, storeId) {
  return page.evaluate((id) => {
    const appElement = document.querySelector('#app');
    const vueApp = appElement && appElement.__vue_app__;
    if (!vueApp) return false;
    const pinia = Reflect.ownKeys(vueApp._context.provides)
      .map((key) => vueApp._context.provides[key])
      .find((value) => value && value._s instanceof Map);
    return Boolean(pinia && pinia._s.has(id));
  }, storeId);
}

async function auditPrimarySession(profile, result) {
  const app = await launch(profile);
  const errors = [];
  try {
    const page = await app.firstWindow();
    attachPageDiagnostics(page, errors);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    assert.equal(await page.title(), 'Poems');

    await page.locator('.empty-state button').click();
    await page.getByText('test-hymn', { exact: true }).first().waitFor({ timeout: 15000 });
    assert.match(await page.locator('body').innerText(), /1 首歌曲/);

    await page.locator('.song-item-operating-play').click();
    await waitFor(async () =>
      (await page.locator('.music-buttons-play i').getAttribute('class'))?.includes('icon-stop')
    );

    const playerState = await waitFor(async () => {
      const state = await readStorage(page, 'player-core-store');
      return state?.playMusic?.id ? state : null;
    });
    const historyState = await waitFor(async () => {
      const state = await readStorage(page, 'play-history-store');
      return state?.musicHistory?.length ? state : null;
    });
    const localSongId = playerState.playMusic.id;
    assert.equal(playerState.playMusic.source, 'local');
    assert.equal(historyState.musicHistory[0].id, localSongId);
    assert.equal(historyState.musicHistory[0].source, 'local');

    await page.locator('.audio-button .ri-heart-3-line').click();
    await waitFor(async () => (await readStorage(page, 'favoriteList'))?.includes(localSongId));
    const favoriteDetails = await readStorage(page, 'favoriteSongDetails');
    assert.equal(favoriteDetails[localSongId].name, 'test-hymn');

    await page.locator('a[href="#/history"]').click();
    await page.getByText('test-hymn', { exact: true }).first().waitFor();
    await page.locator('a[href="#/favorite"]').click();
    await page.getByText('test-hymn', { exact: true }).first().waitFor();

    const shortcutConfig = await page.evaluate(() =>
      window.electron.ipcRenderer.invoke('shortcuts:get-config')
    );
    assert.ok(Object.values(shortcutConfig).some((item) => item.scope === 'global'));
    assert.ok(Object.values(shortcutConfig).some((item) => item.scope === 'app'));
    shortcutConfig.toggleFavorite = {
      ...shortcutConfig.toggleFavorite,
      key: 'CommandOrControl+Alt+K',
      scope: 'app'
    };
    const shortcutSave = await page.evaluate(
      (config) => window.electron.ipcRenderer.invoke('shortcuts:save', config),
      shortcutConfig
    );
    assert.equal(shortcutSave.ok, true);
    assert.equal(shortcutSave.validation.shortcuts.toggleFavorite.key, 'CommandOrControl+Alt+K');

    await page.locator('a[href="#/set"]').click();
    const themeItem = page.locator('.setting-item').filter({ hasText: '主题模式' });
    await themeItem.locator('.n-switch').nth(1).click();
    await waitFor(() => page.locator('html').evaluate((element) => element.classList.contains('dark')));
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'electron-dark.png') });

    await page.getByText('应用设置', { exact: true }).first().click();
    const shortcutItem = page.locator('.setting-item').filter({ hasText: '快捷键' });
    await shortcutItem.locator('button').click();
    await page.locator('.shortcut-modal .shortcut-row').first().waitFor();
    assert.equal(await page.locator('.shortcut-modal .shortcut-row').count(), 7);
    await page.keyboard.press('Escape');

    await page.locator('a[href="#/"]').click();
    await page.getByText('test-hymn', { exact: true }).first().waitFor();

    await openAdvancedOption(page, 0);
    const eq = page.locator('.eq-control');
    await eq.waitFor();
    const eqSwitch = eq.locator('[role="switch"]');
    if ((await eqSwitch.getAttribute('aria-checked')) === 'true') {
      await eqSwitch.click();
      await waitFor(async () => (await eqSwitch.getAttribute('aria-checked')) === 'false');
    }
    await eqSwitch.click();
    await waitFor(async () => (await eqSwitch.getAttribute('aria-checked')) === 'true');
    await eq.locator('.eq-presets .n-tag').nth(2).click();
    await waitFor(async () => (await page.evaluate(() => localStorage.getItem('currentPreset'))) !== 'flat');
    await waitFor(async () => (await page.evaluate(() => localStorage.getItem('eqBypass'))) === 'false');
    const eqSettings = await readStorage(page, 'eqSettings');
    assert.ok(Object.values(eqSettings).some((gain) => Number(gain) !== 0));
    await page.locator('.eq-modal-content .modal-close').click();

    await openAdvancedOption(page, 2);
    await page.locator('.speed-option').filter({ hasText: '1.5x' }).click();
    await waitFor(async () => (await readStorage(page, 'player-core-store')).playbackRate === 1.5);
    await page.locator('.speed-modal-content .modal-close').click();

    await openAdvancedOption(page, 1);
    const timer = page.locator('.sleep-timer-content');
    await timer.waitFor();
    await timer.locator('.option-section').first().locator('button').first().click();
    await waitFor(async () => (await readStorage(page, 'sleepTimer')).type === 'scheduled-play');
    await waitFor(async () =>
      (await page.locator('.music-buttons-play i').getAttribute('class'))?.includes('icon-play')
    );

    assert.equal(await findPiniaStore(page, 'sleepTimer'), true);
    await page.evaluate(() => {
      const vueApp = document.querySelector('#app').__vue_app__;
      const pinia = Reflect.ownKeys(vueApp._context.provides)
        .map((key) => vueApp._context.provides[key])
        .find((value) => value && value._s instanceof Map);
      pinia._s.get('sleepTimer').sleepTimer.endTime = Date.now() + 500;
    });
    await waitFor(async () => (await readStorage(page, 'sleepTimer')).type === 'none', 8000);
    await waitFor(async () =>
      (await page.locator('.music-buttons-play i').getAttribute('class'))?.includes('icon-stop')
    );
    await page.locator('.timer-modal-content .modal-close').click();
    await page.locator('.timer-modal-content').waitFor({ state: 'hidden' });

    await page.locator('.play-bar-img-wrapper').click();
    await page.locator('#drawer-target').waitFor();
    await page.screenshot({ path: path.join(artifacts, 'electron-immersive-audit.png') });
    await page.locator('#drawer-target .control-left').click();

    const lyricWindowPromise = app.waitForEvent('window', {
      predicate: (window) => window.url().includes('#/lyric'),
      timeout: 10000
    });
    await page.locator('.audio-button .ri-netease-cloud-music-line').click();
    const lyricWindow = await lyricWindowPromise;
    await lyricWindow.waitForLoadState('domcontentloaded');
    assert.ok(lyricWindow.url().includes('#/lyric'));
    await lyricWindow.screenshot({ path: path.join(artifacts, 'electron-desktop-lyric.png') });
    await lyricWindow.close();

    if (
      (await page.locator('.music-buttons-play i').getAttribute('class'))?.includes('icon-play')
    ) {
      await page.locator('.music-buttons-play').click();
      await waitFor(async () =>
        (await page.locator('.music-buttons-play i').getAttribute('class'))?.includes('icon-stop')
      );
    }

    const port = await getFreePort();
    await page.evaluate(
      ({ remotePort }) => {
        window.electron.ipcRenderer.send('update-remote-control-config', {
          enabled: true,
          port: remotePort,
          allowedIps: []
        });
      },
      { remotePort: port }
    );
    const remoteStatus = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (!response.ok) return null;
      const status = await response.json();
      return status.currentSong?.name === 'test-hymn' ? status : null;
    });
    assert.equal(remoteStatus.currentSong.name, 'test-hymn');
    const playIconClass = await page.locator('.music-buttons-play i').getAttribute('class');
    const rendererPlaying = Boolean(playIconClass?.includes('icon-stop'));
    assert.equal(
      remoteStatus.isPlaying,
      rendererPlaying,
      `Remote status mismatch: remote=${remoteStatus.isPlaying}, icon=${playIconClass}`
    );

    await fetch(`http://127.0.0.1:${port}/api/toggle-play`, { method: 'POST' });
    await waitFor(async () => {
      const currentClass = await page.locator('.music-buttons-play i').getAttribute('class');
      return rendererPlaying
        ? currentClass?.includes('icon-play')
        : currentClass?.includes('icon-stop');
    });
    await page.waitForTimeout(350);
    await fetch(`http://127.0.0.1:${port}/api/toggle-play`, { method: 'POST' });
    await waitFor(async () => {
      const currentClass = await page.locator('.music-buttons-play i').getAttribute('class');
      return rendererPlaying
        ? currentClass?.includes('icon-stop')
        : currentClass?.includes('icon-play');
    });

    const trayState = await page.evaluate(() =>
      window.electron.ipcRenderer.invoke('tray:get-state')
    );
    assert.equal(trayState.initialized, true);
    assert.ok(trayState.menuLabels.length >= 6);
    assert.ok(trayState.menuLabels.some((label) => label.includes('test-hymn')));

    await page.evaluate(() => window.api.miniTray());
    await waitFor(() =>
      app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible())
    );
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
    });

    await page.evaluate(() =>
      window.electron.ipcRenderer.send('update-remote-control-config', {
        enabled: false,
        port: 31888,
        allowedIps: []
      })
    );

    assert.deepEqual(errors, []);
    Object.assign(result, {
      songId: localSongId,
      history: true,
      favorite: true,
      shortcuts: true,
      theme: 'dark',
      eqPreset: await page.evaluate(() => localStorage.getItem('currentPreset')),
      playbackRate: 1.5,
      scheduledPlayback: true,
      immersiveLyrics: true,
      desktopLyrics: true,
      remoteControlPort: port,
      tray: true
    });
  } finally {
    await app.close();
  }
}

async function auditPersistenceAndMiniMode(profile, result) {
  const app = await launch(profile);
  const errors = [];
  try {
    const page = await app.firstWindow();
    attachPageDiagnostics(page, errors);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    await page.getByText('test-hymn', { exact: true }).first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator('html').evaluate((element) => element.classList.contains('dark')), true);

    await page.locator('a[href="#/favorite"]').click();
    await page.getByText('test-hymn', { exact: true }).first().waitFor();
    await page.locator('a[href="#/history"]').click();
    await page.getByText('test-hymn', { exact: true }).first().waitFor();

    await page.locator('.ri-picture-in-picture-line').click();
    await waitFor(() => page.url().includes('#/mini'));
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    assert.ok(bounds.width >= 300 && bounds.width <= 380, `Unexpected mini width: ${bounds.width}`);
    assert.ok(bounds.height >= 55 && bounds.height <= 430, `Unexpected mini height: ${bounds.height}`);
    await page.screenshot({ path: path.join(artifacts, 'electron-mini-audit.png') });

    assert.deepEqual(errors, []);
    result.persistence = true;
    result.miniMode = bounds;
  } finally {
    await app.close();
  }
}

(async () => {
  assert.ok(fs.existsSync(mainEntry), `Build output not found: ${mainEntry}`);
  assert.ok(fs.existsSync(fixture), `Audio fixture not found: ${fixture}`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'love-hymn-e2e-'));
  try {
    const result = {};
    await auditPrimarySession(profile, result);
    await auditPersistenceAndMiniMode(profile, result);
    console.log(JSON.stringify({ ok: true, artifacts, ...result }, null, 2));
  } finally {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
