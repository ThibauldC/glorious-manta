import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { calculateWorkload } from "../_includes/visuals/cosmos-db-ru/interactive.js";

const example = { reads: 200, readRu: 1, writes: 20, writeRu: 7, queries: 10, queryRu: 15, capacity: 1000 };
const runtime = await readFile(new URL("../_includes/visuals/cosmos-db-ru/interactive.js", import.meta.url), "utf8");
const article = await readFile(new URL("../content/posts/2026-10-29-azure-cosmos-db-request-units.md", import.meta.url), "utf8");

test("workload matches the post, including the stronger-read consistency estimate", () => {
  assert.deepEqual(calculateWorkload(example), {
    demand: [200, 140, 150], total: 490, utilization: 49, headroom: 510,
  });
  const strong = calculateWorkload({ ...example, multiplier: 2 });
  assert.deepEqual(strong.demand, [400, 140, 300]);
  assert.equal(strong.total, 840);
  assert.equal(strong.headroom, 160);
});

test("workload handles zero traffic, fractional charges, and demand above capacity", () => {
  assert.equal(calculateWorkload({ ...example, reads: 0, writes: 0, queries: 0 }).total, 0);
  assert.equal(calculateWorkload({ ...example, readRu: 1.25 }).total, 540);
  const over = calculateWorkload({ ...example, reads: 1000 });
  assert.equal(over.total, 1290);
  assert.equal(over.headroom, -290);
});

test("invalid workload values do not produce misleading estimates", () => {
  for (const key of Object.keys(example)) {
    for (const value of [-1, NaN, Infinity, "", "1"]) {
      assert.throws(() => calculateWorkload({ ...example, [key]: value }), RangeError);
    }
  }
  assert.throws(() => calculateWorkload({ ...example, capacity: 0 }), RangeError);
  assert.throws(() => calculateWorkload({ ...example, multiplier: 3 }), RangeError);
  assert.throws(() => calculateWorkload({ ...example, readRu: Number.MAX_VALUE }), RangeError);
});

test("write tabs support click, wrapping arrow keys, Home and End", () => {
  const panels = new Map();
  const tabs = ["create", "replace", "patch"].map(name => {
    panels.set(name, { hidden: false, setAttribute() {} });
    return {
      attributes: { "aria-controls": name }, listeners: {},
      getAttribute(key) { return this.attributes[key]; },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, callback) { this.listeners[key] = callback; },
      focus() { this.focused = true; },
    };
  });
  const tablist = { hidden: true, querySelectorAll: () => tabs };
  const document = {
    querySelector: selector => selector === '[role="tablist"]' ? tablist : null,
    getElementById: id => panels.get(id),
  };
  runInNewContext(runtime.replace(/^export /gm, ""), { document, Intl });
  const selected = () => tabs.findIndex(tab => tab.attributes["aria-selected"] === "true");
  const key = (index, value) => tabs[index].listeners.keydown({ key: value, preventDefault() {} });
  assert.equal(tablist.hidden, false);
  assert.equal(selected(), 0);
  assert.equal(panels.get("replace").hidden, true);
  tabs[1].listeners.click();
  assert.equal(selected(), 1);
  assert.equal(panels.get("create").hidden, true);
  assert.equal(panels.get("replace").hidden, false);
  key(1, "End");
  assert.equal(selected(), 2);
  key(2, "ArrowRight");
  assert.equal(selected(), 0);
  key(0, "ArrowLeft");
  assert.equal(selected(), 2);
  key(2, "Home");
  assert.equal(selected(), 0);
  assert.equal(tabs[0].tabIndex, 0);
  assert.equal(tabs[2].tabIndex, -1);
  assert.equal(tabs[0].focused, true);
});

test("West Europe monthly costs match the article", () => {
  const continuousMillionRu = 490 * 3600 * 730 / 1e6;
  const intermittentMillionRu = 490 * 3600 * 30 / 1e6;
  const manual = 1000 / 100 * 0.008 * 730;
  const storage = 10 * 0.25;
  assert.equal(continuousMillionRu, 1287.72);
  assert.equal(intermittentMillionRu, 52.92);
  assert.equal(manual.toFixed(2), "58.40");
  assert(article.includes("**$0.305 per million consumed RUs**"));
  assert(article.includes("**$0.008 per 100 RU/s-hour**"));
  for (const [ru, request, total] of [[continuousMillionRu, "392.75", "395.25"], [intermittentMillionRu, "16.14", "18.64"]]) {
    assert.equal((ru * 0.305).toFixed(2), request);
    assert.equal((ru * 0.305 + storage).toFixed(2), total);
    assert(article.includes(`$${request}`));
    assert(article.includes(`$${total}`));
  }
  assert.equal((manual + storage).toFixed(2), "60.90");
  assert.equal((manual / 0.305).toFixed(1), "191.5");
  assert.equal((manual / 0.305 / (490 * 3600 / 1e6)).toFixed(1), "108.5");
});

test("article Python examples run against a paged test double", () => {
  const result = spawnSync("python3", ["tests/cosmos-db-ru-examples.py"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test("public exports have only local controls, a matching CSP, and no network dependencies", async () => {
  for (const name of ["write-cost", "query-cost", "workload-budget"]) {
    const html = await readFile(new URL(`../public/visuals/cosmos-db-ru/${name}.html`, import.meta.url), "utf8");
    const content = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "");
    assert.match(html, /data-register="(?:paper|instrument)"/);
    assert.doesNotMatch(content, /am-toolbar|am-colophon|am-source|<textarea|Generated by|Star on GitHub|<ve-ask|<link[^>]+https:/);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0][1], ' type="module"');
    assert.equal(scripts[0][2], `\n${runtime}\n`);
    const hash = createHash("sha256").update(scripts[0][2]).digest("base64");
    assert(html.includes(`script-src 'sha256-${hash}';`));
    assert(html.includes("connect-src 'none'"));
    assert.match(html, /prefers-reduced-motion: reduce/);
    assert.equal((content.match(/<figure\b/g) || []).length, (content.match(/<figcaption>/g) || []).length);
    assert(article.includes(`/visuals/cosmos-db-ru/${name}.html`));
  }
  assert.doesNotMatch(article, /hot-partition\.html|```csharp|\.NET|Move the slider|—/);
});
