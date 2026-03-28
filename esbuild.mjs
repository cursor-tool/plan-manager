import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionBuildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "ES2022",
  sourcemap: true,
  minify: false,
};

/** @type {import('esbuild').BuildOptions} */
const webviewBuildOptions = {
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  outfile: "out/webview/main.js",
  format: "iife",
  platform: "browser",
  target: "ES2022",
  sourcemap: true,
  minify: false,
};

function copyWebviewAssets() {
  const outDir = "out/webview";
  fs.mkdirSync(outDir, { recursive: true });

  // Copy codicon CSS and font from @vscode/codicons
  const codiconsDir = path.join("node_modules", "@vscode", "codicons", "dist");
  fs.copyFileSync(path.join(codiconsDir, "codicon.css"), path.join(outDir, "codicon.css"));
  fs.copyFileSync(path.join(codiconsDir, "codicon.ttf"), path.join(outDir, "codicon.ttf"));

  // Copy webview styles
  fs.copyFileSync(path.join("src", "webview", "styles.css"), path.join(outDir, "styles.css"));
}

async function main() {
  if (isWatch) {
    const [extCtx, webCtx] = await Promise.all([
      esbuild.context(extensionBuildOptions),
      esbuild.context(webviewBuildOptions),
    ]);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    copyWebviewAssets();
    console.log("Watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(extensionBuildOptions),
      esbuild.build(webviewBuildOptions),
    ]);
    copyWebviewAssets();
    console.log("Build complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
