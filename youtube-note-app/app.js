/* ========== 定数 ========== */
const STORAGE_KEY = 'yt-note-app-v1';

/* ========== 状態 ========== */
let state = {
  videos: [],
  categories: ['基礎知識', 'プログラミング', 'ツール・環境', 'デザイン', 'ビジネス', 'その他'],
  filter: 'all',
  category: 'all',
  search: '',
  viewMode: 'normal',
  cardView: 'grid',
  showMemo: false,
  showPrompts: true,
  sidebarOpen: true,
};
let editingId = null;
let detailId = null;
let formStars = 0;

/* ========== localStorage ========== */
function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    state.videos = saved.videos || [];
    state.categories = saved.categories || state.categories;
  } catch (e) {}
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    videos: state.videos,
    categories: state.categories,
  }));
}

/* ========== ダミーデータ ========== */
function generateDummyData() {
  if (state.videos.length > 0) return;

  const categoryMap = [
    { cat: '基礎知識', titles: ['プログラミングとは何か', 'コンピュータの仕組み', 'インターネットの基礎', 'HTMLの基本構造', 'CSSの基礎'] },
    { cat: 'プログラミング', titles: ['JavaScriptの変数と型', '関数の定義と使い方', '配列とループの基礎', 'DOM操作の基本', 'イベントリスナー入門', '非同期処理を理解する'] },
    { cat: 'ツール・環境', titles: ['VSCodeの使い方', 'ターミナルの基本コマンド', 'Gitの入門', 'GitHubの使い方', 'npm入門'] },
    { cat: 'デザイン', titles: ['Flexboxを使ったレイアウト', 'CSSグリッドレイアウト', 'レスポンシブデザイン入門', 'CSSアニメーション'] },
    { cat: 'ビジネス', titles: ['Webサイトを公開する方法', 'SEOの基礎知識', 'Googleアナリティクス入門', 'SNS活用術'] },
    { cat: 'その他', titles: ['学習の記録を続けるコツ', 'エラーの読み方と対処法', 'プログラマーの思考法', 'おすすめの学習サイト', '質問の仕方と調べ方'] },
  ];

  const bulletTemplates = [
    ['主要な概念を理解する', '実際に手を動かして試す', '公式ドキュメントを確認する'],
    ['まず全体像を把握する', '個々の要素を深く学ぶ', '実例を自分で作ってみる', '復習して定着させる'],
    ['基礎から順番に積み上げる', '分からない部分はメモする', '反復練習で身につける'],
    ['概念を理解する', 'コードを書いて試す', 'エラーを自分で解決する', '応用例を探す'],
    ['入門動画を見る', 'サンプルを動かす', 'カスタマイズしてみる'],
  ];

  const memos = [
    'この動画はとても分かりやすかった。もう一度見て復習したい。',
    '最初は難しく感じたが、実際にコードを書いてみたら理解が深まった。',
    '後で公式サイトも確認する。',
    '',
    'ここで詰まったのでメモ：変数名は分かりやすい名前にすること',
    '実践課題もあってよかった。',
    '',
    'この内容はシリーズの続きがある。あとで見る。',
  ];

  let idx = 1;
  for (const { cat, titles } of categoryMap) {
    for (const title of titles) {
      if (idx > 29) break;
      const numStr = String(idx).padStart(2, '0');
      const bullets = bulletTemplates[(idx - 1) % bulletTemplates.length].map(text => ({
        text,
        checks: Math.floor(Math.random() * 3),
      }));
      state.videos.push({
        id: `dummy-${idx}`,
        title: `動画${numStr}：${title}`,
        url: `https://www.youtube.com/watch?v=DUMMY_${numStr}`,
        category: cat,
        bullets,
        memo: memos[(idx - 1) % memos.length],
        stars: Math.floor(Math.random() * 3) + 2,
        reviewDate: '',
      });
      idx++;
    }
    if (idx > 29) break;
  }
  saveData();
}

