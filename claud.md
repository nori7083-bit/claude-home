# claud.md

このフォルダでは、仕事関連の資料作成に役立つ `claude` / `claud` 系ツールの基本コマンドと使い方をまとめます。

## 目的
- 仕事資料の作成支援
- コマンド操作を整理
- 引き継ぎや共有用の参照資料として利用

## 回答時の基本ルール
- 専門用語が出たときは、必ず初心者向けに簡単な説明を1文以上添える。
- できるだけ具体例や比喩を使って、意味が伝わるようにする。
- 文章や説明は、初めて触る人でも理解しやすい言葉でまとめる。

## 基本コマンド

- `claude code --help`
  - 利用可能なコマンド一覧とヘルプを表示します。

- `claude code version`
  - 現在のバージョンを確認します。

- `claude code explain <file|selection>`
  - 指定したコードや文章の説明を生成します。

- `claude code fix <file|selection>`
  - コードの問題を検出し、修正提案をします。

- `claude code refactor <file|selection>`
  - コードを改善・整形します。

- `claude code summarize <file|selection>`
  - ドキュメントやコードの要約を作成します。

- `claude code translate <source> --to <language>`
  - 言語やコードの翻訳を行います。

## 仕事資料作成の使い方例

1. 資料の要点を抽出
   - `claude code summarize report.md`

2. 内容を分かりやすく整理
   - `claude code explain report.md`

3. 表現を改善
   - `claude code fix report.md`

4. 別言語への翻訳
   - `claude code translate report.md --to ja`

## 使い方のポイント

- `--help` を使って、導入している環境のコマンド構成を確認する。
- ファイル名や選択範囲を指定して、必要な箇所だけを処理する。
- 仕事用資料では「要約」「説明」「表現改善」を中心に使うと効果的。

## 備考
- このファイルは仕事関連資料作成のための参考資料です。
- 実際のコマンドは利用中の Claude CLI や拡張機能に依存します。