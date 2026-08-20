# Glorious Manta

A lightweight static blog built from Markdown with [Eleventy](https://www.11ty.dev/). No client-side framework.

## Write

Add posts to `content/posts`:

````md
---
title: A useful title
date: 2026-02-20 19:00:00
categories: [Microsoft Fabric, Spark]
tags: [fabric, spark]
---

Markdown, <mark>inline HTML</mark>, and Mermaid all work.

```mermaid
graph LR
  Notes --> Build --> Static_site
```
````

## Run locally

```sh
npm install
npm start
```

`npm run build` writes the static site to `_site`.

## Publish on Cloudflare Pages

1. Create a Direct Upload Pages project named `glorious-manta` with `main` as its production branch.
2. Add repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The token needs **Account → Cloudflare Pages → Edit**.
3. Push. `main` publishes production; every other branch gets a Cloudflare preview deployment and branch alias.

Change the production URL in `_data/site.json` when attaching a custom domain.