/* ========== ユーティリティ ========== */
function genId() {
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function getThumbnail(url) {
  const id = getYouTubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
}

function getEmbedUrl(url) {
  const id = getYouTubeId(url);
  return id ? `https://www.youtube.com/embed/${id}?rel=0` : null;
}

function starsHtml(n) {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function isDummyUrl(url) {
  return !url || url.includes('DUMMY_');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}復習`;
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 2500);
}

/* ========== 進捗計算 ========== */
function calcProgress() {
  let totalBullets = 0, checked = 0, practiced = 0, important = 0;
  for (const v of state.videos) {
    for (const b of v.bullets) {
      totalBullets++;
      if (b.checks >= 1) checked++;
      if (b.checks >= 2) practiced++;
      if (b.checks >= 3) important++;
    }
  }
  return { totalBullets, checked, practiced, important };
}

/* ========== フィルター適用 ========== */
function getFilteredVideos() {
  let vids = [...state.videos];

  if (state.category !== 'all') {
    vids = vids.filter(v => v.category === state.category);
  }

  if (state.search) {
    const q = state.search.toLowerCase();
    vids = vids.filter(v =>
      v.title.toLowerCase().includes(q) ||
      v.category.toLowerCase().includes(q) ||
      v.memo.toLowerCase().includes(q) ||
      v.bullets.some(b => b.text.toLowerCase().includes(q))
    );
  }

  if (state.filter === 'fav') {
    vids = vids.filter(v => v.stars >= 4);
  } else if (state.filter === 'level-0') {
    vids = vids.filter(v => v.bullets.every(b => b.checks === 0));
  } else if (state.filter === 'level-1') {
    vids = vids.filter(v => v.bullets.some(b => b.checks >= 1) && v.bullets.every(b => b.checks < 2));
  } else if (state.filter === 'level-2') {
    vids = vids.filter(v => v.bullets.some(b => b.checks >= 2) && v.bullets.every(b => b.checks < 3));
  } else if (state.filter === 'level-3') {
    vids = vids.filter(v => v.bullets.some(b => b.checks >= 3));
  } else if (state.filter === 'review') {
    const soon = new Date(); soon.setDate(soon.getDate() + 3);
    vids = vids.filter(v => v.reviewDate && new Date(v.reviewDate) <= soon);
  }

  return vids;
}

/* ========== チェックボックスHTML ========== */
function checksHtml(checks, videoId, bulletIdx, interactive = true) {
  let html = '<div class="checks">';
  for (let i = 0; i < 3; i++) {
    const filled = i < checks;
    let cls = 'check-box';
    if (filled) {
      if (checks === 1) cls += ' checked-1';
      else if (checks === 2) cls += ' checked-2';
      else if (checks === 3) cls += ' checked-3';
    }
    const attr = interactive
      ? `data-vid="${videoId}" data-bi="${bulletIdx}" data-ci="${i}" onclick="handleCheck(event)"`
      : '';
    html += `<div class="${cls}" ${attr}>${filled ? '✓' : ''}</div>`;
  }
  html += '</div>';
  return html;
}

/* ========== チェック操作 ========== */
function handleCheck(e) {
  e.stopPropagation();
  const vid = e.currentTarget.dataset.vid;
  const bi = parseInt(e.currentTarget.dataset.bi);
  const ci = parseInt(e.currentTarget.dataset.ci);
  const video = state.videos.find(v => v.id === vid);
  if (!video) return;
  const cur = video.bullets[bi].checks;
  video.bullets[bi].checks = (cur === ci + 1) ? ci : ci + 1;
  saveData();
  render();
  if (detailId === vid) openDetail(vid);
}

/* ========== レンダリング ========== */
function render() {
  renderSidebar();
  renderStats();
  renderGrid();
}

function renderStats() {
  const { totalBullets, checked, practiced, important } = calcProgress();
  document.getElementById('stat-total').textContent = state.videos.length;
  document.getElementById('stat-checked').textContent = checked;
  document.getElementById('stat-practiced').textContent = practiced;
  document.getElementById('stat-important').textContent = important;
  const pct = totalBullets > 0 ? Math.round((checked / totalBullets) * 100) : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';
}

function renderSidebar() {
  const list = document.getElementById('category-list');
  const counts = {};
  for (const v of state.videos) counts[v.category] = (counts[v.category] || 0) + 1;

  list.innerHTML = `
    <div class="category-item ${state.category === 'all' ? 'active' : ''}" onclick="setCategory('all')">
      <span class="category-item-label">すべて</span>
      <span class="category-badge">${state.videos.length}</span>
    </div>
  ` + state.categories.map(cat => `
    <div class="category-item ${state.category === cat ? 'active' : ''}" onclick="setCategory('${cat}')">
      <span class="category-item-label">📁 ${cat}</span>
      <span class="category-badge">${counts[cat] || 0}</span>
      <button class="category-delete" onclick="deleteCategory(event, '${cat}')" title="削除">✕</button>
    </div>
  `).join('');
}

/* ========== サイドバートグル ========== */
function updateSidebarTab() {
  const tab = document.getElementById('sidebar-toggle-btn');
  const arrow = document.getElementById('sidebar-tab-arrow');
  if (state.sidebarOpen) {
    tab.style.left = 'var(--sidebar-w)';
    arrow.style.transform = 'rotate(0deg)';
  } else {
    tab.style.left = '0px';
    arrow.style.transform = 'rotate(180deg)';
  }
}

document.getElementById('sidebar-toggle-btn').addEventListener('click', () => {
  state.sidebarOpen = !state.sidebarOpen;
  document.querySelector('.sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  updateSidebarTab();
});

/* ========== カードビュー切替 ========== */
function setCardView(view) {
  state.cardView = view;
  document.getElementById('vt-grid').classList.toggle('active', view === 'grid');
  document.getElementById('vt-list').classList.toggle('active', view === 'list');
  // メモ列・プロンプト列の切替ボタンはリスト表示のときだけ見せる
  document.getElementById('vt-memo').style.display = view === 'list' ? 'inline-flex' : 'none';
  document.getElementById('vt-prompt').style.display = view === 'list' ? 'inline-flex' : 'none';
  renderGrid();
}

function toggleMemoCol() {
  state.showMemo = !state.showMemo;
  const btn = document.getElementById('vt-memo');
  btn.classList.toggle('memo-on', state.showMemo);
  btn.textContent = state.showMemo ? '📝 メモ ON' : '📝 メモ';
  renderGrid();
}

function togglePromptCol() {
  state.showPrompts = !state.showPrompts;
  const btn = document.getElementById('vt-prompt');
  btn.classList.toggle('memo-on', state.showPrompts);
  btn.textContent = state.showPrompts ? '📋 プロンプト ON' : '📋 プロンプト';
  renderGrid();
}

/* ========== 表示モード切替 ========== */
function setViewMode(mode) {
  state.viewMode = mode;
  ['normal', 'bullets', 'prompts'].forEach(m => {
    document.getElementById(`mode-${m}`).classList.toggle('active', m === mode);
  });
  const labels = { normal: '動画一覧', bullets: '箇条書き一覧', prompts: 'プロンプト一覧' };
  document.getElementById('content-title').textContent = labels[mode];
  renderGrid();
}

function renderBulletsCollection(vids) {
  const grid = document.getElementById('video-grid');
  const empty = document.getElementById('empty-state');
  const countEl = document.getElementById('content-count');
  const total = vids.reduce((s, v) => s + v.bullets.length, 0);
  countEl.textContent = `${vids.length}本・${total}項目`;
  if (total === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.style.gridTemplateColumns = '1fr';
  grid.innerHTML = vids.filter(v => v.bullets.length > 0).map(v => `
    <div class="collection-video-block">
      <div class="collection-video-header" onclick="openDetail('${v.id}')">
        <span class="collection-video-title">${escHtml(v.title)}</span>
        <div class="collection-video-meta">
          <span class="card-category">${escHtml(v.category)}</span>
          ${v.stars > 0 ? `<span class="card-stars">${starsHtml(v.stars)}</span>` : ''}
          <span style="font-size:11px;color:var(--text-muted)">${v.bullets.length}項目</span>
        </div>
      </div>
      <div class="collection-body">
        ${v.bullets.map((b, i) => `
          <div class="collection-bullet-item level-${b.checks}">
            ${checksHtml(b.checks, v.id, i)}
            <span class="bullet-text">${escHtml(b.text)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderPromptsCollection(vids) {
  const grid = document.getElementById('video-grid');
  const empty = document.getElementById('empty-state');
  const countEl = document.getElementById('content-count');
  const withPrompts = vids.filter(v => v.prompts && v.prompts.length > 0);
  const total = withPrompts.reduce((s, v) => s + v.prompts.length, 0);
  countEl.textContent = `${withPrompts.length}本・${total}件`;
  if (total === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('p').textContent = 'プロンプトが登録された動画がありません';
    return;
  }
  empty.style.display = 'none';
  grid.style.gridTemplateColumns = '1fr';
  grid.innerHTML = withPrompts.map(v => `
    <div class="collection-video-block">
      <div class="collection-video-header" onclick="openDetail('${v.id}')">
        <span class="collection-video-title">${escHtml(v.title)}</span>
        <div class="collection-video-meta">
          <span class="card-category">${escHtml(v.category)}</span>
          <span style="font-size:11px;color:var(--text-muted)">${v.prompts.length}件</span>
        </div>
      </div>
      <div class="collection-body">
        ${v.prompts.map((p, i) => `
          <div class="collection-prompt-card">
            ${p.description ? `<div class="collection-prompt-label">${escHtml(p.description)}</div>` : ''}
            <div class="collection-prompt-text">
              ${escHtml(p.text)}
              <button class="copy-btn" onclick="copyPrompt(${i}, '${v.id}')">コピー</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderListView(vids) {
  const grid = document.getElementById('video-grid');
  const empty = document.getElementById('empty-state');
  const countEl = document.getElementById('content-count');
  countEl.textContent = `${vids.length}本`;
  if (vids.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.className = 'list-view';
  grid.style.gridTemplateColumns = '';

  const sm = state.showMemo;
  const sp = state.showPrompts;
  const rowClass = `${sm ? 'show-memo' : ''} ${sp ? '' : 'hide-prompts'}`;
  const headerMemo = sm ? '<div class="list-header-cell">📝 メモ</div>' : '';
  const headerPrompts = sp ? '<div class="list-header-cell">📋 プロンプト</div>' : '';
  const headerRow = `
    <div class="list-header-row ${rowClass}">
      <div class="list-header-cell">動画</div>
      <div class="list-header-cell">📝 箇条書き</div>
      ${headerPrompts}
      ${headerMemo}
    </div>`;

  const rows = vids.map(v => {
    const thumb = !isDummyUrl(v.url) ? getThumbnail(v.url) : null;
    const thumbHtml = thumb
      ? `<img class="list-thumb" src="${thumb}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="list-thumb-placeholder" style="display:none">▶</div>`
      : `<div class="list-thumb-placeholder">▶</div>`;

    const bulletsHtml = v.bullets.length > 0
      ? v.bullets.map((b, i) => `
          <div class="list-bullet-item level-${b.checks}">
            ${checksHtml(b.checks, v.id, i)}
            <span class="bullet-text">${escHtml(b.text)}</span>
          </div>`).join('')
      : '<div class="list-empty-col">なし</div>';

    const prompts = v.prompts || [];
    const promptsHtml = !sp
      ? ''
      : `<div class="list-cell list-prompts">${prompts.length > 0
          ? prompts.map((p, i) => `
              <div class="list-prompt-card">
                ${p.description ? `<div class="list-prompt-label">${escHtml(p.description)}</div>` : ''}
                <div class="list-prompt-text">${escHtml(p.text)}<button class="copy-btn" onclick="copyPrompt(${i},'${v.id}')">コピー</button></div>
              </div>`).join('')
          : '<div class="list-empty-col">なし</div>'}</div>`;

    const memoHtml = sm
      ? `<div class="list-cell">${v.memo ? `<div class="list-memo-text">${escHtml(v.memo)}</div>` : '<div class="list-empty-col">なし</div>'}</div>`
      : '';

    return `
      <div class="list-row ${rowClass}">
        <div class="list-cell list-cell-thumb">
          ${thumbHtml}
          <div class="list-title-area">
            <div class="list-title" onclick="openDetail('${v.id}')">${escHtml(v.title)}</div>
            <div class="list-meta">
              <span class="card-category">${escHtml(v.category)}</span>
              ${v.stars > 0 ? `<span class="card-stars">${starsHtml(v.stars)}</span>` : ''}
            </div>
            <div style="margin-top:6px;display:flex;gap:4px">
              <button class="card-action-btn btn-edit" onclick="openEditModal('${v.id}')">編集</button>
              <button class="card-action-btn btn-del" onclick="deleteVideo('${v.id}')">削除</button>
            </div>
          </div>
        </div>
        <div class="list-cell list-bullets">${bulletsHtml}</div>
        ${promptsHtml}
        ${memoHtml}
      </div>`;
  }).join('');

  grid.innerHTML = headerRow + rows;
}

function renderGrid() {
  const vids = getFilteredVideos();
  const grid = document.getElementById('video-grid');
  const empty = document.getElementById('empty-state');
  const countEl = document.getElementById('content-count');

  if (state.viewMode === 'bullets') { renderBulletsCollection(vids); return; }
  if (state.viewMode === 'prompts') { renderPromptsCollection(vids); return; }
  if (state.cardView === 'list') { renderListView(vids); return; }

  grid.style.gridTemplateColumns = '';
  grid.className = 'video-grid';
  countEl.textContent = `${vids.length}本`;

  if (vids.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = vids.map(v => {
    const thumb = !isDummyUrl(v.url) ? getThumbnail(v.url) : null;
    const thumbHtml = thumb
      ? `<img class="card-thumb" src="${thumb}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="card-thumb-placeholder" style="display:none">▶</div>`
      : `<div class="card-thumb-placeholder">▶</div>`;

    const maxBullets = 4;
    const bulletsHtml = v.bullets.slice(0, maxBullets).map((b, i) => `
      <li class="card-bullet-item level-${b.checks}">
        ${checksHtml(b.checks, v.id, i)}
        <span class="bullet-text">${escHtml(b.text)}</span>
      </li>
    `).join('');
    const moreBullets = v.bullets.length > maxBullets ? `<li style="font-size:11px;color:var(--text-muted);padding:4px 6px">＋${v.bullets.length - maxBullets}件...</li>` : '';

    const reviewHtml = v.reviewDate
      ? `<span class="card-review ${isOverdue(v.reviewDate) ? 'overdue' : ''}">${formatDate(v.reviewDate)}</span>`
      : '';

    const checkedCount = v.bullets.filter(b => b.checks >= 1).length;
    const progressText = v.bullets.length > 0
      ? `チェック ${checkedCount}/${v.bullets.length}`
      : '箇条書きなし';

    return `
      <div class="video-card" onclick="openDetail('${v.id}')">
        ${thumbHtml}
        <div class="card-body">
          <div class="card-top">
            <div class="card-title">${escHtml(v.title)}</div>
            <div class="card-actions">
              <button class="card-action-btn btn-edit" onclick="event.stopPropagation();openEditModal('${v.id}')">編集</button>
              <button class="card-action-btn btn-del" onclick="event.stopPropagation();deleteVideo('${v.id}')">削除</button>
            </div>
          </div>
          <div class="card-meta">
            <span class="card-category">${escHtml(v.category)}</span>
            ${v.stars > 0 ? `<span class="card-stars">${starsHtml(v.stars)}</span>` : ''}
            ${reviewHtml}
          </div>
          ${v.bullets.length > 0 ? `<ul class="card-bullets">${bulletsHtml}${moreBullets}</ul>` : ''}
          <div class="card-footer">
            <span class="card-progress-mini">${progressText}</span>
            ${!isDummyUrl(v.url) ? `<a href="${escHtml(v.url)}" target="_blank" onclick="event.stopPropagation()" style="font-size:11px;color:var(--primary)">▶ YouTube</a>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ========== カテゴリ操作 ========== */
function setCategory(cat) {
  state.category = cat;
  document.getElementById('content-title').textContent = cat === 'all' ? 'すべての動画' : cat;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-filter="all"]').classList.add('active');
  state.filter = 'all';
  render();
}

function deleteCategory(e, cat) {
  e.stopPropagation();
  if (!confirm(`カテゴリ「${cat}」を削除しますか？\n（このカテゴリの動画は「その他」に移動します）`)) return;
  state.videos.forEach(v => { if (v.category === cat) v.category = 'その他'; });
  state.categories = state.categories.filter(c => c !== cat);
  if (!state.categories.includes('その他')) state.categories.push('その他');
  if (state.category === cat) state.category = 'all';
  saveData();
  render();
  showToast(`「${cat}」を削除しました`);
}

/* ========== フィルター ========== */
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    state.category = 'all';
    const labels = {
      all: 'すべての動画', fav: 'お気に入り',
      'level-0': '未理解', 'level-1': '覚えた',
      'level-2': '実践済み', 'level-3': '重要項目あり',
      review: '復習期限が近い',
    };
    document.getElementById('content-title').textContent = labels[state.filter] || 'すべての動画';
    render();
  });
});

/* ========== 検索 ========== */
let searchTimer;
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim();
    renderGrid();
  }, 200);
});

