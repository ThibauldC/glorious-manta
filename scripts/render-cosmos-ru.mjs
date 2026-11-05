import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sources = join(root, "_includes/visuals/cosmos-db-ru");
const cli = process.env.VE_CLI || join(homedir(), ".pi/agent/git/github.com/nicobailon/visual-explainer/plugins/visual-explainer/kit/render.mjs");
const staging = process.env.VISUAL_EXPLAINER_OUTPUT_DIR || join(homedir(), ".agent/diagrams");
const runtime = `\n${await readFile(join(sources, "interactive.js"), "utf8")}\n`;
const css = await readFile(join(sources, "interactive.css"), "utf8");
const hash = createHash("sha256").update(runtime).digest("base64");
const policy = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'`;
await mkdir(staging, { recursive: true });

for (const name of ["data-layout", "query-cost", "query-fanout", "write-cost", "workload-budget"]) {
  const source = (await readFile(join(sources, `${name}.src.html`), "utf8"))
    .replace("/* COSMOS_STYLE */", css).replace("/* COSMOS_RUNTIME */", runtime);
  const staged = join(staging, `cosmos-ru-${name}.src.html`);
  const rendered = join(staging, `cosmos-ru-${name}.html`);
  await writeFile(staged, source);
  const result = spawnSync(process.execPath, [cli, staged, "-o", rendered, "--root", root, "--no-check"], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Rendering ${name} failed.`);
  let html = await readFile(rendered, "utf8");
  // Publish the figures and local controls without the kit's feedback runtime.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/g, "")
    .replace(/<link\b[^>]*href="https:[^>]*>\s*/g, "");
  html = html.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`)
    .replace("</body>", `<script type="module">${runtime}</script>\n</body>`);
  assert(!/<script\b[^>]*src=/.test(html), "Public visuals must not load remote scripts.");
  const destination = join(root, "public/visuals/cosmos-db-ru", `${name}.html`);
  await writeFile(destination, html);
  console.log(`✓ ${destination}`);
}
