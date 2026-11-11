import esbuild from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
const watch = process.argv.includes("--watch");
async function boardHtml() {
  const code = await esbuild.build({
    entryPoints: ["src/board.ts"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
    platform: "browser",
    minify: true,
  });
  const css = await readFile("src/board.css", "utf8");
  let fonts = "";
  for (const [family, slug, weights] of [
    ["IBM Plex Sans", "ibm-plex-sans", [400, 600]],
    ["IBM Plex Mono", "ibm-plex-mono", [400]],
  ])
    for (const weight of weights) {
      const bytes = await readFile(
        `node_modules/@fontsource/${slug}/files/${slug}-latin-${weight}-normal.woff2`,
      );
      fonts += `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2');}`;
    }
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'"><title>Sebastians Aufgaben-Board</title><style>${fonts}${css}</style></head><body><div id="app"></div><script>${code.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await mkdir("dist/ui", { recursive: true });
  const licensedHtml = html.replace(
    "</head>",
    "<!-- IBM Plex font license\n" +
      (await readFile("licenses/IBM-Plex-OFL.txt", "utf8")) +
      "\n--></head>",
  );
  await writeFile("dist/ui/board.html", licensedHtml);
  await writeFile("dist/aufgaben-board.html", licensedHtml);
}
await boardHtml();

const workerCtx = await esbuild.context(presets.esbuild.worker);
const manifestCtx = await esbuild.context(presets.esbuild.manifest);
const uiCtx = await esbuild.context({
  ...presets.esbuild.ui,
  loader: { ".html": "text" },
});

if (watch) {
  const { watch: watchFiles } = await import("node:fs");
  for (const filename of ["src/board.ts", "src/board.css", "src/model.ts"])
    watchFiles(filename, () => {
      void boardHtml().catch(console.error);
    });
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx.watch()]);
  console.log("esbuild watch mode enabled for worker, manifest, and ui");
} else {
  await Promise.all([
    workerCtx.rebuild(),
    manifestCtx.rebuild(),
    uiCtx.rebuild(),
  ]);
  await Promise.all([
    workerCtx.dispose(),
    manifestCtx.dispose(),
    uiCtx.dispose(),
  ]);
}