/* ========== 動画追加・編集モーダル ========== */
function openAddModal() {
  editingId = null;
  formStars = 0;
  document.getElementById('modal-title').textContent = '動画を追加';
  document.getElementById('form-title').value = '';
  document.getElementById('form-url').value = '';
  document.getElementById('form-memo').value = '';
  document.getElementById('form-stars').value = '0';
  document.getElementById('form-review-date').value = '';
  document.getElementById('embed-preview').style.display = 'none';
  updateStarUI(0);
  populateCategorySelect();
  resetBulletsContainer([]);
  resetPromptsContainer([]);
  document.getElementById('video-modal').style.display = 'flex';
}

function openEditModal(id) {
  const v = state.videos.find(v => v.id === id);
  if (!v) return;
  editingId = id;
  formStars = v.stars;
  document.getElementById('modal-title').textContent = '動画を編集';
  document.getElementById('form-title').value = v.title;
  document.getElementById('form-url').value = v.url;
  document.getElementById('form-memo').value = v.memo;
  document.getElementById('form-stars').value = v.stars;
  document.getElementById('form-review-date').value = v.reviewDate || '';
  updateStarUI(v.stars);
  populateCategorySelect(v.category);
  resetBulletsContainer(v.bullets);
  resetPromptsContainer(v.prompts || []);

  const embed = getEmbedUrl(v.url);
  if (embed && !isDummyUrl(v.url)) {
    document.getElementById('embed-iframe').src = embed;
    document.getElementById('embed-preview').style.display = 'block';
  } else {
    document.getElementById('embed-preview').style.display = 'none';
  }

  document.getElementById('video-modal').style.display = 'flex';
}

