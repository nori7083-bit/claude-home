// 写真フォルダから、写真一覧ページ（index.html）と縮小した写真を作る。
// 使い方: node build.mjs <写真フォルダ> --name <サイト名> [--title <ページの題名>] [--date <YYYY-MM-DD>] [--music <曲のファイル>] [--seconds <1枚の秒数>] [--no-brighten] [--out <出力先>]
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
const LIFTED_QUALITY = 92;
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
// 暗い写真の自動補正。写真全体の平均の明るさ（0〜1）が DARK_BELOW より暗いときだけ、
// TARGET に近づくよう暗い部分を中心に持ち上げる。明るい部分は白く飛ばない
const DARK_BELOW = 0.34;
const TARGET = 0.40;
const MAX_LIFT = 1.8;
// 縮小のやり方を変えたら数字を上げる。上がっていたら、前回の縮小版を使わずに作り直す
const PROCESS_VERSION = 3;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseArgs(argv) {
  const opts = { title: '競技写真', out: 'dist', date: today(), seconds: 1, brighten: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '--title' || a === '--out' || a === '--date' || a === '--music' || a === '--seconds') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} のあとに値を書いてください`);
      opts[a.slice(2)] = value;
    } else if (a === '--no-brighten') {
      opts.brighten = false;
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
  if (!(opts.seconds >= 0.5 && opts.seconds <= 30)) throw new Error('--seconds は 0.5〜30 の数で書いてください（例: --seconds 2）');
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

async function processPhoto(sharp, srcPath, fullPath, thumbPath, workDir, brighten) {
  const isHeic = HEIC_EXTS.has(path.extname(srcPath).toLowerCase());
  const input = isHeic ? await convertHeic(srcPath, workDir) : srcPath;
  try {
    return await resizePhoto(sharp, input, fullPath, thumbPath, brighten);
  } finally {
    if (isHeic) await rm(input, { force: true });
  }
}

// どれだけ明るくするか（1なら何もしない）。平均の明るさ mean を TARGET に近づける強さを求める
export function liftFor(mean) {
  if (!(mean > 0) || mean >= DARK_BELOW) return 1;
  return Math.min(MAX_LIFT, Math.log(mean) / Math.log(TARGET));
}

async function measureBrightness(sharp, input) {
  const { channels } = await sharp(input).rotate().resize(64, 64, { fit: 'inside' }).greyscale().stats();
  return channels[0].mean / 255;
}

async function resizePhoto(sharp, input, fullPath, thumbPath, brighten) {
  const lift = brighten ? liftFor(await measureBrightness(sharp, input)) : 1;
  // rotate() はカメラが記録した向きの情報どおりに回す。縦位置の写真が横倒しにならないように
  const lifted = lift > 1.02;
  const base = () => {
    const img = sharp(input).rotate();
    if (!lifted) return img;
    // gamma(1, lift) は暗い部分ほど大きく持ち上げ、明るい部分はほとんど変えない。
    // 細かい段階で計算して（16ビット）、持ち上げた暗い部分に縞模様が出にくいようにする
    return img.pipelineColourspace('rgb16').gamma(1, lift).toColourspace('srgb');
  };
  // 明るくした写真は、暗いところに隠れていたざらつきが見えやすくなる。
  // 圧縮を控えめにして、色の細かさも落とさずに保存する
  const fullJpeg = lifted
    ? { quality: LIFTED_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' }
    : { quality: FULL_QUALITY, mozjpeg: true };
  const full = await base()
    .resize(FULL_LONG_EDGE, FULL_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg(fullJpeg)
    .toFile(fullPath);
  await base()
    .resize({ height: THUMB_HEIGHT, withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toFile(thumbPath);
  return { ...full, lifted };
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

export function renderHtml(title, images, music = null, seconds = 1, back = null, date = null) {
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
      : '')
    .replace('__DATE__', () => date ? `<div class="hero-date">${escapeHtml(formatDate(date))}</div>` : '');
}

export function formatDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}年${m}月${d}日`;
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

  // 前回と縮小のやり方（版や自動補正のオン・オフ）が違えば、全部作り直す
  const stampPath = path.join(path.resolve(opts.out), `.${opts.name}.build.json`);
  const stamp = { version: PROCESS_VERSION, brighten: opts.brighten };
  let reuse = false;
  try {
    const prev = JSON.parse(await readFile(stampPath, 'utf8'));
    reuse = prev.version === stamp.version && prev.brighten === stamp.brighten;
  } catch (e) {}
  if (!reuse) await rm(stampPath, { force: true });

  const { default: sharp } = await import('sharp');
  const images = new Array(files.length);
  let lifted = 0;
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
      if (reuse && await isUpToDate(srcPath, [fullPath, thumbPath])) {
        size = await readSize(sharp, fullPath);
        skipped++;
      } else {
        size = await processPhoto(sharp, srcPath, fullPath, thumbPath, workDir, opts.brighten);
        if (size.lifted) lifted++;
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
  await writeFile(stampPath, JSON.stringify(stamp) + '\n');
  if (lifted) console.log(`暗い写真${lifted}枚を、自動で明るくしました`);

  // 元のフォルダから外した写真の縮小版を消す。残すと公開し直したときにいっしょに送られてしまう
  const removed = await removeStale([imagesDir, thumbsDir], new Set(names));
  if (removed) console.log(`外された写真${removed}枚の縮小版を消しました`);

  const music = await placeMusic(opts.music, outDir);
  await writeFile(path.join(outDir, 'index.html'), renderHtml(opts.title, images, music, opts.seconds, await readSite(), opts.date));

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
    margin: 0; background: #0b0d12; color: #fff; line-height: 1.6;
  }
  /* 表紙：大会名と「スライドショーを見る」ボタン。後ろでは写真がぼんやり入れ替わる */
  .hero {
    position: relative; min-height: 100vh; min-height: 100svh; box-sizing: border-box; overflow: hidden;
    display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
    padding: 76px 20px 48px;
  }
  .hero-bg {
    position: absolute; inset: -40px; background-size: cover; background-position: center;
    filter: blur(22px) brightness(0.42); transform: scale(1.05); opacity: 0; transition: opacity 1.6s ease;
  }
  .hero-bg.on { opacity: 1; }
  .hero-content { position: relative; z-index: 1; max-width: 900px; }
  .hero-date { font-size: 14px; opacity: .8; letter-spacing: .08em; }
  .hero-title { font-size: clamp(1.6rem, 5vw, 3rem); font-weight: 800; margin: 8px 0 6px; line-height: 1.3; letter-spacing: .03em; text-shadow: 0 2px 20px rgba(0,0,0,.5); }
  .hero-count { font-size: 14px; opacity: .8; }
  #hero-play {
    margin-top: 30px; font-size: 18px; font-weight: 800; padding: 16px 36px; border-radius: 100px; border: 0;
    background: #fff; color: #111; cursor: pointer; box-shadow: 0 10px 30px rgba(0,0,0,.35); transition: transform .15s;
  }
  #hero-play:hover { transform: scale(1.04); }
  .hero-note { margin-top: 12px; font-size: 12px; opacity: .7; }
  .back-link { position: absolute; top: 18px; left: 16px; z-index: 2; }
  .back-link a {
    display: inline-block; color: #fff; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.25);
    padding: 6px 14px; border-radius: 100px; text-decoration: none; font-size: 0.8125rem; font-weight: 700; transition: background .15s;
  }
  .back-link a:hover { background: rgba(255,255,255,.28); }

  /* スライドショー：写真をゆっくり動かしながら、ふわっと切り替えて自動で流す */
  #slideshow { display: none; position: fixed; inset: 0; background: #000; z-index: 3000; overflow: hidden; cursor: none; --ss-dur: 2.2s; --ss-fade: 0.6s; }
  #slideshow.show { display: block; }
  #slideshow.controls-visible, #slideshow.paused { cursor: default; }
  .ss-slide { position: absolute; inset: 0; opacity: 0; transition: opacity var(--ss-fade) ease; }
  .ss-slide.active { opacity: 1; }
  .ss-bg { position: absolute; top: -60px; left: -60px; width: calc(100% + 120px); height: calc(100% + 120px); object-fit: cover; filter: blur(30px) brightness(calc(0.45 * var(--ss-bright, 1))); }
  .ss-fg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; will-change: transform; filter: brightness(var(--ss-bright, 1)); }
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
  .ss-btn.on { background: #fff; color: #111; }
  /* 1巡して止まったときの案内 */
  .ss-end {
    position: absolute; inset: 0; z-index: 2; display: none; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; color: #fff; text-align: center; padding: 24px; background: rgba(0,0,0,.45);
  }
  #slideshow.ended .ss-end { display: flex; }
  .ss-end-title { font-size: clamp(1.2rem, 3.5vw, 1.8rem); font-weight: 800; }
  .ss-end-buttons { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
  .ss-end-buttons button {
    border: 0; border-radius: 100px; padding: 12px 24px; font-size: 15px; font-weight: 800; cursor: pointer;
  }
  #ss-again { background: #fff; color: #111; }
  #ss-end-close { background: rgba(255,255,255,.18); color: #fff; }
  .ss-counter { margin-left: auto; font-size: 13px; opacity: .85; font-variant-numeric: tabular-nums; }
  .ss-speed { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 100px; background: rgba(255,255,255,.14); }
  .ss-speed-label { font-size: 12px; opacity: .8; padding: 0 6px 0 8px; }
  .ss-speed button {
    border: 0; border-radius: 100px; padding: 7px 11px; font-size: 13px; font-weight: 700; cursor: pointer;
    color: #fff; background: transparent; font-variant-numeric: tabular-nums; transition: background .15s, color .15s;
  }
  .ss-speed button:hover { background: rgba(255,255,255,.18); }
  .ss-speed button.on { background: #fff; color: #111; }
  /* 明るさのつまみ。暗く写った写真が多いときに、見る人が自分で明るくできる */
  .ss-bright { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 100px; background: rgba(255,255,255,.14); }
  .ss-bright-label { border: 0; background: none; color: #fff; font-size: 16px; cursor: pointer; padding: 0; line-height: 1; }
  .ss-bright input { width: 110px; accent-color: #fff; cursor: pointer; }
  .ss-bright-value { font-size: 12px; opacity: .85; min-width: 3.2em; text-align: right; font-variant-numeric: tabular-nums; }
  @media (max-width: 600px) {
    .ss-controls { flex-wrap: wrap; gap: 8px; }
    .ss-btn { width: 40px; height: 40px; font-size: 15px; }
    .ss-speed { order: -1; width: 100%; justify-content: center; background: none; }
    .ss-speed button { background: rgba(255,255,255,.14); }
    .ss-bright { order: -1; width: 100%; justify-content: center; background: none; }
    .ss-bright input { width: 55%; }
  }

</style>
</head>
<body>
  <section class="hero">
    <div class="hero-bg"></div>
    <div class="hero-bg"></div>
    __BACK__
    <div class="hero-content">
      __DATE__
      <h1 class="hero-title">__TITLE__</h1>
      <div class="hero-count">全__COUNT__枚</div>
      <button id="hero-play" type="button">▶ スライドショーを見る</button>
      <div class="hero-note" id="hero-note"></div>
    </div>
  </section>

  <div id="slideshow" aria-label="スライドショー">
    <div class="ss-slide"><img class="ss-bg" alt=""><img class="ss-fg" alt=""></div>
    <div class="ss-slide"><img class="ss-bg" alt=""><img class="ss-fg" alt=""></div>
    <div class="ss-intro" id="ss-intro">
      <div class="ss-intro-title">__TITLE__</div>
      <div class="ss-intro-sub">全__COUNT__枚</div>
    </div>
    <div class="ss-end">
      <div class="ss-end-title">最後まで見ました</div>
      <div class="ss-end-buttons">
        <button type="button" id="ss-again">↻ もう一度見る</button>
        <button type="button" id="ss-end-close">表紙に戻る</button>
      </div>
    </div>
    <div class="ss-controls">
      <button class="ss-btn" id="ss-prev" type="button" title="前の写真">&#10094;</button>
      <button class="ss-btn" id="ss-pause" type="button" title="一時停止">❚❚</button>
      <button class="ss-btn" id="ss-next" type="button" title="次の写真">&#10095;</button>
      <button class="ss-btn" id="ss-repeat" type="button" title="くり返し再生：オフ" aria-pressed="false">🔁</button>
      <button class="ss-btn" id="ss-mute" type="button" title="音を消す">🔊</button>
      <div class="ss-speed" id="ss-speed" role="group" aria-label="切り替えの速さ">
        <span class="ss-speed-label">1枚</span>
        <button type="button" data-ms="1000">1秒</button>
        <button type="button" data-ms="1500">1.5秒</button>
        <button type="button" data-ms="2000">2秒</button>
        <button type="button" data-ms="3000">3秒</button>
      </div>
      <div class="ss-bright">
        <button type="button" class="ss-bright-label" id="ss-bright-reset" title="元の明るさに戻す">☀</button>
        <input type="range" id="ss-bright" min="0.6" max="1.8" step="0.05" value="1" aria-label="明るさ">
        <span class="ss-bright-value" id="ss-bright-value">100%</span>
      </div>
      <span class="ss-counter" id="ss-counter"></span>
      <button class="ss-btn" id="ss-close" type="button" title="終わる">✕</button>
    </div>
    <audio id="ss-audio" loop preload="none"></audio>
  </div>

<script>
  const images = __IMAGES__;

  const $ = id => document.getElementById(id);

  // 表紙の後ろで、見本の写真をぼかしてゆっくり入れ替える
  (function heroBackground() {
    const layers = document.querySelectorAll('.hero-bg');
    let n = 0;
    function next() {
      const layer = layers[n % 2];
      const item = images[Math.floor(Math.random() * images.length)];
      const img = new Image();
      img.onload = () => {
        layer.style.backgroundImage = 'url("' + item.thumb.replace(/"/g, '%22') + '")';
        layer.classList.add('on');
        layers[(n + 1) % 2].classList.remove('on');
        n++;
      };
      img.src = item.thumb;
    }
    next();
    setInterval(() => { if (!slideshow.classList.contains('show')) next(); }, 4500);
  })();

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
  // 最初は1巡したら止まる。🔁 を押すと、止めるまでくり返す
  let ssRepeat = false;
  let ssEnded = false;

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

  // 明るさ：写真そのものは変えず、表示するときだけ明るく・暗くする
  const BRIGHT_KEY = 'gallery-brightness';
  function applyBrightness(v) {
    slideshow.style.setProperty('--ss-bright', String(v));
    $('ss-bright').value = String(v);
    $('ss-bright-value').textContent = Math.round(v * 100) + '%';
  }
  try {
    const saved = parseFloat(localStorage.getItem(BRIGHT_KEY));
    applyBrightness(saved >= 0.6 && saved <= 1.8 ? saved : 1);
  } catch (e) { applyBrightness(1); }
  function saveBrightness(v) {
    applyBrightness(v);
    try { localStorage.setItem(BRIGHT_KEY, String(v)); } catch (e) {}
    ssRevealControls();
  }
  $('ss-bright').addEventListener('input', e => saveBrightness(parseFloat(e.target.value)));
  $('ss-bright-reset').onclick = () => saveBrightness(1);

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
    if (ssPaused) return;
    ssTimer = setTimeout(() => {
      if (ssIndex === images.length - 1 && !ssRepeat) ssFinish();
      else ssShow((ssIndex + 1) % images.length);
    }, SLIDE_MS);
  }

  function ssStep(delta) {
    if (ssEnded) { ssEnded = false; slideshow.classList.remove('ended'); }
    ssShow((ssIndex + delta + images.length) % images.length);
    ssRevealControls();
  }

  function ssFinish() {
    ssSetPaused(true);
    ssEnded = true;
    slideshow.classList.add('ended');
  }

  function ssRestart() {
    ssEnded = false;
    slideshow.classList.remove('ended');
    if (MUSIC) ssAudio.currentTime = 0;
    ssSetPaused(false, true);
    ssShow(0);
  }

  function ssSetPaused(paused, skipSchedule) {
    if (!paused && ssEnded) { ssRestart(); return; }
    ssPaused = paused;
    slideshow.classList.toggle('paused', paused);
    $('ss-pause').textContent = paused ? '▶' : '❚❚';
    $('ss-pause').title = paused ? '再生' : '一時停止';
    if (MUSIC) {
      if (paused) fadeAudio(0, 400, () => ssAudio.pause());
      else if (!ssAudio.muted) { ssAudio.play().catch(() => {}); fadeAudio(1, 800); }
    }
    if (paused) clearTimeout(ssTimer); else if (!skipSchedule) ssSchedule();
  }

  function ssRevealControls() {
    slideshow.classList.add('controls-visible');
    clearTimeout(ssHideTimer);
    ssHideTimer = setTimeout(() => slideshow.classList.remove('controls-visible'), 2500);
  }

  function openSlideshow(start) {
    ssPaused = false;
    ssEnded = false;
    slideshow.classList.remove('ended');
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

  $('hero-play').onclick = () => openSlideshow(0);
  if (MUSIC) $('hero-note').textContent = '♪ 音楽が流れます';
  $('ss-close').onclick = closeSlideshow;
  $('ss-end-close').onclick = closeSlideshow;
  $('ss-again').onclick = ssRestart;
  $('ss-repeat').onclick = () => {
    ssRepeat = !ssRepeat;
    $('ss-repeat').classList.toggle('on', ssRepeat);
    $('ss-repeat').setAttribute('aria-pressed', String(ssRepeat));
    $('ss-repeat').title = ssRepeat ? 'くり返し再生：オン' : 'くり返し再生：オフ';
    ssRevealControls();
  };
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
    if (e.target && e.target.id === 'ss-bright' && e.key !== 'Escape') return;
    if (e.key === ' ') { e.preventDefault(); ssSetPaused(!ssPaused); ssRevealControls(); }
    if (e.key === 'ArrowRight') ssStep(1);
    if (e.key === 'ArrowLeft') ssStep(-1);
    if (e.key === 'Escape') closeSlideshow();
  });
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
