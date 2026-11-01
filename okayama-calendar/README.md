# 岡山県ダンススポーツ連盟 イベントカレンダー

ホームページ（okayama.jdsf-seibu.com）の「イベントカレンダー」に表示する、小さなページです。
中身は Google カレンダー「JDSF岡山イベント情報」で、予定を足せば自動で表示されます。

- パソコン（画面の幅が641px以上）：月ごとの表
- スマホ（640px以下）：予定の一覧

## 公開のしかた（Mac のターミナル）
```
cd ~/Desktop/claude-home/photo-gallery && npx wrangler pages deploy ../okayama-calendar --project-name okayama-calendar
```
公開されたら、`https://okayama-calendar.pages.dev` をサイト管理のカレンダーのリンクに貼ります。
このページを直したときだけ、もう一度公開します。予定を足すだけなら公開し直す必要はありません。
