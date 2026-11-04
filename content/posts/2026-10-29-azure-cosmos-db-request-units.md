---
title: How Azure Cosmos DB Calculates Request Units
author: thibauldc
date: 2026-10-29 15:00:00
categories: [Azure, Cosmos DB]
tags: [azure, cosmosdb, performance, cost]
---
A point read in Azure Cosmos DB can cost 1 RU. A SQL query for the same item costs more. To size your database, measure the cost of each operation and multiply it by your request rate.

The examples use **Azure Cosmos DB for NoSQL**, one region and **session consistency**. The reference figures below come from Microsoft; the workload and pagination numbers are illustrative. No live-account measurements appear in this post.

## 1. Databases, containers and request units

You create a **database** inside a Cosmos DB account to group your containers. A **container** holds JSON documents, which Cosmos DB calls **items**. Older documentation and SDKs sometimes call a container a **collection**; in the NoSQL API, these names refer to the same resource.

```text
Account
└── Database: shop
    └── Container (collection): orders, partition key /customerId
        └── Item: {"id": "order-123", "customerId": "customer-42", ...}
```

You choose a partition-key path when you create a container. Items with the same partition-key value belong to one **logical partition**. Cosmos DB distributes those logical partitions across **physical partitions**. An item's `id` and partition-key value identify it within the container.

A **Request Unit (RU)** measures the CPU, memory and I/O work that Cosmos DB performs for an operation. **RU/s** measures throughput, or work per second. You can provision throughput on a container or share database-level throughput across containers.

```text
Required RU/s = sum of (operations per second × RU per operation)
```

### Consistency controls how fresh your reads must be

Cosmos DB keeps replicas of your data. Your consistency level sets the guarantees you get when you read them:

- **Session:** within a client session, you can read your own successful writes, and later reads do not go back to an older version. The SDK tracks session tokens for you. Other clients can lag behind; share the session token if a request moves between clients and needs that guarantee. Reuse your `CosmosClient`.
- **Strong:** a read returns the latest committed version of the item, regardless of the client session. Cosmos DB must coordinate replication to provide that guarantee.
- **Bounded staleness:** across regions, you allow a configured lag in versions or time, whichever limit Cosmos DB reaches first. For example, a multi-region account can allow up to 100,000 versions or 300 seconds. Reads return the newest data in the region within that bound. In one region, reads return the latest local data.

For **strong and bounded staleness**, Cosmos DB reads from two replicas instead of one. Budget **twice the read RUs** for point reads and queries compared with session consistency. The same write operation has the same RU charge across consistency levels, though replication can affect latency.

## 2. Point reads: use the item's address

Suppose `orders` uses `/customerId` as its partition key. You know the order ID and customer ID, so you can use a point read.

Install `azure-cosmos` and set `COSMOS_ENDPOINT` and `COSMOS_KEY` in your environment. This Python example assumes an existing `shop` database and `orders` container. Use a read-only key for the read examples; keep credentials out of source control.

```python
import os
from azure.cosmos import CosmosClient

client = CosmosClient(
    os.environ["COSMOS_ENDPOINT"],
    credential=os.environ["COSMOS_KEY"],
    consistency_level="Session",
)
container = client.get_database_client("shop").get_container_client("orders")

charges = []
order = container.read_item(
    item="order-123",
    partition_key="customer-42",
    response_hook=lambda headers, _: charges.append(
        float(headers["x-ms-request-charge"])
    ),
)
print(f"Point read: {sum(charges):.2f} RU")
```

Cosmos DB fetches the item by its exact address without running the query engine. Microsoft's [point-read reference values](https://learn.microsoft.com/en-us/azure/cosmos-db/optimize-cost-reads-writes#point-reads) show the effect of item size and consistency:

| Item size | Session or eventual consistency | Strong or bounded staleness |
|---|---:|---:|
| About 1 KB | 1 RU | About 2 RU |
| About 100 KB | 10 RU | About 20 RU |

Do not use “1 RU per KB” as a formula. In this reference, a 100 KB point read costs about 10 RU, not 100 RU.

### The equivalent SQL query costs more

```sql
SELECT * FROM c
WHERE c.id = 'order-123'
  AND c.customerId = 'customer-42'
```

You ask for the same item, but Cosmos DB executes a query: it prepares the query, looks up index entries, evaluates the predicates and loads the matching document. The partition-key filter avoids searching other partitions; it does not turn SQL into an SDK point read.

Microsoft's [point reads versus queries example](https://devblogs.microsoft.com/cosmosdb/point-reads-versus-queries/) reports **a little under 3 RU** for this query pattern versus **1 RU** for a 1 KB point read. That is close to three times the charge, or about 2 RU extra per request. The post also lists 2.3 RU as a query starting point. Treat those as published reference figures, not a guaranteed minimum or a measurement of your data.

