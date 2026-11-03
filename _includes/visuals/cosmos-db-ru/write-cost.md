---
title: The work behind a write
subtitle: Explore an illustrative 1 KB create in one region
theme: shadcn
lang: en
cols: 1
---
## A Change the indexed terms
```html
<form>
<fieldset disabled>
<label for="terms">Indexed terms: <output for="terms" id="terms-value">10</output></label>
<input id="terms" name="terms" type="range" min="0" max="50" step="1" value="10">
<button class="am-btn" type="reset">Reset example</button>
</fieldset>
</form>
<noscript><p>Enable JavaScript to change the example. The initial values appear below.</p></noscript>
```

## B 5 RU + 2 RU = 7 RU
```kv cols=3
Store the item: 5 RU
Update the index: 10 terms × 0.2 RU = 2 RU
Total create charge: 7 RU
```
```html
<p id="write-status" role="status">10 indexed terms: 7 RU per create in this example.</p>
```
```callout info Example, not a universal formula
The model uses 5 RU for the document plus 0.2 RU per indexed term. These coefficients illustrate Microsoft's example, not a service tariff. Measure your own requests.
```
