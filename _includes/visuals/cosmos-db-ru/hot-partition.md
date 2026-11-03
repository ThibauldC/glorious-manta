---
title: Spare total capacity, but a hot partition
subtitle: Illustrative manual throughput · 1,200 RU/s · 400 RU/s per physical partition
theme: shadcn
lang: en
cols: 1
---
## A Move traffic between partitions
Adjust the requested demand. All three bars use the same 0–1,200 RU/s axis.

```html
<form>
<fieldset disabled>
<label for="a">Partition A demand: <output for="a" id="a-value">700 RU/s</output></label>
<input id="a" name="a" type="range" min="0" max="1200" step="10" value="700">
<label for="b">Partition B demand: <output for="b" id="b-value">100 RU/s</output></label>
<input id="b" name="b" type="range" min="0" max="1200" step="10" value="100">
<label for="c">Partition C demand: <output for="c" id="c-value">100 RU/s</output></label>
<input id="c" name="c" type="range" min="0" max="1200" step="10" value="100">
<button class="am-btn" type="reset">Reset example</button>
</fieldset>
</form>
<noscript><p>Enable JavaScript to move the bars. The initial hot-partition example appears below.</p></noscript>
```

## B Demand versus each partition's budget
```limits
Physical partition A | 700 / 400 | RU/s
Physical partition B | 100 / 400 | RU/s
Physical partition C | 100 / 400 | RU/s
```
```html
<p id="partition-status" role="status">900 RU/s requested in total. Partition A exceeds its own budget.</p>
```
```callout warn Partition A can throttle
A requests 700 RU/s against a 400 RU/s allocation. Spare capacity on B and C does not increase A's allocation in this example. Dynamic autoscale and throughput redistribution can change allocations in real accounts.
```
