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
  assert.ok(!html.includes('__COUNT__'));
  assert.ok(!html.includes('__TITLE__'));
});

test('renderHtml: 曲があるときだけ曲の名前をページに入れる', () => {
  const imgs = [{ filename: 'a.jpg', src: 'images/a.jpg', thumb: 'thumbnails/a.jpg', aspect: 1 }];
  assert.ok(renderHtml('t', imgs, 'music.mp3').includes('const MUSIC = "music.mp3";'));
  assert.ok(renderHtml('t', imgs).includes('const MUSIC = null;'));
  assert.ok(!renderHtml('t', imgs).includes('__MUSIC__'));
});

test('parseArgs: 曲は決まった形式だけ受け付ける', () => {
  assert.equal(parseArgs(['p', '--name', 'ab', '--music', 'song.MP3']).music, 'song.MP3');
  assert.throws(() => parseArgs(['p', '--name', 'ab', '--music', 'song.mid']));
});

test('秒数: 書かなければ1.5秒、ページには ミリ秒で入る', () => {
  assert.equal(parseArgs(['p', '--name', 'ab']).seconds, 1.5);
  assert.equal(parseArgs(['p', '--name', 'ab', '--seconds', '3']).seconds, 3);
  assert.throws(() => parseArgs(['p', '--name', 'ab', '--seconds', 'abc']));
  assert.throws(() => parseArgs(['p', '--name', 'ab', '--seconds', '0.1']));
  const imgs = [{ filename: 'a.jpg', src: 'images/a.jpg', thumb: 'thumbnails/a.jpg', aspect: 1 }];
  assert.ok(renderHtml('t', imgs, null, 1.5).includes('let SLIDE_MS = 1500;'));
});
