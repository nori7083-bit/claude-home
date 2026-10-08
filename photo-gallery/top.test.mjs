import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTopArgs, renderTopHtml } from './top.mjs';
import { parseArgs, upsertEvent } from './build.mjs';

const kyoto = { name: '2026-10-kyoto', title: '京都大会', date: '2026-10-04', count: 1816, cover: 'thumbnails/DSC 1.jpg', url: 'https://2026-10-kyoto.pages.dev' };
const osaka = { name: '2026-06-osaka', title: '<大阪>大会', date: '2026-06-01', count: 900, cover: 'thumbnails/A.jpg', url: 'https://2026-06-osaka.pages.dev/' };

test('parseArgs: 日付を読み取り、形が違えばエラー', () => {
  assert.equal(parseArgs(['p', '--name', 'ab', '--date', '2026-10-04']).date, '2026-10-04');
  assert.match(parseArgs(['p', '--name', 'ab']).date, /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => parseArgs(['p', '--name', 'ab', '--date', '2026/10/4']));
});

test('upsertEvent: 同じサイト名は置き換え、別の名前は足す', () => {
  const updated = { ...kyoto, count: 2000 };
  assert.deepEqual(upsertEvent([kyoto, osaka], updated), [osaka, updated]);
  assert.deepEqual(upsertEvent([kyoto], osaka), [kyoto, osaka]);
});

test('parseTopArgs: 外す大会を複数指定できる', () => {
  const opts = parseTopArgs(['--name', 'nori-photos', '--remove', 'a', '--remove', 'b']);
  assert.deepEqual(opts.remove, ['a', 'b']);
  assert.throws(() => parseTopArgs(['--title', 'x']));
  assert.throws(() => parseTopArgs(['--name', 'nori-photos', 'extra']));
});

test('renderTopHtml: 新しい順に並び、文字や住所を安全に入れる', () => {
  const html = renderTopHtml('写真', [osaka, kyoto]);
  assert.ok(html.indexOf('京都大会') < html.indexOf('&lt;大阪&gt;大会'));
  assert.ok(html.includes('2026年10月4日'));
  assert.ok(html.includes('https://2026-10-kyoto.pages.dev/thumbnails/DSC%201.jpg'));
  assert.ok(html.includes('https://2026-06-osaka.pages.dev/thumbnails/A.jpg'));
  assert.ok(html.includes('1816枚'));
});

test('renderTopHtml: 大会がないときは案内を出す', () => {
  assert.ok(renderTopHtml('写真', []).includes('まだ大会がありません'));
});
