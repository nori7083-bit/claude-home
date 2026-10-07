import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, outputNames, renderHtml } from './build.mjs';

test('parseArgs: 写真フォルダとサイト名を読み取る', () => {
  const opts = parseArgs(['photos', '--name', '2026-10-kyoto', '--title', '競技写真']);
  assert.equal(opts.src, 'photos');
  assert.equal(opts.name, '2026-10-kyoto');
  assert.equal(opts.title, '競技写真');
  assert.equal(opts.out, 'dist');
});

test('parseArgs: サイト名に使えない文字はエラー', () => {
  assert.throws(() => parseArgs(['photos', '--name', 'Kyoto大会']));
  assert.throws(() => parseArgs(['photos']));
  assert.throws(() => parseArgs(['--name', 'abc']));
});

test('outputNames: 拡張子違いの同名ファイルが上書きされない', () => {
  assert.deepEqual(
    outputNames(['A.JPG', 'A.png', 'B.jpeg']),
    ['A.jpg', 'A_2.jpg', 'B.jpg'],
  );
});

test('renderHtml: 題名とファイル名の特殊な文字がページを壊さない', () => {
  const html = renderHtml('<script>$&', [
    { filename: '</script>$&.jpg', src: 'images/x.jpg', thumb: 'thumbnails/x.jpg', aspect: 1.5 },
  ]);
  assert.ok(html.includes('<title>&lt;script&gt;$&amp;</title>'));
  assert.ok(html.includes('\\u003c/script>$&.jpg'));
  assert.ok(html.includes('全1枚'));
  assert.ok(!html.includes('__IMAGES__'));
});