function populateCategorySelect(selected = '') {
  const sel = document.getElementById('form-category');
  sel.innerHTML = state.categories.map(c =>
    `<option value="${escHtml(c)}" ${c === selected ? 'selected' : ''}>${escHtml(c)}</option>`
  ).join('');
}

function resetBulletsContainer(bullets) {
  const container = document.getElementById('bullets-container');
  container.innerHTML = '';
  bullets.forEach(b => addBulletRow(b.text));
}

/* ========== プロンプト行 ========== */
function addPromptRow(desc = '', text = '') {
  const container = document.getElementById('prompts-container');
  const row = document.createElement('div');
  row.className = 'prompt-row';
  row.innerHTML = `
    <div class="prompt-row-header">
      <input type="text" value="${escHtml(desc)}" placeholder="説明（例：要約リクエスト用、翻訳用など）">
      <button class="prompt-row-delete" onclick="this.closest('.prompt-row').remove()" title="削除">✕</button>
    </div>
    <textarea placeholder="実際のプロンプトをここに貼り付け...">${escHtml(text)}</textarea>
  `;
  container.appendChild(row);
  row.querySelector('input').focus();
}

function resetPromptsContainer(prompts) {
  const container = document.getElementById('prompts-container');
  container.innerHTML = '';
  prompts.forEach(p => addPromptRow(p.description, p.text));
}