Use the same `container` to compare your own query charge:

```python
charges = []
orders = list(container.query_items(
    query="SELECT * FROM c WHERE c.id = @id AND c.customerId = @customer",
    parameters=[
        {"name": "@id", "value": "order-123"},
        {"name": "@customer", "value": "customer-42"},
    ],
    partition_key="customer-42",
    response_hook=lambda headers, _: charges.append(
        float(headers["x-ms-request-charge"])
    ),
))
print(f"SQL query, all responses: {sum(charges):.2f} RU")
```

Iterating the results executes the query. Use `read_item` when you know both address values.

## 3. Queries: scope, indexes and document loading

Compare these requests on the same container:

```sql
-- One customer's open orders: target one logical partition.
SELECT c.id, c.total FROM c
WHERE c.customerId = 'customer-42' AND c.status = 'open'
```

```sql
-- All customers' open orders: search across physical partitions.
SELECT c.id, c.total FROM c WHERE c.status = 'open'
```

Cosmos DB can route the first query to one customer's logical partition. For the second, it searches the index on each relevant physical partition and merges the results. Both queries might return ten orders; the second can consume more RUs because Cosmos DB does more work to find them.

<iframe src="/visuals/cosmos-db-ru/query-cost.html" title="Query cost: compare a point read, a scoped SQL query, and a query across partitions" width="100%" height="1050" loading="lazy"></iframe>

[Open the query-cost visual](/visuals/cosmos-db-ru/query-cost.html).

An index on a filter path can help Cosmos DB find candidate items without scanning the documents. Functions and predicates differ in how they use indexes. Cosmos DB also charges for loading and processing documents, projections and returning results. Selecting `id` and `total` reduces the payload; do not assume a matching percentage reduction in RUs. Even a query that returns zero items consumes RUs to establish that nothing matches.

For your own RU comparison, run both queries against the same data with the same indexes and consistency. Use `partition_key="customer-42"` for the scoped query. For the all-customer query, omit that option and set `enable_cross_partition_query=True`. Capture the response charges as above and consume the full result set. Inspect **Query Stats** in Data Explorer or enable `populate_query_metrics=True` in Python to compare documents retrieved with documents returned.

To measure fan-out costs, use a live account with representative items and enough data to span multiple physical partitions. Keep the indexing policy fixed. A single-partition test cannot show the extra cost of searching several partitions; the diagram explains that work without assigning an unmeasured RU total.

### You can calculate RU yourself

You can **sum measured response charges** and calculate workload demand. You cannot derive an exact query charge from the SQL text or result count alone.

For this illustrative execution:

| Response | Charge |
|---|---:|
| Page 1 | 3.2 RU |
| Page 2 | 4.1 RU |
| Page 3 | 2.7 RU |
| **Complete query** | **10.0 RU** |

In Python, collect the `x-ms-request-charge` header through `response_hook`. A query can issue several service requests, including requests that return no items. Count those charges too; the last response header alone does not give you the total.

```python
charges = []
results = container.query_items(
    query="SELECT c.id, c.total FROM c WHERE c.status = @status",
    parameters=[{"name": "@status", "value": "open"}],
    partition_key="customer-42",
    max_item_count=100,
    response_hook=lambda headers, _: charges.append(
        float(headers["x-ms-request-charge"])
    ),
)
for page in results.by_page():
    for order in page:
        print(order["id"], order["total"])

print(f"Complete query: {sum(charges):.2f} RU")
```

### Pagination has a cost

`max_item_count=100` sets an upper bound per page, not a promise of 100 items. Cosmos DB can split an execution because of response size, execution time or available throughput. You can receive an empty page before the query finishes.

Smaller pages can add requests and overhead, so page size can change the total RU charge. Keep paging settings fixed when comparing queries. There is no fixed “RU per page” tariff.

For a Next button, keep the **continuation token** instead of rerunning the query from the start. This example reads one service page within one customer's partition. On the next application request, pass back the token with the same query, parameters and partition key:

```python
saved_token = None  # Use the token from the previous application request.
charges = []
pages = container.query_items(
    query="SELECT c.id, c.total FROM c WHERE c.status = @status",
    parameters=[{"name": "@status", "value": "open"}],
    partition_key="customer-42",
    max_item_count=100,
    response_hook=lambda headers, _: charges.append(
        float(headers["x-ms-request-charge"])
    ),
).by_page(continuation_token=saved_token)

page = next(pages, None)
items = list(page) if page is not None else []
next_token = pages.continuation_token
print(f"This page: {sum(charges):.2f} RU")
# Return items and next_token to your application.
```

Continue paging while `next_token` has a value, even if `items` is empty. This example stays within one partition; check the SDK's continuation-token support before extending it to cross-partition or aggregate queries.

