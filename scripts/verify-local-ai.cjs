// This integration check uses the real models and can download their weights on first use.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

async function main() {
  const models = process.argv.slice(2);
  if (!models.length || !models.every((model) => ['qwen', 'deepseek'].includes(model)))
    throw new Error('选择要测试的模型，例如 npm run verify:ai -- qwen deepseek');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'love-hymn-ai-test-'));
  let app;
  try {
    const executablePath = process.env.LOVE_HYMN_TEST_EXECUTABLE;
    const args = ['--user-data-dir=' + profile];
    if (!executablePath) args.unshift(path.resolve(__dirname, '../out/main/index.js'));
    app = await electron.launch({ executablePath, args });
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.api?.reviewLyrics === 'function');
    for (const model of models) {
      const result = await page.evaluate(async (model) => {
        const stages = new Set();
        const stop = window.api.onAiStage((value) => stages.add(value));
        try {
          const reply = await window.api.askLocalAi({
            model,
            messages: [{ role: 'user', content: '请用一句中文解释什么是合唱。' }]
          });
          const original = '我们一起哥唱\n\n在清晨仰望天空\n我们一起哥唱';
          const review = await window.api.reviewLyrics({ model, text: original });
          return { reply, review, stages: stages.size };
        } finally {
          stop();
        }
      }, model);
      assert.ok(result.reply.text?.trim(), JSON.stringify(result.reply));
      assert.doesNotMatch(result.reply.text, /<\/?think>/i);
      assert.ok(result.stages > 0);
      assert.equal(result.review.lines?.length, 4, JSON.stringify(result.review));
      assert.equal(result.review.lines[1], '');
      assert.equal(result.review.lines[0], result.review.lines[3]);
      console.log(model, JSON.stringify({ answer: result.reply.text, lines: result.review.lines }));
    }
    const canceled = await page.evaluate(async (model) => {
      const inFlight = window.api.askLocalAi({
        model,
        messages: [{ role: 'user', content: '请详细介绍合唱练习。' }]
      });
      await window.api.cancelAiReview();
      return inFlight;
    }, models[0]);
    assert.ok(canceled.canceled, JSON.stringify(canceled));
  } finally {
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