function parseBulletLines(text) {
  return text
    .split(/\n/)
    .map(l => l.replace(/^[\s・\-\*\•\●\◆\▶\→\ー]+/, '').trim())
    .filter(l => l.length > 0);
}

function addBulletRow(text = '') {
  const container = document.getElementById('bullets-container');
  const row = document.createElement('div');
  row.className = 'bullet-row';
  row.innerHTML = `
    <span style="color:var(--text-muted);font-size:13px">・</span>
    <input type="text" value="${escHtml(text)}" placeholder="項目を入力... （複数行をまとめて貼り付けも可）">
    <button class="bullet-row-delete" onclick="this.parentElement.remove()" title="削除">✕</button>
  `;
  const inp = row.querySelector('input');
  inp.addEventListener('paste', e => {
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    const lines = parseBulletLines(pasted);
    if (lines.length <= 1) return;
    e.preventDefault();
    inp.value = lines[0];
    lines.slice(1).forEach(line => addBulletRow(line));
    showToast(`${lines.length}項目に分割しました ✓`);
  });
  container.appendChild(row);
  row.querySelector('input').focus();
}

document.getElementById('add-bullet-btn').addEventListener('click', () => addBulletRow(''));
document.getElementById('add-prompt-btn').addEventListener('click', () => addPromptRow());

