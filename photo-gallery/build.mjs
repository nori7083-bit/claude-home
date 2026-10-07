// 写真フォルダから、写真一覧ページ（index.html）と縮小した写真を作る。
// 使い方: node build.mjs <写真フォルダ> --name <サイト名> [--title <ページの題名>] [--out <出力先>]
import { readdir, mkdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 大きい写真の長い辺。スマホやパソコンで見るには十分で、1枚あたり数百KBに収まる
const FULL_LONG_EDGE = 2400;
const FULL_QUALITY = 82;
// 一覧の見本は高さ180pxで並べるので、きれいに見えるよう2倍で作る
const THUMB_HEIGHT = 360;
const THUMB_QUALITY = 70;
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
// Cloudflare Pages のプロジェクト名に使える形（英小文字・数字・ハイフン）
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$/;

export function parseArgs(argv) {
  const opts = { title: '競技写真', out: 'dist' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '--title' || a === '--out') {
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

async function processPhoto(sharp, srcPath, fullPath, thumbPath) {
  // rotate() はカメラが記録した向きの情報どおりに回す。縦位置の写真が横倒しにならないように
  const base = sharp(srcPath).rotate();
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

export function renderHtml(title, images) {
  const data = JSON.stringify(images).replace(/</g, '\\u003c');
  // 置き換えは関数で渡す。ファイル名に「$」があっても特別な記号として扱われないように
  return TEMPLATE
    .replaceAll('__TITLE__', () => escapeHtml(title))
    .replace('__COUNT__', () => String(images.length))
    .replace('__IMAGES__', () => data);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  console.log(`${files.length}枚の写真を処理します…`);
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
      size = await processPhoto(sharp, srcPath, fullPath, thumbPath);
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
  process.stdout.write('\n');

  await writeFile(path.join(outDir, 'index.html'), renderHtml(opts.title, images));

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

  @media (max-width: 800px) {
    .gallery-item { height: 120px; }
    .nav-btn { font-size: 26px; width: 40px; }
    #download-btn { font-size: 12px; padding: 5px 12px; }
  }
</style>
</head>
<body>
  <h1>__TITLE__</h1>
  <div class="subtitle">全__COUNT__枚</div>

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

  initPagination();
  renderPage();
</script>
</body>
</html>
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('エラー: ' + err.message);
    process.exit(1);
  });
}
