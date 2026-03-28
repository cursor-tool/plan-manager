# Contributing

コントリビューションを歓迎します。

## 開発環境

```bash
npm install
```

## 開発コマンド

```bash
npm run compile          # Extension ビルド
npx tsc --noEmit         # 型チェック
npm run package          # VSIX 生成
```

## ビルド反映の注意

マーケットプレイスからインストール済みの拡張機能は `~/.cursor/extensions/` にコピーされます。開発ディレクトリでのビルドは**自動反映されません**。

```bash
# ビルド後、インストール先にコピー
cp out/extension.js out/extension.js.map \
   ~/.cursor/extensions/pacific-system.plan-manager-0.1.0/out/
cp out/webview/{main.js,main.js.map,styles.css} \
   ~/.cursor/extensions/pacific-system.plan-manager-0.1.0/out/webview/
# Reload Window で反映
```

または F5 で Extension Development Host を起動すれば開発ディレクトリから直接読み込まれます。

## Pull Request

- 変更理由と内容を簡潔に説明してください
- UI 変更がある場合はスクリーンショットを添付してください
- 以下を満たしていることを確認してください:
  - `npm run compile` が通る
  - `npx tsc --noEmit` が通る
  - トークンや秘密情報がコード・ログ・スクリーンショットに含まれていない

## バグ報告・機能要望

[Issue](https://github.com/cursor-tool/plan-manager/issues) で受け付けています。

## ライセンス

本プロジェクトへの貢献は [MIT License](LICENSE) のもとで提供されます。