function copyPrompt(idx, videoId) {
  const v = state.videos.find(v => v.id === videoId);
  if (!v || !v.prompts[idx]) return;
  navigator.clipboard.writeText(v.prompts[idx].text).then(() => showToast('プロンプトをコピーしました ✓'));
}

/* ========== 星セレクター ========== */
document.querySelectorAll('.star').forEach(star => {
  star.addEventListener('click', () => {
    const val = parseInt(star.dataset.val);
    formStars = (formStars === val) ? 0 : val;
    document.getElementById('form-stars').value = formStars;
    updateStarUI(formStars);
  });
});

function updateStarUI(n) {
  document.querySelectorAll('.star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= n);
  });
}

/* ========== YouTube タイトル自動取得 ========== */
async function fetchYouTubeTitle(url) {
  const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  if (!res.ok) throw new Error('タイトル取得失敗');
  const data = await res.json();
  return data.title || '';
}

async function applyYouTubeUrl(url) {
  url = url.trim();
  if (!getYouTubeId(url)) return;

  document.getElementById('form-url').value = url;

  // 埋め込みプレビュー表示
  const embed = getEmbedUrl(url);
  if (embed) {
    document.getElementById('embed-iframe').src = embed;
    document.getElementById('embed-preview').style.display = 'block';
  }

  // タイトルが未入力なら自動取得
  const titleInput = document.getElementById('form-title');
  if (titleInput.value.trim()) return;

  const statusEl = document.getElementById('url-fetch-status');
  statusEl.className = 'url-fetch-status loading';
  statusEl.textContent = '⏳ タイトルを取得中...';
  statusEl.style.display = 'block';

  try {
    const title = await fetchYouTubeTitle(url);
    if (title) {
      titleInput.value = title;
      statusEl.className = 'url-fetch-status success';
      statusEl.textContent = `✓ タイトルを取得しました：${title}`;
      setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    }
  } catch {
    statusEl.className = 'url-fetch-status error';
    statusEl.textContent = 'タイトルの自動取得に失敗しました（手動で入力してください）';
    setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
  }
}

/* URL入力欄：貼り付け・入力完了でタイトル自動取得 */
const formUrlInput = document.getElementById('form-url');
formUrlInput.addEventListener('change', () => applyYouTubeUrl(formUrlInput.value));
formUrlInput.addEventListener('paste', e => {
  const pasted = (e.clipboardData || window.clipboardData).getData('text');
  if (getYouTubeId(pasted)) {
    e.preventDefault();
    applyYouTubeUrl(pasted);
  }
});

/* ========== ドラッグ＆ドロップ ========== */
const dropZone = document.getElementById('url-drop-zone');

dropZone.addEventListener('dragenter', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', e => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list') || '';
  const url = text.trim().split('\n')[0].trim();
  if (url) applyYouTubeUrl(url);
  else showToast('有効なYouTube URLをドロップしてください');
});

