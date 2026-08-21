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

## Publish on Cloudflare Workers

Connect this repository to a Worker using the **Cloudflare Workers and Pages** GitHub App. Configure:

- Production branch: `main`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Non-production deploy command: `npx wrangler versions upload`

`wrangler.jsonc` tells Wrangler to deploy `_site` as static assets. No GitHub Actions or Cloudflare API-token secrets are required.

Change the production URL in `_data/site.json` when attaching a custom domain.
