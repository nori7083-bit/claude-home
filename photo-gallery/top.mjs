// これまでに作った大会の一覧から、トップページ（index.html）を作る。
// 使い方: node top.mjs --name <トップのサイト名> [--title <題名>] [--remove <大会のサイト名>] [--out <出力先>]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME_PATTERN, escapeHtml, readEvents, readSite, writeEvents, writeSite } from './build.mjs';

export function parseTopArgs(argv) {
  const opts = { title: '写真ギャラリー', out: 'dist', remove: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '--title' || a === '--out' || a === '--remove') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} のあとに値を書いてください`);
      if (a === '--remove') opts.remove.push(value);
      else opts[a.slice(2)] = value;
    } else {
      throw new Error(`わからない指定です: ${a}`);
    }
  }
  if (!opts.name) throw new Error('--name でトップページのサイト名を指定してください（例: --name nori-photos）');
  if (!NAME_PATTERN.test(opts.name)) {
    throw new Error('サイト名は英小文字・数字・ハイフンだけで、2〜58文字にしてください（例: nori-photos）');
  }
  return opts;
}

function formatDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

// 写真のファイル名に空白や日本語があっても、住所として正しく読めるようにする
function coverUrl(event) {
  return `${event.url.replace(/\/$/, '')}/${event.cover.split('/').map(encodeURIComponent).join('/')}`;
}

export function renderTopHtml(title, events) {
  // 新しい大会が上に来るように並べる
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const cards = sorted.map(e => `
    <a class="card" href="${escapeHtml(e.url)}">
      <div class="cover"><img src="${escapeHtml(coverUrl(e))}" alt="" loading="lazy"></div>
      <div class="info">
        <div class="date">${escapeHtml(formatDate(e.date))}</div>
        <div class="name">${escapeHtml(e.title)}</div>
        <div class="count">${e.count}枚</div>
      </div>
    </a>`).join('');
  return TOP_TEMPLATE
    .replaceAll('__TITLE__', () => escapeHtml(title))
    .replace('__CARDS__', () => cards || '<p class="empty">まだ大会がありません</p>');
}

async function main() {
  const opts = parseTopArgs(process.argv.slice(2));
  let events = await readEvents();
  if (opts.remove.length) {
    const missing = opts.remove.filter(n => !events.some(e => e.name === n));
    if (missing.length) throw new Error(`一覧にない大会です: ${missing.join(', ')}`);
    events = events.filter(e => !opts.remove.includes(e.name));
    await writeEvents(events);
    console.log(`一覧から外しました: ${opts.remove.join(', ')}`);
  }

  // 大会ページの「戻る」ボタンのために、トップページの住所と題名を控えておく
  const site = await readSite();
  await writeSite({
    name: opts.name,
    title: opts.title,
    url: site?.name === opts.name && site.url ? site.url : `https://${opts.name}.pages.dev`,
  });

  const outDir = path.resolve(opts.out, opts.name);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'index.html'), renderTopHtml(opts.title, events));

  const relOut = path.relative(process.cwd(), outDir) || '.';
  console.log(`できあがり: ${relOut}/index.html（大会${events.length}件）`);
  for (const e of events) console.log(`  - ${e.date} ${e.title}（${e.name}）`);
  console.log('');
  console.log('公開するには、次の1行をターミナルに貼り付けてください:');
  console.log(`  npx wrangler pages deploy "${relOut}" --project-name ${opts.name}`);
}

const TOP_TEMPLATE = `<!DOCTYPE html>
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
    --bg-page: #f0f4f8; --bg-white: #fff; --border: #E2E8F0;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", Meiryo, sans-serif;
    background-color: var(--bg-page); color: var(--text-dark); margin: 0; padding: 24px 16px 40px; line-height: 1.6;
  }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { margin: 0 0 20px; font-size: 1.3rem; font-weight: 800; border-left: 4px solid var(--primary); padding-left: 12px; line-height: 1.35; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
  .card {
    display: block; background: var(--bg-white); border: 1px solid var(--border); border-radius: 10px;
    overflow: hidden; text-decoration: none; color: inherit; transition: box-shadow .15s, transform .15s;
  }
  .card:hover { box-shadow: 0 8px 24px rgba(75,108,183,0.18); transform: translateY(-2px); }
  .cover { aspect-ratio: 3 / 2; background: #e2e8f0; }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .info { padding: 12px 14px 14px; }
  .date { font-size: 12px; color: var(--text-light); }
  .name { font-weight: 800; color: var(--primary-dark); margin: 2px 0; }
  .count { font-size: 12px; color: var(--text-light); }
  .empty { color: var(--text-light); }
</style>
</head>
<body>
<main>
  <h1>__TITLE__</h1>
  <div class="grid">__CARDS__
  </div>
</main>
</body>
</html>
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('\nエラー: ' + err.message);
    process.exit(1);
  });
}
