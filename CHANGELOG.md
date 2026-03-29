# Changelog

All notable changes to "Plan Manager" will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
