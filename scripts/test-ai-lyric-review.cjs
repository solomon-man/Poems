const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { compileFunction } = require('node:vm');
const ts = require('typescript');

// Exercise the public API with deterministic model output, without loading a GGUF.
const source = fs.readFileSync(
  path.join(__dirname, '../src/main/modules/aiLyricReview.ts'),
  'utf8'
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
});
const load = compileFunction(outputText, ['require', 'exports']);
function reviewer(generateLocalText) {
  const api = {};
  load((id) => {
    assert.equal(id, './localAiEngine');
    return { generateLocalText };
  }, api);
  return api.reviewLyricLines;
}
const signal = new AbortController().signal;
const ignore = () => {};

test('corrects a homophone while retaining layout, punctuation, foreign words and duplicate refrains', async () => {
  let calls = 0;
  const stages = [];
  const review = reviewer(async (prompt, inputSignal, notify, model) => {
    assert.equal(inputSignal, signal);
    assert.equal(model, 'deepseek');
    assert.match(prompt, /1\|耶酥，我爱你。\n2\|主是我的光，Amen 2。$/u);
    notify('模型推理');
    calls++;
    return '<think>…</think>\n以下是校对结果\n1|耶稣,我爱你!\n2|主是我的光，Amen 2。';
  });
  assert.deepEqual(
    await review(
      '  耶酥，我爱你。  \r\n\r\n主是我的光，Amen 2。\r\n耶酥，我爱你。\r\n',
      signal,
      (s) => stages.push(s),
      'deepseek'
    ),
    ['  耶稣，我爱你。  ', '', '主是我的光，Amen 2。', '耶稣，我爱你。', '']
  );
  assert.equal(calls, 1);
  assert.ok(stages.some((stage) => stage.includes('模型推理')));
});

test('retains the original for invented lyrics, changed numbers and English words', async () => {
  const stages = [];
  const review = reviewer(
    async () => '1|一千个陌生的故事从山谷传来\n2|主爱，Psalm 225\n3|耶稣是我盼望'
  );
  const lines = await review('我的主爱我\n主爱，Psalm 22\n耶酥是我盼望', signal, (s) =>
    stages.push(s)
  );
  assert.deepEqual(lines, ['我的主爱我', '主爱，Psalm 22', '耶稣是我盼望']);
  assert.ok(stages.some((s) => s.includes('保留原词')));
});

test('rejects missing, duplicate, exchanged, or truncated model output', async () => {
  const source = '主是我的光\n主是你的光';
  for (const response of [
    '1|主是我的光',
    '1|主是我的光\n1|主是你的光',
    '2|主是你的光\n1|主是我的光',
    '1|主是你的光\n2|主是我的光',
    '主是你的光\n主是我的光',
    '<think>推理中'
  ]) {
    await assert.rejects(reviewer(async () => response)(source, signal, ignore), /逐行对齐/u);
  }
});

test('reassembles long lines and retains earlier successful batches on malformed output', async () => {
  const long = '哈利路亚'.repeat(85) + '𠮷';
  let calls = 0;
  const review = reviewer(async (prompt) => {
    const rows = prompt.split('\n').filter((line) => /^\d+\|/u.test(line));
    assert.ok(rows.length <= 8);
    assert.ok(
      rows.reduce((total, row) => total + [...row.replace(/^\d+\|/u, '')].length, 0) <= 210
    );
    return ++calls === 2 ? '格式损坏' : rows.join('\n').replace('耶酥', '耶稣');
  });
  const result = await review('耶酥爱我\n' + long, signal, ignore);
  assert.ok(calls >= 2);
  assert.deepEqual(result, ['耶稣爱我', long]);
});

test('accepts conservative unnumbered responses and preserves empty or non-Chinese input', async () => {
  const review = reviewer(async () => '["耶稣爱我", "赐我平安"]');
  assert.deepEqual(await review('耶酥爱我\n赐我平安', signal, ignore), ['耶稣爱我', '赐我平安']);
  const silent = reviewer(() => assert.fail('unexpected inference'));
  assert.deepEqual(await silent('   \nAmazing grace\n', signal, ignore), [
    '   ',
    'Amazing grace',
    ''
  ]);
  assert.deepEqual(await silent('', signal, ignore), ['']);
  await assert.rejects(silent('你'.repeat(200001), signal, ignore), /20 万/u);
});

test('propagates engine errors and cancels before returning a partial result', async () => {
  const controller = new AbortController();
  await assert.rejects(
    reviewer(async () => {
      controller.abort();
      return '1|耶稣爱我';
    })('耶酥爱我', controller.signal, ignore),
    { name: 'AbortError' }
  );
  await assert.rejects(
    reviewer(() => assert.fail('unexpected inference'))('歌词', controller.signal, ignore),
    { name: 'AbortError' }
  );
  await assert.rejects(
    reviewer(async () => {
      throw new Error('本地模型不可用');
    })('耶酥爱我', signal, ignore),
    /本地模型不可用/u
  );
});
