---
title: Calling the Microsoft Fabric REST API from a standard Python notebook (service principal) without semantic-link auth errors
author: thibauldc
date: 2025-12-03 19:00:00
categories: [Microsoft Fabric, Python]
tags: [microsoft, fabric, python]
---
When you deploy and run Fabric items with a **service principal** (recommended for ownership and automation), the notebook “submitter” becomes the service principal. That’s great for governance, but it can surface confusing **401/403** errors when using `semantic-link` (sempy), especially in the default standard Python notebook environment.

This post explains why it happens and how to fix it cleanly.

## Prerequisites / assumptions

- Your service principal has at least *Contributor* on the target Fabric workspace.
- Tenant setting *Service principals can use Fabric APIs* is enabled.
- You are running a **standard Python** notebook in Fabric (not a custom environment you fully control).

## What I was encountering

In my case I am using the `semantic-link` library to dynamically get the Fabric workspace id and the id of my warehouse using following code in a **Python** notebook:

```python
import sempy.fabric as fabric

warehouse_id = fabric.resolve_item_id("dwh", type="Warehouse")
workspace_id = fabric.get_workspace_id()
```

But when the notebook is executed under a service principal, you may see errors like:

>FabricHTTPException: 401 Unauthorized for url: https://api.powerbi.com/powerbi/globalservice/v201606/clusterdetails
>Headers: {'Cache-Control': 'no-store, must-revalidate, no-cache', 'Pragma': 'no-cache', >'Transfer-Encoding': 'chunked', 'Content-Type': 'application/octet-stream', >'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'X-Frame-Options': >'deny', 'X-Content-Type-Options': 'nosniff', 'RequestId': >'539afdb7-588b-4132-8175-aab68f3e0bc7', 'Access-Control-Expose-Headers': 'RequestId', >'Date': 'Mon, 01 Dec 2025 14:07:29 GMT'}

Or like this:

>FabricHTTPException: 403 Forbidden for url: https://wabi-west-europe-redirect.analysis.windows.net/v1.0/myorg/groups?$filter=name%20eq%20'uuid' Headers: {'Content-Length': '0', 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'X-Frame-Options': 'deny', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Expose-Headers': 'RequestId', 'RequestId': 'id', 'Date': 'Mon, 01 Dec 2025 15:19:19 GMT'}


So even though the service principal has a *Contributor* role on the workspace and the Fabric settings *Service principals can use Fabric APIs* is enabled the library is still complaining it is unauthorized.

## Problem 1: semantic-link uses Power BI endpoints (scope mismatch)

Even though the intent is to access the Fabric API, some `semantic-link` versions still route part of the discovery / workspace resolution through **Power BI APIs** (notably the `/groups` endpoint).

When Fabric runs a notebook triggered by a service principal, the provided access token is typically scoped for Fabric, e.g.:

> https://api.fabric.microsoft.com/.default

But those Power BI APIs calls require:

> https://analysis.windows.net/powerbi/api/.default

So the call succeeds for Fabric endpoints but fails for Power BI endpoints — resulting in **401/403** even though your permissions look correct.

### Solution 1: upgrade the semantic-link package in the notebook environment

Default Python notebooks come with a default environment where in this case a version of `semantic-link` is installed. However this is an old version of the package.

The issue we are encountering has already been resolved in versions of semantic-link **> 0.12**.

So if you want to avoid this issue you can just install the latest version (or a pinned version > 0.12) of the `semantic-link` package in your notebook environment.

```magic
!pip install -U semantic-link
```

>Tip: If you want deterministic builds, pin an exact version that you validated (e.g. semantic-link==0.13.0), rather than always upgrading.

## Problem 2: annoying warning on sempy import

Even after upgrading you still see a warning when importing the `semantic-link` package:

```python
import sempy.fabric as fabric
```

gives the following warning:

>Failed to fetch cluster details
>Traceback (most recent call last):
>   File "..... Something about python 3.11 synapse ml fabric service_discovery.py"
>....
>Exception: Fetch cluster details returns 401:b' ' ## Not In PBI Synapse Platform ##

This usually happens during import because importing the submodule can trigger “service discovery” logic (depending on the version and environment). It’s often non-fatal, but it’s noisy and makes runs look broken.

### Solution 2: explicit imports

Under the *Zen of Python* motto *"explicit is better than implicit* import only the specific functions/classes you actually use:

```python
from sempy.fabric import resolve_item_id, get_workspace_id, FabricRestClient
```

## Summary

- **401/403** happens because older `semantic-link` code may call **Power BI APIs** (/groups) while Fabric provides a token scoped for Fabric APIs.
- Fix it by upgrading `semantic-link` (e.g. >= 0.12).
- If you’re seeing noisy “cluster details” warnings, prefer explicit imports over implicit ones.
