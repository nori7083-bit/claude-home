// 写真フォルダから、写真一覧ページ（index.html）と縮小した写真を作る。
// 使い方: node build.mjs <写真フォルダ> --name <サイト名> [--title <ページの題名>] [--date <YYYY-MM-DD>] [--music <曲のファイル>] [--seconds <1枚の秒数>] [--out <出力先>]
import { copyFile, readdir, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 大会の一覧（トップページの材料）。道具のフォルダに置く
export const EVENTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'events.json');
// トップページの住所と題名。大会ページの「戻る」ボタンに使う（トップページを作ると記録される）
export const SITE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gallery.json');

// 大きい写真の長い辺。スマホやパソコンで見るには十分で、1枚あたり数百KBに収まる
const FULL_LONG_EDGE = 2400;
const FULL_QUALITY = 82;
// 一覧の見本は高さ180pxで並べるので、きれいに見えるよう2倍で作る
const THUMB_HEIGHT = 360;
const THUMB_QUALITY = 70;
// iPhone の写真（HEIC）は sharp では読めないので、Mac に最初から入っている sips で JPEG に直してから使う
const HEIC_EXTS = new Set(['.heic', '.heif']);
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', ...HEIC_EXTS]);
// Cloudflare Pages のプロジェクト名に使える形（英小文字・数字・ハイフン）
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// スライドショーで流せる曲の形式（どのブラウザでも鳴りやすいもの）
const MUSIC_EXTS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wav']);

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseArgs(argv) {
  const opts = { title: '競技写真', out: 'dist', date: today(), seconds: 1.5 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '--title' || a === '--out' || a === '--date' || a === '--music' || a === '--seconds') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} のあとに値を書いてください`);
      opts[a.slice(2)] = value;
    } else {
      rest.push(a);
    }
  }
  if (rest.length !== 1) throw new Error('写真フォルダを1つだけ指定してください');
  opts.src = rest[0];
  if (!opts.name) throw new Error('--name でサイト名を指定してください（例: --name 2026-10-kyoto）');
  if (!NAME_PATTERN.test(opts.name)) {
    throw new Error('サイト名は英小文字・数字・ハイフンだけで、2〜58文字にしてください（例: 2026-10-kyoto）');
  }
  if (!DATE_PATTERN.test(opts.date)) throw new Error('--date は 2026-10-04 のような形で書いてください');
  if (opts.music && !MUSIC_EXTS.has(path.extname(opts.music).toLowerCase())) {
    throw new Error('--music には mp3・m4a・aac・ogg・wav のどれかの曲を指定してください');
  }
  opts.seconds = Number(opts.seconds);
  if (!(opts.seconds >= 0.5 && opts.seconds <= 30)) throw new Error('--seconds は 0.5〜30 の数で書いてください（例: --seconds 1.5）');
  return opts;
}

// DSC00002 が DSC00010 より前に来るよう、数字を数として比べる
const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

export async function listPhotos(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && !e.name.startsWith('.') && PHOTO_EXTS.has(path.extname(e.name).toLowerCase()))
    .map(e => e.name)
    .sort(collator.compare);
}

// 出力はすべてJPEGにそろえる。拡張子だけ違う同名の写真は、番号を付けて上書きを防ぐ
export function outputNames(files) {
  const used = new Set();
  return files.map(f => {
    const base = path.basename(f, path.extname(f));
    let name = `${base}.jpg`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}.jpg`;
    used.add(name.toLowerCase());
    return name;
  });
}

async function isUpToDate(srcPath, outPaths) {
  if (!outPaths.every(p => existsSync(p))) return false;
  const srcTime = (await stat(srcPath)).mtimeMs;
  for (const p of outPaths) {
    if ((await stat(p)).mtimeMs < srcTime) return false;
  }
  return true;
}

const execFileAsync = promisify(execFile);

async function convertHeic(srcPath, workDir) {
  if (process.platform !== 'darwin') {
    throw new Error(`HEIC の写真は Mac でだけ変換できます: ${path.basename(srcPath)}`);
  }
  const out = path.join(workDir, `${path.basename(srcPath)}.jpg`);
  await execFileAsync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', srcPath, '--out', out]);
  return out;
}

