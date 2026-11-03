import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sources = join(root, "_includes/visuals/cosmos-db-ru");
const cli = process.env.AM_CLI || join(homedir(), ".agents/skills/answer-me-with-html/scripts/am.mjs");
const runtime = `\n${await readFile(join(sources, "interactive.js"), "utf8")}\n`;
const css = await readFile(join(sources, "interactive.css"), "utf8");
const hash = createHash("sha256").update(runtime).digest("base64");
const policy = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'`;
const temporary = await mkdtemp(join(tmpdir(), "cosmos-ru-render-"));

try {
  for (const name of ["write-cost", "workload-budget", "hot-partition"]) {
    const rendered = join(temporary, `${name}.html`);
    const result = spawnSync(process.execPath, [cli, "render", join(sources, `${name}.md`),
      "--no-open", "--style", "strict", "-o", rendered], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Rendering ${name} failed.`);
    let html = await readFile(rendered, "utf8");
    assert(html.includes('data-theme="shadcn"'), "Public visuals must use Cards.");

    // Fail closed if a renderer update changes the authoring markup.
    for (const pattern of [
      /<div class="am-toolbar"[^>]*>[\s\S]*?<\/div>\s*/g,
      /<p class="am-colophon">[\s\S]*?<\/p>/g,
      /<textarea id="am-source"[^>]*>[\s\S]*?<\/textarea>\s*/g,
      /<meta name="generator"[^>]*>\s*/g,
    ]) {
      assert.equal([...html.matchAll(pattern)].length, 1, `Unexpected renderer markup: ${pattern}`);
      html = html.replace(pattern, "");
    }
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/g, "");
    assert(!html.includes("<script"), "Remove the authoring runtime before publishing.");
    const csp = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/g;
    assert.equal([...html.matchAll(csp)].length, 1);
    html = html.replace(csp, `<meta http-equiv="Content-Security-Policy" content="${policy}">`)
      .replace("</style>", `${css}</style>`)
      .replace("<body>", `<body data-visual="${name}">`)
      .replace("</body>", `<script type="module">${runtime}</script>\n</body>`);
    const destination = join(root, "public/visuals/cosmos-db-ru", `${name}.html`);
    await writeFile(destination, html);
    console.log(`✓ ${destination} (public Cards export; no authoring UI)`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
