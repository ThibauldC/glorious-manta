---
title: RU workload calculator
subtitle: One region · illustrative inputs · edit the values to move the bars
theme: shadcn
lang: en
cols: 1
---
## A Set request rates and charges
Enter session-consistency charges, including all pages for a query. Replace the example values with your own measurements.

```html
<form novalidate>
<fieldset disabled>
<div class="ru-input-grid">
<label for="reads">Point reads per second<input id="reads" name="reads" type="number" min="0" max="1000000" step="1" value="200" required></label>
<label for="readRu">RU per point read (session)<input id="readRu" name="readRu" type="number" min="0" max="1000000" step="any" value="1" required></label>
<label for="writes">Creates per second<input id="writes" name="writes" type="number" min="0" max="1000000" step="1" value="20" required></label>
<label for="writeRu">RU per create<input id="writeRu" name="writeRu" type="number" min="0" max="1000000" step="any" value="7" required></label>
<label for="queries">Queries per second<input id="queries" name="queries" type="number" min="0" max="1000000" step="1" value="10" required></label>
<label for="queryRu">RU per query (session, all pages)<input id="queryRu" name="queryRu" type="number" min="0" max="1000000" step="any" value="15" required></label>
<label for="capacity">Provisioned capacity (RU/s)<input id="capacity" name="capacity" type="number" min="1" max="1000000" step="1" value="1000" required></label>
<label for="multiplier">Read consistency<select id="multiplier" name="multiplier"><option value="1">Session / eventual / consistent prefix</option><option value="2">Strong / bounded staleness (about 2×)</option></select></label>
</div>
<button class="am-btn" type="reset">Reset example</button>
</fieldset>
<p id="input-error" role="alert" hidden>Enter valid values from 0 to 1,000,000; capacity must be at least 1 RU/s. Rates and capacity must be whole numbers.</p>
</form>
<noscript><p>Enable JavaScript to calculate a different workload. The initial 490 RU/s example appears below.</p></noscript>
```

## B Demand versus capacity
```limits
Point reads | 200 / 1000 | RU/s
Creates | 140 / 1000 | RU/s
Queries | 150 / 1000 | RU/s
Combined demand | 490 / 1000 | RU/s
```
```html
<p id="workload-status" role="status">490 RU/s total · 49% of capacity · 510 RU/s headroom.</p>
```
```callout info Planning estimate, not a bill or a throttling forecast
Demand equals request rate × RU per request. Stronger consistency doubles the read estimates here; it does not double creates. Each bar shares one axis. Bursts and hot partitions can still throttle below the total budget.
```