async function processPhoto(sharp, srcPath, fullPath, thumbPath, workDir) {
  const isHeic = HEIC_EXTS.has(path.extname(srcPath).toLowerCase());
  const input = isHeic ? await convertHeic(srcPath, workDir) : srcPath;
  try {
    return await resizePhoto(sharp, input, fullPath, thumbPath);
  } finally {
    if (isHeic) await rm(input, { force: true });
  }
}

async function resizePhoto(sharp, input, fullPath, thumbPath) {
  // rotate() はカメラが記録した向きの情報どおりに回す。縦位置の写真が横倒しにならないように
  const base = sharp(input).rotate();
  const full = await base.clone()
    .resize(FULL_LONG_EDGE, FULL_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: FULL_QUALITY, mozjpeg: true })
    .toFile(fullPath);
  await base.clone()
    .resize({ height: THUMB_HEIGHT, withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toFile(thumbPath);
  return full;
}

export async function removeStale(dirs, keep) {
  let removed = 0;
  for (const dir of dirs) {
    for (const name of await readdir(dir)) {
      if (keep.has(name)) continue;
      await rm(path.join(dir, name), { force: true });
      if (dir === dirs[0]) removed++;
    }
  }
  return removed;
}

// 曲は music.mp3 のような名前で、ページと同じ場所に置く。前に入れた曲は消して入れ替える
async function placeMusic(src, outDir) {
  for (const name of await readdir(outDir)) {
    if (/^music\.[a-z0-9]+$/i.test(name)) await rm(path.join(outDir, name), { force: true });
  }
  if (!src) return null;
  const srcPath = path.resolve(src);
  if (!existsSync(srcPath)) throw new Error(`曲のファイルが見つかりませんでした: ${srcPath}`);
  const name = `music${path.extname(srcPath).toLowerCase()}`;
  await copyFile(srcPath, path.join(outDir, name));
  return name;
}

async function readSize(sharp, file) {
  const meta = await sharp(file).metadata();
  return { width: meta.width, height: meta.height };
}

// 同時に処理する枚数。パソコンが固まらない程度に並べて進める
async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

export function renderHtml(title, images, music = null, seconds = 1.5, back = null) {
  const data = JSON.stringify(images).replace(/</g, '\\u003c');
  // 置き換えは関数で渡す。ファイル名に「$」があっても特別な記号として扱われないように
  return TEMPLATE
    .replaceAll('__TITLE__', () => escapeHtml(title))
    .replaceAll('__COUNT__', () => String(images.length))
    .replace('__IMAGES__', () => data)
    .replace('__MUSIC__', () => JSON.stringify(music))
    .replace('__SLIDE_MS__', () => String(Math.round(seconds * 1000)))
    .replace('__BACK__', () => back
      ? `<div class="back-link"><a href="${escapeHtml(back.url)}">← ${escapeHtml(back.title)}に戻る</a></div>`
      : '');
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function readEvents(file = EVENTS_FILE) {
  if (!existsSync(file)) return [];
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function readSite(file = SITE_FILE) {
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeSite(site, file = SITE_FILE) {
  await writeFile(file, JSON.stringify(site, null, 2) + '\n');
}

export async function writeEvents(events, file = EVENTS_FILE) {
  await writeFile(file, JSON.stringify(events, null, 2) + '\n');
}

// 同じサイト名の大会は上書きする。作り直したときに一覧で重ならないように
export function upsertEvent(events, entry) {
  return [...events.filter(e => e.name !== entry.name), entry];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const srcDir = path.resolve(opts.src);
  const outDir = path.resolve(opts.out, opts.name);
  const imagesDir = path.join(outDir, 'images');
  const thumbsDir = path.join(outDir, 'thumbnails');

  const files = await listPhotos(srcDir);
  if (files.length === 0) throw new Error(`写真が見つかりませんでした: ${srcDir}`);
  const names = outputNames(files);
  await mkdir(imagesDir, { recursive: true });
  await mkdir(thumbsDir, { recursive: true });

  const { default: sharp } = await import('sharp');
  const images = new Array(files.length);
  let done = 0;
  let skipped = 0;
  const workDir = await mkdtemp(path.join(tmpdir(), 'photo-gallery-'));

  console.log(`${files.length}枚の写真を処理します…`);
  try {
    await runPool(files, Math.max(1, cpus().length - 1), async (file, i) => {
      const srcPath = path.join(srcDir, file);
      const fullPath = path.join(imagesDir, names[i]);
      const thumbPath = path.join(thumbsDir, names[i]);
      let size;
      // 2回目以降は、変わっていない写真の縮小を飛ばして時間を短くする
      if (await isUpToDate(srcPath, [fullPath, thumbPath])) {
        size = await readSize(sharp, fullPath);
        skipped++;
      } else {
        size = await processPhoto(sharp, srcPath, fullPath, thumbPath, workDir);
      }
      images[i] = {
        filename: names[i],
        src: `images/${names[i]}`,
        thumb: `thumbnails/${names[i]}`,
        aspect: Math.round((size.width / size.height) * 1000) / 1000,
      };
      done++;
      if (done % 50 === 0 || done === files.length) {
        process.stdout.write(`\r  ${done} / ${files.length} 枚`);
      }
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  process.stdout.write('\n');

  // 元のフォルダから外した写真の縮小版を消す。残すと公開し直したときにいっしょに送られてしまう
  const removed = await removeStale([imagesDir, thumbsDir], new Set(names));
  if (removed) console.log(`外された写真${removed}枚の縮小版を消しました`);

  const music = await placeMusic(opts.music, outDir);
  await writeFile(path.join(outDir, 'index.html'), renderHtml(opts.title, images, music, opts.seconds, await readSite()));

  // トップページに並べるため、大会の情報を控えておく
  const events = await readEvents();
  await writeEvents(upsertEvent(events, {
    name: opts.name,
    title: opts.title,
    date: opts.date,
    count: images.length,
    cover: images[0].thumb,
    url: events.find(e => e.name === opts.name)?.url ?? `https://${opts.name}.pages.dev`,
  }));

  const relOut = path.relative(process.cwd(), outDir) || '.';
  console.log(`できあがり: ${relOut}/index.html（${files.length}枚${skipped ? `、うち${skipped}枚は前回のものを再利用` : ''}）`);
  console.log('');
  console.log('公開するには、次の1行をターミナルに貼り付けてください:');
  console.log(`  npx wrangler pages deploy "${relOut}" --project-name ${opts.name}`);
}

const TEMPLATE = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>__TITLE__</title>
<style>
  :root {
    --primary: #4B6CB7; --primary-dark: #2E4A8E;
    --text-dark: #0F172A; --text-light: #6B7280;
    --bg-page: #f0f4f8; --bg-white: #fff; --bg-blue: #EEF2FF; --border: #E2E8F0;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", Meiryo, sans-serif;
    background-color: var(--bg-page); color: var(--text-dark); margin: 0; padding: 24px 16px 40px; line-height: 1.6;
  }
  h1 {
    max-width: 1400px; margin: 0 auto 4px; font-size: 1.2rem; font-weight: 800;
    border-left: 4px solid var(--primary); padding-left: 12px; line-height: 1.35;
  }
  .back-link { max-width: 1400px; margin: 0 auto 14px; }
  .back-link a {
    display: inline-block; background-color: var(--bg-blue); color: var(--primary-dark); border: 1px solid #c7d2fe;
    padding: 6px 14px; border-radius: 100px; text-decoration: none; font-size: 0.8125rem; font-weight: 700; transition: all .15s;
  }
  .back-link a:hover { background-color: var(--primary); color: #fff; border-color: var(--primary); }
  .subtitle { max-width: 1400px; margin: 0 auto 14px; padding-left: 16px; font-size: 0.8125rem; color: var(--text-light); }

  .pagination { text-align: center; margin: 18px 0; display: flex; justify-content: center; align-items: center; gap: 12px; flex-wrap: wrap; }
  .pagination button {
    background-color: var(--bg-white); color: var(--primary-dark); border: 1px solid var(--border);
    padding: 7px 16px; font-size: 13px; font-weight: 700; border-radius: 6px; cursor: pointer; transition: all .15s;
  }
  .pagination button:hover { background-color: var(--bg-blue); border-color: var(--primary); }
  .pagination button:disabled { background-color: #f1f5f9; color: #cbd5e1; border-color: var(--border); cursor: not-allowed; }
  .page-info { font-size: 13px; display: flex; align-items: center; gap: 8px; color: var(--text-light); }
  select.page-jump {
    background-color: var(--bg-white); color: var(--text-dark); border: 1px solid var(--border);
    padding: 5px 8px; font-size: 13px; border-radius: 6px; cursor: pointer; outline: none;
  }

  .gallery { display: flex; flex-wrap: wrap; gap: 4px; max-width: 100%; }
  .gallery-item { height: 180px; cursor: pointer; position: relative; overflow: hidden; background-color: #e2e8f0; border-radius: 3px; }
  .gallery-item img { width: 100%; height: 100%; object-fit: cover; vertical-align: bottom; transition: opacity 0.2s; }
  .gallery-item:hover img { opacity: 0.75; }
  .gallery::after { content: ""; flex-grow: 999; min-width: 50%; }

  #modal {
    display: none; position: fixed; inset: 0;
    background: rgba(240,244,248,0.97); z-index: 1000; flex-direction: column; align-items: center; justify-content: center;
  }
  #modal-header {
    position: absolute; top: 0; left: 0; width: 100%; height: 56px;
    display: flex; justify-content: space-between; align-items: center;
    background: rgba(255,255,255,0.92); border-bottom: 1px solid var(--border);
    z-index: 2000; pointer-events: none;
  }
  #modal-filename { color: var(--text-light); font-size: 13px; padding-left: 20px; }
  #modal-tools { padding-right: 16px; display: flex; align-items: center; gap: 14px; pointer-events: auto; }
  #download-btn {
    background-color: var(--primary); color: #fff; padding: 6px 14px; border-radius: 100px;
    font-size: 13px; text-decoration: none; display: flex; align-items: center; gap: 6px;
    transition: background 0.15s; font-weight: 700; border: 1px solid var(--primary);
  }
  #download-btn:hover { background-color: var(--primary-dark); border-color: var(--primary-dark); }
  .tool-btn { color: var(--text-light); font-size: 22px; cursor: pointer; user-select: none; transition: color 0.15s; display: flex; align-items: center; }
  .tool-btn:hover { color: var(--text-dark); }

  #modal-img {
    max-width: 94%; max-height: 82%; object-fit: contain; z-index: 1001;
    background: #fff; border: 1px solid var(--border); box-shadow: 0 8px 28px rgba(75,108,183,0.18);
  }
  /* 大きい写真が届くまでは、見本を引き伸ばしてぼかして見せる */
  #modal-img.loading { filter: blur(12px); }
  #modal-loading {
    position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%);
    color: var(--primary-dark); font-size: 13px; font-weight: 700;
    background: rgba(255,255,255,.92); border: 1px solid var(--border);
    padding: 6px 16px; border-radius: 100px; z-index: 2001; display: none;
  }
  #modal-loading.show { display: block; }

  .nav-btn {
    position: absolute; top: 50%; transform: translateY(-50%); font-size: 34px; color: var(--primary-dark);
    width: 56px; height: 90px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; user-select: none; z-index: 2000; transition: background 0.15s;
    background: rgba(255,255,255,0.75);
  }
  .nav-btn:hover { background: #fff; }
  #prev-btn { left: 0; border-radius: 0 8px 8px 0; }
  #next-btn { right: 0; border-radius: 8px 0 0 8px; }


  /* スライドショー：写真をゆっくり動かしながら、ふわっと切り替えて自動で流す */
  .subtitle { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  #slideshow-btn {
    background: var(--primary); color: #fff; border: 1px solid var(--primary); border-radius: 100px;
    padding: 5px 14px; font-size: 13px; font-weight: 700; cursor: pointer; transition: background .15s;
  }
  #slideshow-btn:hover { background: var(--primary-dark); border-color: var(--primary-dark); }
  #slideshow { display: none; position: fixed; inset: 0; background: #000; z-index: 3000; overflow: hidden; cursor: none; --ss-dur: 2.2s; --ss-fade: 0.6s; }
  #slideshow.show { display: block; }
  #slideshow.controls-visible, #slideshow.paused { cursor: default; }
  .ss-slide { position: absolute; inset: 0; opacity: 0; transition: opacity var(--ss-fade) ease; }
  .ss-slide.active { opacity: 1; }
  .ss-bg { position: absolute; top: -60px; left: -60px; width: calc(100% + 120px); height: calc(100% + 120px); object-fit: cover; filter: blur(30px) brightness(0.45); }
  .ss-fg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; will-change: transform; }
  .ss-slide.kb .ss-fg { animation: ss-kenburns var(--ss-dur) ease-out forwards; }
  @keyframes ss-kenburns {
    from { transform: scale(var(--s0)) translate(var(--x0), var(--y0)); }
    to { transform: scale(var(--s1)) translate(var(--x1), var(--y1)); }
  }
  #slideshow.paused .ss-fg { animation-play-state: paused; }
  .ss-intro {
    position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #fff; text-align: center; padding: 24px; z-index: 2; pointer-events: none; opacity: 0;
    background: radial-gradient(ellipse at center, rgba(0,0,0,.55), rgba(0,0,0,0) 70%);
  }
  .ss-intro.play { animation: ss-intro 4.2s ease forwards; }
  .ss-intro-title { font-size: clamp(1.4rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: .04em; text-shadow: 0 2px 18px rgba(0,0,0,.6); }
  .ss-intro-sub { margin-top: 8px; font-size: 14px; opacity: .85; }
  @keyframes ss-intro { 0% { opacity: 0; transform: translateY(8px); } 20%, 70% { opacity: 1; transform: none; } 100% { opacity: 0; } }
  .ss-controls {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; display: flex; align-items: center; gap: 12px;
    padding: 28px 20px calc(18px + env(safe-area-inset-bottom)); color: #fff;
    background: linear-gradient(rgba(0,0,0,0), rgba(0,0,0,.65)); opacity: 0; transition: opacity .4s;
  }
  #slideshow.controls-visible .ss-controls, #slideshow.paused .ss-controls { opacity: 1; }
  .ss-btn {
    width: 46px; height: 46px; border-radius: 50%; border: 0; cursor: pointer; font-size: 17px; color: #fff;
    background: rgba(255,255,255,.16); display: flex; align-items: center; justify-content: center; transition: background .15s;
  }
  .ss-btn:hover { background: rgba(255,255,255,.3); }
  .ss-counter { margin-left: auto; font-size: 13px; opacity: .85; font-variant-numeric: tabular-nums; }
  .ss-speed { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 100px; background: rgba(255,255,255,.14); }
  .ss-speed-label { font-size: 12px; opacity: .8; padding: 0 6px 0 8px; }
  .ss-speed button {
    border: 0; border-radius: 100px; padding: 7px 11px; font-size: 13px; font-weight: 700; cursor: pointer;
    color: #fff; background: transparent; font-variant-numeric: tabular-nums; transition: background .15s, color .15s;
  }
  .ss-speed button:hover { background: rgba(255,255,255,.18); }
  .ss-speed button.on { background: #fff; color: #111; }
  @media (max-width: 600px) {
    .ss-controls { flex-wrap: wrap; gap: 8px; }
    .ss-btn { width: 40px; height: 40px; font-size: 15px; }
    .ss-speed { order: -1; width: 100%; justify-content: center; background: none; }
    .ss-speed button { background: rgba(255,255,255,.14); }
  }

  @media (max-width: 800px) {
    .gallery-item { height: 120px; }
    .nav-btn { font-size: 26px; width: 40px; }
    #download-btn { font-size: 12px; padding: 5px 12px; }
  }
</style>
</head>
<body>
  __BACK__
  <h1>__TITLE__</h1>
  <div class="subtitle"><span>全__COUNT__枚</span><button id="slideshow-btn" type="button">▶ スライドショーで見る</button></div>

  <div class="pagination">
    <button id="btn-prev-top">＜ 前のページ</button>
    <span class="page-info"><select class="page-jump" id="page-select-top"></select> / <span id="total-pages-top"></span></span>
    <button id="btn-next-top">次のページ ＞</button>
  </div>

  <div class="gallery" id="gallery-container"></div>

  <div class="pagination">
    <button id="btn-prev-bottom">＜ 前のページ</button>
    <span class="page-info"><select class="page-jump" id="page-select-bottom"></select> / <span id="total-pages-bottom"></span></span>
    <button id="btn-next-bottom">次のページ ＞</button>
  </div>

  <div id="modal">
    <div id="modal-header">
      <div id="modal-filename"></div>
      <div id="modal-tools">
        <a id="download-btn" href="#" download title="画像を保存">⬇ ダウンロード</a>
        <div id="modal-close" class="tool-btn" title="閉じる">✖</div>
      </div>
    </div>
    <div class="nav-btn" id="prev-btn">&#10094;</div>
    <img id="modal-img" src="" alt="">
    <div class="nav-btn" id="next-btn">&#10095;</div>
    <div id="modal-loading">読み込み中…</div>
  </div>

  <div id="slideshow" aria-label="スライドショー">
    <div class="ss-slide"><img class="ss-bg" alt=""><img class="ss-fg" alt=""></div>
    <div class="ss-slide"><img class="ss-bg" alt=""><img class="ss-fg" alt=""></div>
    <div class="ss-intro" id="ss-intro">
      <div class="ss-intro-title">__TITLE__</div>
      <div class="ss-intro-sub">全__COUNT__枚</div>
    </div>
    <div class="ss-controls">
      <button class="ss-btn" id="ss-prev" type="button" title="前の写真">&#10094;</button>
      <button class="ss-btn" id="ss-pause" type="button" title="一時停止">❚❚</button>
      <button class="ss-btn" id="ss-next" type="button" title="次の写真">&#10095;</button>
      <button class="ss-btn" id="ss-mute" type="button" title="音を消す">🔊</button>
      <div class="ss-speed" id="ss-speed" role="group" aria-label="切り替えの速さ">
        <span class="ss-speed-label">1枚</span>
        <button type="button" data-ms="1000">1秒</button>
        <button type="button" data-ms="1500">1.5秒</button>
        <button type="button" data-ms="2000">2秒</button>
        <button type="button" data-ms="3000">3秒</button>
      </div>
      <span class="ss-counter" id="ss-counter"></span>
      <button class="ss-btn" id="ss-close" type="button" title="終わる">✕</button>
    </div>
    <audio id="ss-audio" loop preload="none"></audio>
  </div>

<script>
  const images = __IMAGES__;
  const ITEMS_PER_PAGE = 120;
  const totalPages = Math.ceil(images.length / ITEMS_PER_PAGE) || 1;
  let currentPage = 1;
  let currentIndex = 0;
  let loadToken = 0;

  const $ = id => document.getElementById(id);
  const gallery = $('gallery-container');
  const modal = $('modal');
  const modalImg = $('modal-img');
  const modalLoading = $('modal-loading');
  const downloadBtn = $('download-btn');

  function initPagination() {
    for (const pos of ['top', 'bottom']) {
      const select = $('page-select-' + pos);
      for (let i = 1; i <= totalPages; i++) select.options.add(new Option(i, i));
      select.addEventListener('change', e => goToPage(parseInt(e.target.value, 10)));
      $('total-pages-' + pos).textContent = totalPages;
      $('btn-prev-' + pos).onclick = () => goToPage(currentPage - 1);
      $('btn-next-' + pos).onclick = () => goToPage(currentPage + 1);
    }
  }

  function renderPage() {
    gallery.innerHTML = '';
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, images.length);
    for (let i = start; i < end; i++) {
      const item = images[i];
      const div = document.createElement('div');
      div.className = 'gallery-item';
      div.style.flexGrow = item.aspect;
      div.style.width = 'calc(180px * ' + item.aspect + ')';
      div.onclick = () => openModal(i);
      const img = document.createElement('img');
      img.src = item.thumb;
      img.loading = 'lazy';
      img.alt = item.filename;
      div.appendChild(img);
      gallery.appendChild(div);
    }
    for (const pos of ['top', 'bottom']) {
      $('btn-prev-' + pos).disabled = currentPage === 1;
      $('btn-next-' + pos).disabled = currentPage === totalPages;
      $('page-select-' + pos).value = currentPage;
    }
  }

  function goToPage(page) {
    currentPage = Math.min(Math.max(page, 1), totalPages);
    renderPage();
    window.scrollTo(0, 0);
  }

  function openModal(index) {
    currentIndex = index;
    showCurrent();
    modal.style.display = 'flex';
  }

  function showCurrent() {
    const item = images[currentIndex];
    $('modal-filename').textContent = item.filename;
    downloadBtn.href = item.src;
    downloadBtn.download = item.filename;

    modalImg.src = item.thumb;
    modalImg.classList.add('loading');
    modalLoading.textContent = '読み込み中…';
    modalLoading.classList.add('show');

    // 連打したとき、前の写真があとから届いて差し替わらないようにする
    const token = ++loadToken;
    const full = new Image();
    full.onload = () => {
      if (token !== loadToken) return;
      modalImg.src = full.src;
      modalImg.classList.remove('loading');
      modalLoading.classList.remove('show');
    };
    full.onerror = () => {
      if (token !== loadToken) return;
      modalLoading.textContent = '写真を読み込めませんでした';
    };
    full.src = item.src;

    // 前後の写真を先に読んでおくと、めくるときに待たされない
    for (const d of [1, -1]) {
      const n = images[(currentIndex + d + images.length) % images.length];
      if (n !== item) new Image().src = n.src;
    }
  }

  function step(delta, e) {
    if (e) e.stopPropagation();
    currentIndex = (currentIndex + delta + images.length) % images.length;
    const page = Math.floor(currentIndex / ITEMS_PER_PAGE) + 1;
    if (page !== currentPage) { currentPage = page; renderPage(); }
    showCurrent();
  }

  function closeModal() {
    modal.style.display = 'none';
    modalImg.src = '';
  }

  modal.onclick = e => { if (e.target === modal) closeModal(); };
  $('modal-close').onclick = closeModal;
  downloadBtn.onclick = e => e.stopPropagation();
  $('next-btn').onclick = e => step(1, e);
  $('prev-btn').onclick = e => step(-1, e);
  document.addEventListener('keydown', e => {
    if (modal.style.display !== 'flex') return;
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'Escape') closeModal();
  });

  // ---- スライドショー ----
  const MUSIC = __MUSIC__;
  const SPEED_KEY = 'gallery-slide-ms';
  let SLIDE_MS = __SLIDE_MS__;
  // 見ている人が前に選んだ速さがあれば、それを使う（この人のブラウザの中だけに覚える）
  try {
    const saved = parseInt(localStorage.getItem(SPEED_KEY), 10);
    if (saved >= 500 && saved <= 30000) SLIDE_MS = saved;
  } catch (e) {}
  const slideshow = $('slideshow');
  const ssSlides = slideshow.querySelectorAll('.ss-slide');
  const ssAudio = $('ss-audio');
  let ssIndex = 0;
  let ssActive = 0;
  let ssTimer = null;
  let ssHideTimer = null;
  let ssToken = 0;
  let ssPaused = false;
  let ssFade = null;

  // 切り替えの長さは1枚の時間に合わせる。速いときに重なっている時間ばかりにならないように
  function applySpeed(ms) {
    SLIDE_MS = ms;
    const fade = Math.min(1400, Math.round(ms * 0.4));
    slideshow.style.setProperty('--ss-fade', fade + 'ms');
    slideshow.style.setProperty('--ss-dur', (ms + fade) + 'ms');
    $('ss-speed').querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.ms) === ms));
  }
  applySpeed(SLIDE_MS);
  $('ss-speed').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      applySpeed(Number(b.dataset.ms));
      try { localStorage.setItem(SPEED_KEY, String(SLIDE_MS)); } catch (e) {}
      ssSchedule();
      ssRevealControls();
    };
  });
  if (!MUSIC) $('ss-mute').style.display = 'none';

  function loadImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  // 音をいきなり鳴らしたり止めたりせず、ゆっくり大きく・小さくする
  function fadeAudio(to, ms, done) {
    clearInterval(ssFade);
    const from = ssAudio.volume;
    const started = Date.now();
    ssFade = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / ms);
      ssAudio.volume = from + (to - from) * t;
      if (t === 1) { clearInterval(ssFade); if (done) done(); }
    }, 50);
  }

  async function ssShow(i) {
    const token = ++ssToken;
    const item = images[i];
    const ok = await loadImage(item.src);
    if (token !== ssToken || !slideshow.classList.contains('show')) return;

    const next = ssSlides[1 - ssActive];
    const fg = next.querySelector('.ss-fg');
    next.querySelector('.ss-bg').src = item.thumb;
    fg.src = ok ? item.src : item.thumb;

    // 毎回、寄るか引くか・動く向きを変えて、単調にならないようにする
    const zoomIn = Math.random() < 0.5;
    const dx = ((Math.random() * 2 - 1) * 1.5).toFixed(2) + '%';
    const dy = ((Math.random() * 2 - 1) * 1.2).toFixed(2) + '%';
    fg.style.setProperty('--s0', zoomIn ? 1 : 1.06);
    fg.style.setProperty('--s1', zoomIn ? 1.06 : 1);
    fg.style.setProperty('--x0', zoomIn ? '0%' : dx);
    fg.style.setProperty('--y0', zoomIn ? '0%' : dy);
    fg.style.setProperty('--x1', zoomIn ? dx : '0%');
    fg.style.setProperty('--y1', zoomIn ? dy : '0%');
    next.classList.remove('kb');
    void next.offsetWidth;
    next.classList.add('kb');

    next.classList.add('active');
    ssSlides[ssActive].classList.remove('active');
    ssActive = 1 - ssActive;
    ssIndex = i;
    $('ss-counter').textContent = (i + 1) + ' / ' + images.length;
    // 速く切り替わるので、少し先まで読んでおいて待たされないようにする
    for (let k = 1; k <= 4; k++) new Image().src = images[(i + k) % images.length].src;
    ssSchedule();
  }

  function ssSchedule() {
    clearTimeout(ssTimer);
    if (!ssPaused) ssTimer = setTimeout(() => ssShow((ssIndex + 1) % images.length), SLIDE_MS);
  }

  function ssStep(delta) {
    ssShow((ssIndex + delta + images.length) % images.length);
    ssRevealControls();
  }

  function ssSetPaused(paused) {
    ssPaused = paused;
    slideshow.classList.toggle('paused', paused);
    $('ss-pause').textContent = paused ? '▶' : '❚❚';
    $('ss-pause').title = paused ? '再生' : '一時停止';
    if (MUSIC) {
      if (paused) fadeAudio(0, 400, () => ssAudio.pause());
      else if (!ssAudio.muted) { ssAudio.play().catch(() => {}); fadeAudio(1, 800); }
    }
    if (paused) clearTimeout(ssTimer); else ssSchedule();
  }

  function ssRevealControls() {
    slideshow.classList.add('controls-visible');
    clearTimeout(ssHideTimer);
    ssHideTimer = setTimeout(() => slideshow.classList.remove('controls-visible'), 2500);
  }

  function openSlideshow(start) {
    ssPaused = false;
    slideshow.classList.remove('paused');
    $('ss-pause').textContent = '❚❚';
    ssSlides.forEach(sl => sl.classList.remove('active', 'kb'));
    slideshow.classList.add('show');
    document.body.style.overflow = 'hidden';
    if (slideshow.requestFullscreen) slideshow.requestFullscreen().catch(() => {});

    const intro = $('ss-intro');
    intro.classList.remove('play');
    void intro.offsetWidth;
    intro.classList.add('play');

    if (MUSIC) {
      if (!ssAudio.getAttribute('src')) ssAudio.src = MUSIC;
      ssAudio.currentTime = 0;
      ssAudio.volume = 0;
      ssAudio.play().catch(() => {});
      fadeAudio(1, 2000);
    }
    ssShow(start);
  }

  function closeSlideshow() {
    ssToken++;
    clearTimeout(ssTimer);
    clearTimeout(ssHideTimer);
    if (MUSIC) fadeAudio(0, 500, () => ssAudio.pause());
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    slideshow.classList.remove('show', 'controls-visible');
    document.body.style.overflow = '';
  }

  $('slideshow-btn').onclick = () => openSlideshow(0);
  $('ss-close').onclick = closeSlideshow;
  $('ss-pause').onclick = () => { ssSetPaused(!ssPaused); ssRevealControls(); };
  $('ss-next').onclick = () => ssStep(1);
  $('ss-prev').onclick = () => ssStep(-1);
  $('ss-mute').onclick = () => {
    ssAudio.muted = !ssAudio.muted;
    $('ss-mute').textContent = ssAudio.muted ? '🔇' : '🔊';
    $('ss-mute').title = ssAudio.muted ? '音を出す' : '音を消す';
    if (!ssAudio.muted && !ssPaused) { ssAudio.play().catch(() => {}); fadeAudio(1, 600); }
    ssRevealControls();
  };
  // 全画面を Esc などで抜けたら、スライドショーも終わる
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && slideshow.classList.contains('show')) closeSlideshow();
  });
  slideshow.addEventListener('mousemove', ssRevealControls);
  slideshow.addEventListener('touchstart', ssRevealControls, { passive: true });
  document.addEventListener('keydown', e => {
    if (!slideshow.classList.contains('show')) return;
    if (e.key === ' ') { e.preventDefault(); ssSetPaused(!ssPaused); ssRevealControls(); }
    if (e.key === 'ArrowRight') ssStep(1);
    if (e.key === 'ArrowLeft') ssStep(-1);
    if (e.key === 'Escape') closeSlideshow();
  });

  initPagination();
  renderPage();
</script>
</body>
</html>
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('\nエラー: ' + err.message);
    process.exit(1);
  });
}
