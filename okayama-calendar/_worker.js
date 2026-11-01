// Cloudflare Pages の「_worker.js」。ページの表示はそのまま返し、
// /events.json だけ、公開中の Google カレンダーの予定を読み込んで一覧用のデータにして返す。
// （ブラウザから Google の予定ファイルを直接読むことはできないので、ここで中継する）

const CALENDAR_ID = '9ebb3213869f1721c4e0b0e74ecd89fe9d4c0a080dbb4f4034b070fa78ce72e9@group.calendar.google.com';
const ICS_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CALENDAR_ID)}/public/basic.ics`;
// Google に何度も読みに行かないよう、5分間は前に読んだものを使う
const CACHE_SECONDS = 300;
// 一覧に出す期間（今日から何か月先まで）
const MONTHS_AHEAD = 18;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/events.json') return eventsResponse();
    return env.ASSETS.fetch(request);
  },
};

async function eventsResponse() {
  try {
    const res = await fetch(ICS_URL, { cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } });
    if (!res.ok) throw new Error(`Google カレンダーから読み込めませんでした (${res.status})`);
    const events = upcoming(parseIcs(await res.text()), todayInJapan(), MONTHS_AHEAD);
    return json({ events }, 200);
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? `public, max-age=${CACHE_SECONDS}` : 'no-store',
    },
  });
}

// ---- 予定ファイル（iCalendar 形式）の読み取り ----

export function parseIcs(text) {
  // 長い行は「改行＋空白」で折り返されているので、つなぎ直す
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(';');
    const value = line.slice(colon + 1);
    cur[name.toUpperCase()] = { value, params: params.map(p => p.toUpperCase()) };
  }
  return events
    .filter(e => e.DTSTART && (e.STATUS?.value || '').toUpperCase() !== 'CANCELLED')
    .map(e => {
      const start = parseDate(e.DTSTART);
      const end = e.DTEND ? parseDate(e.DTEND) : null;
      // 終日の予定の終わりの日は「次の日」で書かれているので、1日戻す
      const endDate = end ? (start.allDay ? addDays(end.date, -1) : end.date) : start.date;
      return {
        date: start.date,
        endDate: endDate > start.date ? endDate : null,
        allDay: start.allDay,
        start: start.time,
        end: !start.allDay && end && end.date === start.date ? end.time : null,
        title: unescapeText(e.SUMMARY?.value || '（題名なし）'),
        location: unescapeText(e.LOCATION?.value || ''),
        description: htmlToText(unescapeText(e.DESCRIPTION?.value || '')),
        repeats: Boolean(e.RRULE),
      };
    });
}

// 日付は日本時間に直して「2027-01-24」と「13:00」の形にする
function parseDate({ value, params }) {
  if (params.includes('VALUE=DATE') || /^\d{8}$/.test(value)) {
    return { date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, time: null, allDay: true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return { date: value.slice(0, 10), time: null, allDay: true };
  const [, y, mo, d, h, mi, s, z] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  // 「Z」が付いていれば世界標準時なので、日本時間（+9時間）に直す。
  // 付いていなければ、カレンダーの時間帯（日本時間）として扱う
  if (z) t += 9 * 3600 * 1000;
  const dt = new Date(t);
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    time: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`,
    allDay: false,
  };
}

// Google カレンダーの説明は、リンクを入れると <a href="…">…</a> のような書き方になる。
// 文字とリンクの住所だけを取り出して、ふつうの文章に直す（リンクは一覧の側で押せるようにする）
export function htmlToText(s) {
  if (!/<[a-z!/]/i.test(s)) return s;
  return decodeEntities(s
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const url = unwrapGoogleUrl(decodeEntities(href));
      const label = decodeEntities(text.replace(/<[^>]*>/g, '')).trim();
      return !label || label === url || url.includes(label) ? url : `${label}：${url}`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '・')
    .replace(/<[^>]*>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Google が付け足す「https://www.google.com/url?q=本当の住所」を、本当の住所に戻す
function unwrapGoogleUrl(url) {
  const m = url.match(/^https?:\/\/www\.google\.[a-z.]+\/url\?(?:.*&)?q=([^&]+)/i);
  return m ? decodeURIComponent(m[1]) : url;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function unescapeText(s) {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
}

function addDays(date, n) {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function todayInJapan(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 今日以降（何日かにまたがる予定は、まだ終わっていないもの）を日付順に並べる
export function upcoming(events, today, monthsAhead) {
  const until = addDays(today, Math.round(monthsAhead * 30.5));
  return events
    .filter(e => (e.endDate || e.date) >= today && e.date <= until)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
}