With `OFFSET 10000 LIMIT 100`, Cosmos DB still processes the 10,000 skipped items. Larger offsets cost more RUs. Continuation tokens preserve progress and avoid repeating that skip work. Sum charges across the pages your user reads; stopping after one page avoids fetching the remaining pages.

## 4. Writes: store the document and update its index

An **indexed term** is a searchable entry derived from a document path and value. For example, Cosmos DB can index the path `/status` with the value `"open"` and associate it with `order-123`. A query for open orders can use that entry to find the item.

```json
{
  "id": "order-123",
  "customerId": "customer-42",
  "status": "open",
  "total": 42
}
```

With those paths indexed, example entries include `/status → "open"` and `/total → 42`. These are simplified path/value labels, not the physical index format. Nested fields and array elements can produce multiple entries; counting top-level JSON properties does not give you the index-work total.

On a create, Cosmos DB stores the document and adds entries for the paths in your indexing policy. Use the tabs to compare that work with replacing or patching an item:

<iframe src="/visuals/cosmos-db-ru/write-cost.html" title="Document indexing: Create, Replace and Patch tabs show path/value entries added or removed" width="100%" height="1100" loading="lazy"></iframe>

[Open the document-indexing visual](/visuals/cosmos-db-ru/write-cost.html).

Microsoft's [RU consumption guide](https://learn.microsoft.com/en-us/azure/cosmos-db/understand-request-unit-consumption#write-operations) gives these **illustrative calculations** for a 1 KB item in one region:

| Operation | Work in Microsoft's example | Charge |
|---|---|---:|
| Create, ten indexed terms | 5 RU for document + 10 × 0.2 RU for index entries | 7 RU |
| Replace, two modified terms | 5 + 5 RU for old/new document + 2 × 0.2 RU removal + 2 × 0.2 RU insertion | 10.8 RU |
| Patch, two modified terms | Same 10.8 RU + 2 × 0.4 RU patch work | 11.6 RU |

The coefficients belong to these examples. Do not use them as a universal write-cost formula. Patch reduces the payload you send and avoids a client-side read/modify/replace cycle, but **does not guarantee fewer RUs per write** than replace.

A Python patch for changing two indexed values looks like this. It requires write permission and modifies the item, so use a test container:

```python
charges = []
container.patch_item(
    item="order-123",
    partition_key="customer-42",
    patch_operations=[
        {"op": "set", "path": "/status", "value": "shipped"},
        {"op": "set", "path": "/total", "value": 45},
    ],
    response_hook=lambda headers, _: charges.append(
        float(headers["x-ms-request-charge"])
    ),
)
print(f"Patch: {sum(charges):.2f} RU")
```

Keep items small and exclude properties you do not filter or sort on from indexing. Test affected queries before removing indexes: you can increase their charges or break sort patterns.

## 5. Turn request charges into a throughput budget

Suppose your application performs this workload in one second. These are **illustrative planning inputs**, not benchmark results:

| Operation | Operations per second | RU per operation | Demand |
|---|---:|---:|---:|
| Point read, about 1 KB | 200 | 1 | 200 RU/s |
| Create | 20 | 7 | 140 RU/s |
| Query, all pages included | 10 | 15 | 150 RU/s |
| **Total** | | | **490 RU/s** |

With 1,000 RU/s provisioned, you use 49% of capacity and have 510 RU/s of arithmetic headroom.

Enter your own rates and measured charges in the calculator. Use **session-consistency read charges** as the baseline, then choose a consistency level.

<iframe src="/visuals/cosmos-db-ru/workload-budget.html" title="RU calculator: multiply request rates by charges and compare demand with provisioned capacity" width="100%" height="1450" loading="lazy"></iframe>

[Open the RU calculator](/visuals/cosmos-db-ru/workload-budget.html).

With strong or bounded staleness, the read estimates double. Keep the create assumption unchanged:

```text
Point reads: 200 × 2 RU  = 400 RU/s
Creates:      20 × 7 RU  = 140 RU/s
Queries:      10 × 30 RU = 300 RU/s
                          --------
Total                     840 RU/s
```

Size capacity for peak traffic and representative items. Include background work and applications sharing your throughput. Test latency under load; the daily average can hide short bursts.

## 6. A hot partition can throttle below the total budget

For a simplified manual-throughput example, assume Cosmos DB spreads 1,200 RU/s across three physical partitions: 400 RU/s each.

Your application requests 700 RU/s on partition A and 100 RU/s on each of B and C. You need 900 RU/s in total, below 1,200, but A exceeds its 400 RU/s allocation. You can receive **HTTP 429: Request rate too large** on A despite spare capacity elsewhere.

