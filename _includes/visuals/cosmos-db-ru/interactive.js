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

const format = new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format;

function updateWorkload(form) {
  const valid = form.checkValidity();
  document.querySelector("#input-error").hidden = valid;
  document.querySelector("#workload-result").hidden = !valid;
  if (!valid) return;
  const values = Object.fromEntries([...form.querySelectorAll("input, select")].map(input => [input.name, Number(input.value)]));
  const result = calculateWorkload(values);
  const scale = Math.max(values.capacity, result.total) * 1.2;
  document.querySelectorAll(".budget-row").forEach((row, index) => {
    const value = [...result.demand, result.total][index];
    row.classList.toggle("is-over", value > values.capacity);
    row.querySelector(".budget-value").textContent = `${format(value)} / ${format(values.capacity)} RU/s`;
    row.querySelector(".fill").style.width = `${value / scale * 100}%`;
    row.querySelector(".limit").style.left = `${values.capacity / scale * 100}%`;
    const track = row.querySelector(".track");
    track.setAttribute("aria-valuemax", String(scale));
    track.setAttribute("aria-valuenow", String(value));
    track.setAttribute("aria-valuetext", `${format(value)} RU/s requested; ${format(values.capacity)} RU/s budget`);
  });
  const balance = result.headroom < 0
    ? `${format(-result.headroom)} RU/s above capacity`
    : `${format(result.headroom)} RU/s headroom`;
  document.querySelector("#workload-status").textContent =
    `${format(result.total)} RU/s total · ${format(result.utilization)}% of capacity · ${balance}.`;
  document.querySelector("h1").textContent = `${format(result.total)} RU/s demand against ${format(values.capacity)} RU/s capacity`;
}

if (typeof document !== "undefined") {
  const tablist = document.querySelector('[role="tablist"]');
  if (tablist) {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const select = tab => tabs.forEach(candidate => {
      const active = candidate === tab;
      candidate.setAttribute("aria-selected", String(active));
      candidate.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(candidate.getAttribute("aria-controls"));
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("tabindex", "0");
      panel.hidden = !active;
    });
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", event => {
        const target = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
        if (target === undefined) return;
        event.preventDefault();
        select(tabs[target]);
        tabs[target].focus();
      });
    });
    select(tabs[0]);
    tablist.hidden = false;
  }
  const form = document.querySelector("form");
  if (form) {
    form.querySelector("fieldset").disabled = false;
    form.addEventListener("input", () => updateWorkload(form));
    form.addEventListener("change", () => updateWorkload(form));
    form.addEventListener("submit", event => event.preventDefault());
    form.addEventListener("reset", () => requestAnimationFrame(() => updateWorkload(form)));
    updateWorkload(form);
  }
}
