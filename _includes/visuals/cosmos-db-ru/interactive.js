export function calculateWorkload({ reads, readRu, writes, writeRu, queries, queryRu, capacity, multiplier = 1 }) {
  if (![reads, readRu, writes, writeRu, queries, queryRu].every(value => Number.isFinite(value) && value >= 0)
      || !Number.isFinite(capacity) || capacity <= 0 || ![1, 2].includes(multiplier)) {
    throw new RangeError("Use finite, non-negative rates and charges, a positive capacity, and a read multiplier of 1 or 2.");
  }
  const demand = [reads * readRu * multiplier, writes * writeRu, queries * queryRu * multiplier];
  const total = demand.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total)) throw new RangeError("The workload exceeds the numeric range.");
  return { demand, total, utilization: total / capacity * 100, headroom: capacity - total };
}

export function calculateWrite(terms) {
  if (!Number.isInteger(terms) || terms < 0 || terms > 50) throw new RangeError("Use 0–50 indexed terms.");
  return 5 + terms * 0.2;
}

export function calculatePartitions(demand) {
  if (demand.length !== 3 || !demand.every(value => Number.isFinite(value) && value >= 0 && value <= 1200)) {
    throw new RangeError("Use three partition demands from 0 to 1,200 RU/s.");
  }
  return { total: demand.reduce((sum, value) => sum + value, 0), over: demand.map(value => value > 400) };
}

const format = new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format;
const formatTick = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format;

function updateBars(values, limit, scale, labels) {
  document.querySelectorAll(".am-lim").forEach((row, index) => {
    const value = values[index];
    row.classList.toggle("is-over", value > limit);
    row.querySelector(".am-lim-head > span").textContent = labels[index];
    row.querySelector(".am-lim-val").textContent = `${format(value)} / ${format(limit)} RU/s`;
    row.querySelector(".am-lim-fill").style.width = `${value / scale * 100}%`;
    row.querySelector(".am-lim-mark").style.left = `${limit / scale * 100}%`;
    row.querySelector(".am-lim-ticks").replaceChildren(...Array.from({ length: 7 }, (_, index) => {
      const tick = document.createElement("span");
      tick.textContent = formatTick(scale * index / 6);
      tick.style.left = `${index / 6 * 100}%`;
      return tick;
    }));
    const track = row.querySelector(".am-lim-track");
    track.setAttribute("role", "meter");
    track.setAttribute("aria-label", labels[index]);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(scale));
    track.setAttribute("aria-valuenow", String(value));
    track.setAttribute("aria-valuetext", `${format(value)} RU/s requested; ${format(limit)} RU/s budget`);
  });
}

function updateWorkload(form) {
  const valid = form.checkValidity();
  document.querySelector("#input-error").hidden = valid;
  document.querySelector("#panel-B").hidden = !valid;
  if (!valid) return;
  const values = Object.fromEntries([...form.querySelectorAll("input, select")].map(input => [input.name, Number(input.value)]));
  const result = calculateWorkload(values);
  updateBars([...result.demand, result.total], values.capacity, Math.max(values.capacity, result.total) * 1.2,
    ["Point reads", "Creates", "Queries", "Combined demand"]);
  const balance = result.headroom < 0
    ? `${format(-result.headroom)} RU/s above capacity`
    : `${format(result.headroom)} RU/s headroom`;
  document.querySelector("#workload-status").textContent =
    `${format(result.total)} RU/s total · ${format(result.utilization)}% of capacity · ${balance}.`;
}

function updateWrite(form) {
  const terms = form.elements.terms.valueAsNumber;
  const total = calculateWrite(terms);
  document.querySelector("#terms-value").value = String(terms);
  document.querySelector("#panel-B h2").textContent = `5 RU + ${format(total - 5)} RU = ${format(total)} RU`;
  const cells = document.querySelectorAll(".am-kv dd");
  cells[1].textContent = `${terms} terms × 0.2 RU = ${format(total - 5)} RU`;
  cells[2].textContent = `${format(total)} RU`;
  document.querySelector("#write-status").textContent = `${terms} indexed terms: ${format(total)} RU per create in this example.`;
}

function updatePartitions(form) {
  const keys = ["a", "b", "c"];
  const demand = keys.map(key => form.elements[key].valueAsNumber);
  const result = calculatePartitions(demand);
  keys.forEach((key, index) => { document.querySelector(`#${key}-value`).value = `${format(demand[index])} RU/s`; });
  updateBars(demand, 400, 1200, ["Physical partition A", "Physical partition B", "Physical partition C"]);
  const hot = keys.filter((key, index) => result.over[index]).map(key => key.toUpperCase());
  const summary = hot.length ? `Above the per-partition budget: ${hot.join(", ")}.` : "No partition exceeds its budget.";
  document.querySelector("#partition-status").textContent = `${format(result.total)} RU/s requested in total. ${summary}`;
  const callout = document.querySelector(".am-callout");
  callout.classList.toggle("am-callout--warn", hot.length > 0);
  callout.classList.toggle("am-callout--ok", hot.length === 0);
  callout.querySelector(".am-callout-title").textContent = hot.length ? `Potential throttling on ${hot.join(", ")}` : "Within each partition's budget";
  callout.querySelector(".am-callout-body p").textContent =
    "Each partition has 400 RU/s in this example. Spare capacity elsewhere does not raise that allocation. Real allocations can change with dynamic autoscale or throughput redistribution.";
}

if (typeof document !== "undefined") {
  const form = document.querySelector("form");
  const update = {
    "workload-budget": updateWorkload,
    "write-cost": updateWrite,
    "hot-partition": updatePartitions,
  }[document.body.dataset.visual];
  form.querySelector("fieldset").disabled = false;
  form.addEventListener("input", () => update(form));
  form.addEventListener("change", () => update(form));
  form.addEventListener("submit", event => event.preventDefault());
  form.addEventListener("reset", () => requestAnimationFrame(() => update(form)));
  update(form);
}