/* ========== プレビューボタン ========== */
document.getElementById('preview-btn').addEventListener('click', () => {
  const url = document.getElementById('form-url').value.trim();
  const embed = getEmbedUrl(url);
  if (embed) {
    document.getElementById('embed-iframe').src = embed;
    document.getElementById('embed-preview').style.display = 'block';
  } else {
    showToast('有効なYouTube URLを入力してください');
  }
});

/* ========== 保存 ========== */
document.getElementById('modal-save').addEventListener('click', saveVideo);

function saveVideo() {
  const title = document.getElementById('form-title').value.trim();
  const url = document.getElementById('form-url').value.trim();
  const category = document.getElementById('form-category').value;
  const memo = document.getElementById('form-memo').value.trim();
  const stars = parseInt(document.getElementById('form-stars').value) || 0;
  const reviewDate = document.getElementById('form-review-date').value;

  if (!title) { showToast('タイトルを入力してください'); return; }
  if (!category) { showToast('カテゴリを選んでください'); return; }

  const promptRows = document.querySelectorAll('#prompts-container .prompt-row');
  const prompts = Array.from(promptRows).map(row => ({
    description: row.querySelector('input').value.trim(),
    text: row.querySelector('textarea').value.trim(),
  })).filter(p => p.description || p.text);

  const bulletInputs = document.querySelectorAll('#bullets-container .bullet-row input');
  const bullets = Array.from(bulletInputs)
    .map(inp => inp.value.trim())
    .filter(t => t.length > 0)
    .map(text => {
      if (editingId) {
        const existing = state.videos.find(v => v.id === editingId);
        const old = existing?.bullets.find(b => b.text === text);
        return { text, checks: old ? old.checks : 0 };
      }
      return { text, checks: 0 };
    });

  if (editingId) {
    const idx = state.videos.findIndex(v => v.id === editingId);
    if (idx !== -1) state.videos[idx] = { ...state.videos[idx], title, url, category, memo, stars, reviewDate, bullets, prompts };
    showToast('保存しました ✓');
  } else {
    state.videos.unshift({ id: genId(), title, url, category, memo, stars, reviewDate, bullets, prompts });
    showToast('動画を追加しました ✓');
  }

  saveData();
  closeModal('video-modal');
  render();
}

/* ========== 削除 ========== */
function deleteVideo(id) {
  if (!confirm('この動画を削除しますか？')) return;
  state.videos = state.videos.filter(v => v.id !== id);
  saveData();
  closeModal('detail-modal');
  render();
  showToast('削除しました');
}

/* ========== モーダル開閉 ========== */
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  if (id === 'video-modal') {
    document.getElementById('embed-iframe').src = '';
    editingId = null;
  }
  if (id === 'detail-modal') {
    document.getElementById('detail-body').innerHTML = '';
    detailId = null;
  }
}

document.getElementById('add-video-btn').addEventListener('click', openAddModal);
document.getElementById('empty-add-btn').addEventListener('click', openAddModal);
document.getElementById('modal-close').addEventListener('click', () => closeModal('video-modal'));
document.getElementById('modal-cancel').addEventListener('click', () => closeModal('video-modal'));
document.getElementById('modal-clear').addEventListener('click', () => {
  if (!confirm('このカードの内容をすべてクリアしますか？')) return;
  document.getElementById('form-title').value = '';
  document.getElementById('form-url').value = '';
  document.getElementById('form-review-date').value = '';
  document.getElementById('form-memo').value = '';
  document.getElementById('form-stars').value = '0';
  document.getElementById('embed-preview').style.display = 'none';
  document.getElementById('embed-iframe').src = '';
  const fetchStatus = document.getElementById('url-fetch-status');
  if (fetchStatus) fetchStatus.style.display = 'none';
  formStars = 0;
  updateStarUI(0);
  document.getElementById('bullets-container').innerHTML = '';
  document.getElementById('prompts-container').innerHTML = '';
  showToast('内容をクリアしました');
});
document.getElementById('detail-close').addEventListener('click', () => closeModal('detail-modal'));
document.getElementById('detail-close-btn').addEventListener('click', () => closeModal('detail-modal'));
document.getElementById('detail-edit').addEventListener('click', () => {
  const id = detailId;
  closeModal('detail-modal');
  openEditModal(id);
});
document.getElementById('detail-delete').addEventListener('click', () => deleteVideo(detailId));

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

