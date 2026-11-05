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

test("article introduces data layout and RU metering before request factors and provisioning", () => {
  const headings = [...article.matchAll(/^## (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(headings, [
    "1. How data is laid out in Cosmos DB",
    "2. What is an RU, and how is it calculated?",
    "3. What affects the charge of a request?",
    "4. How much throughput should you provision?",
    "5. How does that capacity become a bill?",
    "Start with the workload, then validate the provisioned capacity",
    "Appendix: examples and test notes",
    "Sources",
  ]);
  assert.match(article, /^title: Understanding Azure Cosmos DB Request Units$/m);
  const [main, appendix] = article.split("## Appendix: examples and test notes");
  assert.equal((main.match(/```python\n/g) || []).length, 0);
  assert.equal((appendix.match(/```python\n/g) || []).length, 5);
  assert(!main.includes("measurements-2026-11-04.json"));
  assert(appendix.includes("measurements-2026-11-04.json"));
  assert(main.includes("**deterministic**"));
  assert(main.includes("does **not** provide a universal formula"));
  assert(main.includes("**Yes, consistency affects the RU charge.**"));
  assert(main.includes("same write operation stays unchanged"));
  const layout = main.slice(main.indexOf("## 1."), main.indexOf("## 2."));
  const pointReads = main.slice(main.indexOf("### Point reads:"), main.indexOf("### SQL queries:"));
  const queries = main.slice(main.indexOf("### SQL queries:"), main.indexOf("### Writes:"));
  assert(layout.includes("/visuals/cosmos-db-ru/data-layout.html"));
  assert(pointReads.includes("/visuals/cosmos-db-ru/query-cost.html"));
  assert(queries.includes("/visuals/cosmos-db-ru/query-fanout.html"));
  for (const heading of ["Partition scope:", "Filter expression:", "Projection:", "Result count:"]) {
    assert(queries.includes(`#### ${heading}`));
  }
  assert(!article.includes("/visuals/cosmos-db-ru/write-cost.html"));
});

test("hot-partition example exceeds local capacity despite spare total throughput", () => {
  const capacity = 1200;
  const demand = [700, 100, 100];
  const perPartition = capacity / demand.length;
  assert.equal(perPartition, 400);
  assert(demand[0] > perPartition);
  assert(demand.reduce((sum, ru) => sum + ru, 0) < capacity);
  assert(article.includes("| A | 400 RU/s | 700 RU/s |"));
  assert(article.includes("| **Total** | **1,200 RU/s** | **900 RU/s** |"));
});

test("article Python examples run against a paged test double", () => {
  const result = spawnSync("python3", ["tests/cosmos-db-ru-examples.py"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test("live response evidence supports the article comparisons and confirms cleanup", async () => {
  const record = JSON.parse(await readFile(new URL("../public/visuals/cosmos-db-ru/measurements-2026-11-04.json", import.meta.url), "utf8"));
  assert.equal(record.runs.length, 3);
  for (const { mode, result, arm_verified_configuration: config } of record.runs) {
    assert.equal(config.enableFreeTier, mode === "free");
    if (mode === "serverless") assert(config.capabilities.some(item => item.name === "EnableServerless"));
    else assert.equal(config.capacity.totalThroughputLimit, 400);
    const sample = name => result.samples.find(item => item.name === name);
    const total = result.samples.reduce((sum, item) => sum + item.ru, 0);
    assert(Math.abs(total - result.metered_ru) < 1e-6);
    assert.equal(result.samples.reduce((sum, item) => sum + item.responses.length, 0), result.metered_responses);
    assert(result.metered_ru < 20000);
    for (let repeat = 0; repeat < 3; repeat++) {
      assert.equal(sample(`point_read_1024_bytes_${repeat}`).ru, 1);
      assert.equal(sample(`point_read_102400_bytes_${repeat}`).ru, 9.95);
      assert.equal(sample(`equivalent_sql_${repeat}`).ru, 2.93);
      assert.equal(sample(`write_create_${repeat}`).ru, 15.38);
      assert.equal(sample(`write_replace_${repeat}`).ru, 11.38);
      assert.equal(sample(`write_patch_${repeat}`).ru, 11.7);
      assert.equal(sample(`targeted_index_create_${repeat}`).ru, 7);
    }
    assert.equal(sample("query_full_document").ru, 3.28);
    assert.equal(sample("query_zero_results").ru, 2.89);
    assert.equal(sample("pagination_max_100").ru, 3.29);
    assert.equal(sample("pagination_max_5").ru.toFixed(2), "11.38");
    assert.equal(sample("pagination_max_1").ru, 54.5);
    assert.deepEqual(sample("pagination_max_5").responses.map(page => page.ru), [2.92, 2.82, 2.82, 2.82]);
    for (const [name, ru] of [["query_scoped_same_ten_results", 3.31], ["query_unscoped_same_ten_results", 3.19],
      ["query_indexed_status", 3.16], ["query_lower_status", 4.7], ["offset_0_limit_5", 2.93],
      ["offset_100_limit_5", 5.32], ["offset_190_limit_5", 7.47]]) assert.equal(sample(name).ru, ru);
    if (mode !== "serverless") {
      for (const level of ["Strong", "BoundedStaleness"]) {
        assert.equal(sample(`consistency_point_${level}`).ru, 2);
        assert.equal(sample(`consistency_query_${level}`).ru, 5.86);
      }
    }
  }
  assert.equal(record.all_accounts_deleted_verified, true);
  assert(record.resource_lifecycle.every(account => account.deleted_verified));
  assert(record.cost_estimate.conservative_total_eur < 0.1);
  assert.equal(record.cost_estimate.actual_invoice_verified, false);
  assert(article.includes("**11.38 RU**"));
  assert(article.includes("| 1 | 20 | 54.50 RU |"));
  const sql = [...article.matchAll(/```sql\n([\s\S]*?)```/g)]
    .map(match => match[1].replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim()).join(" ");
  for (const query of [
    "SELECT c.id, c.total FROM c WHERE c.status = 'open' AND STARTSWITH(c.id, 'order-')",
    "SELECT c.id, c.total FROM c WHERE LOWER(c.status) = 'open'",
    "SELECT * FROM c WHERE c.status = 'open'",
    "SELECT * FROM c WHERE c.status = 'missing'",
    ...[0, 100, 190].map(offset => `SELECT c.id FROM c WHERE STARTSWITH(c.id, 'order-') OFFSET ${offset} LIMIT 5`),
  ]) assert(sql.includes(query), `Article must show the measured SQL: ${query}`);
});

test("public exports have only local controls, a matching CSP, and no network dependencies", async () => {
  for (const name of ["data-layout", "query-cost", "query-fanout", "write-cost", "workload-budget"]) {
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
    if (name !== "write-cost") assert(article.includes(`/visuals/cosmos-db-ru/${name}.html`));
    if (["data-layout", "query-cost", "query-fanout"].includes(name)) {
      assert.equal((content.match(/<figure\b/g) || []).length, 1);
    }
  }
  assert.doesNotMatch(article, /hot-partition\.html|```csharp|\.NET|Move the slider|—/);
});
