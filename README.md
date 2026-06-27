# Claude Code 基本コマンド一覧

このドキュメントでは、Claude Code における基本的なコマンドをまとめています。バージョンや導入環境によってコマンド名が異なる場合がありますので、最新のドキュメントや `--help` オプションもあわせてご確認ください。

## Slide Generator

Markdown から簡単な HTML スライドデッキを生成するスクリプトを追加しました。

### 使い方

- 標準入力から生成
  - `python3 slide_generator.py -`
- ファイルから生成
  - `python3 slide_generator.py deck.md deck.html`
- タイトルを指定
  - `python3 slide_generator.py deck.md deck.html --title "My Deck"`

### 入力形式

- `---` を使うとスライド区切りになります。
- `#` から `######` で見出し、`-` で箇条書きが作成されます。

## 1. 基本コマンド

- `claude --help`
  - コマンド一覧やヘルプ情報を表示します。

- `claude --version`
  - インストールされている Claude Code のバージョンを表示します。

- `claude init`
  - プロジェクトやワークスペースの初期化を行います（CLAUDE.md を生成）。

- `claude <file>`
  - 指定ファイルのコード解析やレビューを実行します。

- `claude "explain <file>"`
  - コードの内容や動作を自然言語で説明します。

- `claude "fix <file>"`
  - 問題のあるコードを修正提案します。

- `claude "refactor <file>"`
  - コードのリファクタリングを支援します。

- `claude "translate <source> to <language>"`
  - コードやコメントを別のプログラミング言語や自然言語に翻訳します。

- `claude "summarize <file>"`
  - コード全体や選択範囲の要約を生成します。

- `claude "write tests for <file>"`
  - テストケースの生成やテスト実行の補助を行います。

## 2. 便利なオプション

- `--input <path>` / `-i <path>`
  - 入力ファイルやディレクトリを指定します。

- `--output <path>` / `-o <path>`
  - 出力先ファイルやディレクトリを指定します。

- `--format <style>`
  - 出力形式やフォーマットを指定します。

- `--prompt <text>`
  - 生成や解析時に追加の指示を与えます。

- `--verbose`
  - 詳細なログや実行情報を表示します。

## 3. よく使うワークフロー例

1. ヘルプを確認
   - `claude --help`

2. コード説明を取得
   - `claude "explain src/main.py"`

3. バグ修正提案を取得
   - `claude "fix src/main.py"`

4. リファクタリングを実行
   - `claude "refactor src/main.py"`

5. テストを作成
   - `claude "write tests for src/main.py"`

## 4. 使い方のポイント

- まずは `--help` を使って、導入しているバージョンの正確なコマンド構成を確認しましょう。
- `file` の部分には対象のソースファイルやコード領域を指定します。
- `selection` はエディタ上の選択範囲を指すことが多く、VS Code などの統合環境で動作する場合に便利です。

## 5. 参考

- `claude --help`
- `claude --version`
- 使用中の Claude Code エクステンションや CLI の公式ドキュメント