/* ========== 詳細モーダル ========== */
function openDetail(id) {
  const v = state.videos.find(v => v.id === id);
  if (!v) return;
  detailId = id;

  document.getElementById('detail-title').textContent = v.title;

  const embed = !isDummyUrl(v.url) ? getEmbedUrl(v.url) : null;
  const embedHtml = embed
    ? `<div class="detail-embed"><iframe src="${escHtml(embed)}" allowfullscreen></iframe></div>`
    : '';

  const reviewHtml = v.reviewDate
    ? `<span class="card-review ${isOverdue(v.reviewDate) ? 'overdue' : ''}">📅 ${v.reviewDate}に復習予定</span>`
    : '';

  const legendHtml = `
    <div class="check-legend">
      <span><span class="dot dot-red"></span>0個：意味がわからない</span>
      <span><span class="dot dot-yellow"></span>1個：覚えている</span>
      <span><span class="dot dot-green"></span>2個：実践した</span>
      <span><span class="dot dot-blue"></span>3個：特に大事</span>
    </div>
  `;

  const bulletsHtml = v.bullets.length > 0
    ? `<div class="detail-bullets">
        <h4>内容の箇条書き ${legendHtml}</h4>
        ${v.bullets.map((b, i) => `
          <div class="detail-bullet-row level-${b.checks}">
            ${checksHtml(b.checks, v.id, i)}
            <span class="bullet-text">${escHtml(b.text)}</span>
          </div>
        `).join('')}
      </div>`
    : '';

  const memoHtml = v.memo
    ? `<div class="form-group"><label style="font-size:13px;font-weight:700;color:var(--text-muted)">📝 メモ</label><div class="detail-memo">${escHtml(v.memo)}</div></div>`
    : '';

  const urlHtml = !isDummyUrl(v.url)
    ? `<div class="detail-url" style="margin-bottom:12px"><a href="${escHtml(v.url)}" target="_blank">▶ YouTubeで開く</a></div>`
    : '';

  const promptsHtml = (v.prompts && v.prompts.length > 0)
    ? `<div class="detail-prompts">
        <h4>📋 プロンプト記録</h4>
        ${v.prompts.map((p, i) => `
          <div class="detail-prompt-card">
            ${p.description ? `<div class="detail-prompt-label">${escHtml(p.description)}</div>` : ''}
            <div class="detail-prompt-text">
              ${escHtml(p.text)}
              <button class="copy-btn" onclick="copyPrompt(${i}, '${v.id}')">コピー</button>
            </div>
          </div>
        `).join('')}
      </div>`
    : '';

  document.getElementById('detail-body').innerHTML = `
    ${embedHtml}
    <div class="detail-meta">
      <span class="card-category">${escHtml(v.category)}</span>
      ${v.stars > 0 ? `<span class="card-stars" style="font-size:16px">${starsHtml(v.stars)}</span>` : ''}
      ${reviewHtml}
    </div>
    ${urlHtml}
    ${bulletsHtml}
    ${promptsHtml}
    ${memoHtml}
  `;

  document.getElementById('detail-modal').style.display = 'flex';
}

/* ========== カテゴリ追加 ========== */
document.getElementById('add-category-btn').addEventListener('click', () => {
  document.getElementById('new-category-input').value = '';
  document.getElementById('category-modal').style.display = 'flex';
});
document.getElementById('cat-modal-close').addEventListener('click', () => closeModal('category-modal'));
document.getElementById('cat-cancel').addEventListener('click', () => closeModal('category-modal'));
document.getElementById('cat-save').addEventListener('click', () => {
  const name = document.getElementById('new-category-input').value.trim();
  if (!name) { showToast('カテゴリ名を入力してください'); return; }
  if (state.categories.includes(name)) { showToast('同じ名前のカテゴリがあります'); return; }
  state.categories.push(name);
  saveData();
  closeModal('category-modal');
  render();
  showToast(`「${name}」を追加しました`);
});

/* ========== 全データクリア ========== */
document.getElementById('clear-all-btn').addEventListener('click', () => {
  if (state.videos.length === 0) { showToast('削除するデータがありません'); return; }
  if (!confirm(`登録されている動画 ${state.videos.length}本を全て削除しますか？\n\nこの操作は元に戻せません。\n（先に「書き出し」でバックアップすることをおすすめします）`)) return;
  state.videos = [];
  saveData();
  render();
  showToast('全データを削除しました');
});

/* ========== JSON バックアップ ========== */
document.getElementById('export-btn').addEventListener('click', () => {
  const data = JSON.stringify({ videos: state.videos, categories: state.categories }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `yt-note-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('バックアップを保存しました ✓');
});

document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data.videos)) throw new Error('フォーマットが不正です');
      if (!confirm(`${data.videos.length}本の動画を読み込みます。現在のデータは上書きされます。続けますか？`)) return;
      state.videos = data.videos;
      state.categories = data.categories || state.categories;
      saveData();
      render();
      showToast(`${state.videos.length}本の動画を読み込みました ✓`);
    } catch (err) {
      showToast(`読み込みエラー：${err.message}`);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

/* ========== キーボードショートカット ========== */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['detail-modal', 'video-modal', 'category-modal'].forEach(id => {
      if (document.getElementById(id).style.display !== 'none') closeModal(id);
    });
  }
});

/* ========== 初期化 ========== */
loadData();
generateDummyData();
render();
