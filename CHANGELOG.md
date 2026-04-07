# Changelog

All notable changes to "Plan Manager" will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-04-08

### Added

- Issue 連携: プラン内容を GitHub / GitLab の Issue に直接送信（新規作成 / 既存 Issue へのコメント追加）
  Issue Integration: Send plan content directly to GitHub / GitLab Issues (create new or comment on existing)
- GitHub / GitLab の PAT (Personal Access Token) を SecretStorage に保存・再利用
  Store and reuse GitHub / GitLab PATs via SecretStorage
- `Set GitHub Token` / `Set GitLab Token` コマンドをコマンドパレットに追加
  Add `Set GitHub Token` / `Set GitLab Token` commands to Command Palette
- `Add to Issue` ボタンをカードアクションバーに追加（codicon-issue-opened アイコン）
  Add `Add to Issue` button to card action bar (codicon-issue-opened icon)
- カード右クリックメニューに「Issue に追加」を追加
  Add "Add to Issue" to card context menu
- Git remote 自動検出（plan ファイルパス優先 → ワークスペース走査）
  Auto-detect Git remotes (plan file path priority, then workspace scan)
- 複数リポジトリ候補時の QuickPick 選択
  QuickPick selection when multiple repository candidates are found
- Self-hosted GitLab 対応（`planManager.gitlabBaseUrl` 設定）
  Self-hosted GitLab support via `planManager.gitlabBaseUrl` setting
- エラーコード別の UI ハンドリング（PlanManagerError による構造化エラー）
  Code-based error UI handling via PlanManagerError

### Fixed

- 同一リポジトリが大文字/小文字違いで重複表示される問題を修正（dedup キーを case-insensitive に）
  Fix duplicate repository entries caused by case-sensitive dedup key
- GitLab ホスト名の大文字/小文字が `.git/config` と設定値で異なる場合にマッチしない問題を修正
  Fix GitLab hostname comparison failing when `.git/config` uses different casing

## [0.1.4] - 2026-03-31

### Improved

- エージェント連携プロンプトを構造化テンプレートに刷新（変換指示・QA検証・実行の3ステップ）
  Restructure agent prompts with step-by-step templates (validate, convert, execute)
- プロンプトのロケール対応（日本語IDE環境で日本語プロンプトを生成）
  Add locale-aware prompt generation (Japanese prompts for `ja` locale)
- 変換先パスをユーザー設定 (`cursorPlansPath` / `claudePlansPath`) から動的取得
  Use user-configured plan directories instead of hardcoded paths

### Fixed

- ターミナル送信時に改行がシェルのコマンド区切りとして解釈される問題を修正
  Fix newlines in shell-escaped prompts breaking terminal commands

## [0.1.3] - 2026-03-29

### Fixed

- 軽微なバグの修正
  Minor bug fixes

## [0.1.2] - 2026-03-29

### Fixed

- カード本体のシングルクリックでプランが開けない問題を修正
  Fix single-click on plan card not opening the file

### Removed

- `planManager.defaultClickAction` 設定を廃止（シングルクリックは常にプレビュー表示に統一）
  Remove `planManager.defaultClickAction` setting (single-click now always opens preview)

## [0.1.1] - 2026-03-29

### Fixed

- Windows でチルダ (`~\`) を含むカスタムスキャンパスが展開されない問題を修正
  Fix tilde expansion for backslash paths (`~\`) on Windows
- Windows のターミナルコマンドでバックスラッシュを含むパスがシェルに正しく渡らない問題を修正
  Fix path separators in terminal commands for cross-platform shell compatibility

## [0.1.0] - 2026-03-29

### Added

- プラン一覧: Claude Code / Cursor のプランファイルをサイドバー TreeView で一覧表示
  Plan List: Browse Claude Code / Cursor plan files in sidebar TreeView
- パスコピー: プランファイルのフルパスをクリップボードにコピー
  Copy Path: Copy full path of plan file to clipboard
- 生成時刻表示: ファイルの作成日時・更新日時をツールチップで表示
  Timestamp Display: Show file creation and modification dates in tooltip
- Cursor プランに変換: Claude Code プランを Cursor プラン形式（YAML フロントマター付き）にワンクリック変換
  Convert to Cursor Plan: One-click conversion of Claude Code plans to Cursor format (with YAML frontmatter)
- Claude プランに変換: Cursor プランを Claude Code プラン形式にワンクリック変換
  Convert to Claude Plan: One-click conversion of Cursor plans to Claude Code format
- Finder で表示: ファイルの場所を OS ファイルマネージャーで直接開く
  Reveal in Finder: Open file location in OS file manager
- 自動更新: FileSystemWatcher によるプラン一覧のリアルタイム更新
  Auto Refresh: Real-time plan list updates via FileSystemWatcher
- 設定: スキャンパス / 更新間隔 / クリック動作のカスタマイズ
  Configuration: Customize scan paths / refresh interval / click action
- i18n: 日本語 / English 対応（検索メニューラベル・カードアクションボタンツールチップ。VS Code ロケールに自動追従）
  i18n: Japanese / English support (search menu labels & card action button tooltips, auto-follows VS Code locale)