The SDK retries throttled requests according to its retry policy, which can increase end-to-end latency. Check **Normalized RU Consumption by PartitionKeyRangeID**, throttling and application latency. Choose a partition key that distributes traffic and supports your common queries. With customer-based partitioning, one active customer can still create a hot partition.

This example assumes equal allocations. Dynamic autoscale and throughput redistribution can change them; you still need to check partition-level demand.

## 7. RUs and your Azure bill

An operation's RU charge measures resource consumption. Your throughput mode determines how you pay:

- **Manual provisioned throughput:** pay hourly for the RU/s you provision, including idle capacity.
- **Autoscale:** configure a maximum and pay for scaled capacity under the hourly billing rules. Dynamic autoscale tracks peaks per partition and region.
- **Serverless:** pay for consumed RUs, without reserving an RU/s allocation. Capacity limits still apply.

### Free tier covers provisioned capacity

You can enable Cosmos DB's **lifetime free tier** on one account per subscription, at account creation. It covers the first **1,000 RU/s and 25 GB of storage** across that account. You pay for usage beyond those allowances. Free tier supports manual and autoscale provisioned throughput; **serverless does not qualify**.

This is separate from the Azure free account's time-limited credits and allowances. The example below assumes one region and no other resources consuming the free-tier allowance.

### West Europe: serverless versus manual throughput

The [Azure Retail Prices API](https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Azure%20Cosmos%20DB%27%20and%20armRegionName%20eq%20%27westeurope%27) lists these **West Europe, USD, pay-as-you-go** rates, checked on **4 November 2026**:

- Serverless, `Azure Cosmos DB serverless / 1M RUs`: **$0.305 per million consumed RUs**.
- Manual, `Azure Cosmos DB / RUs / 100 RU/s`: **$0.008 per 100 RU/s-hour**.
- Standard transactional storage: **$0.25 per GB-month**. Include data and index storage.

Assume the 490 RU/s workload above, **1,000 RU/s manual capacity**, **10 GB total billable storage**, and a **730-hour month**. For the intermittent case, run the same workload for one hour per day over 30 days. Keep manual capacity provisioned for the month in both cases.

| Monthly cost | Serverless | Manual, no free tier | Manual, free tier |
|---|---:|---:|---:|
| Continuous traffic: 1,287.72 million RU | $392.75 | $58.40 | $0.00 |
| Intermittent traffic: 52.92 million RU | $16.14 | $58.40 | $0.00 |
| Storage, 10 GB | $2.50 | $2.50 | $0.00 |
| **Continuous total** | **$395.25** | **$60.90** | **$0.00** |
| **Intermittent total** | **$18.64** | **$60.90** | **$0.00** |

For example, continuous serverless requests cost `490 × 3,600 × 730 ÷ 1,000,000 × $0.305 = $392.7546`. Manual requests cost `1,000 ÷ 100 × $0.008 × 730 = $58.40`, regardless of these two traffic patterns. Free tier covers the chosen manual capacity and storage, provided you have the full allowance available. There is no serverless “with free tier” price.

Without free tier, serverless has a lower request cost below about **191.5 million RU/month** at these rates and this manual capacity. For a 490 RU/s active workload, you reach the break-even after about **108.5 active hours per month**. Capacity, bursts and partitioning still constrain which mode fits.

These estimates exclude taxes, currency conversion, negotiated discounts, network transfer, extra backup options and other features. Additional regions change the provisioned-capacity bill. Recheck the [pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/) for your account rather than multiplying one response's RU charge by the region count.

## Measure first, then change one thing

Record charges for frequent operations and expensive queries, including their response pages. Multiply by peak request rates, then check partition-level utilization and latency under load.

Use point reads where you know the item's address. Test smaller items, targeted indexes or partition scoping for the remaining operations. Measure again after each change.

## Sources

- [Request units](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units)
- [Consistency levels](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels)
- [Point reads versus queries](https://devblogs.microsoft.com/cosmosdb/point-reads-versus-queries/), including the published SQL comparison
- [Understanding RU consumption](https://learn.microsoft.com/en-us/azure/cosmos-db/understand-request-unit-consumption), including the illustrative write calculations
- [Optimize request cost](https://learn.microsoft.com/en-us/azure/cosmos-db/optimize-cost-reads-writes)
- [Python ContainerProxy API](https://learn.microsoft.com/en-us/python/api/azure-cosmos/azure.cosmos.containerproxy)
- [Query pagination](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/pagination) and [OFFSET LIMIT](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/offset-limit)
- [Lifetime free tier](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier)
- [Serverless billing](https://learn.microsoft.com/en-us/azure/cosmos-db/serverless)
- [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Troubleshoot HTTP 429](https://learn.microsoft.com/en-us/azure/cosmos-db/troubleshoot-request-rate-too-large)

Sources and prices checked on 4 November 2026. Recheck the rates before using this example for a budget.
