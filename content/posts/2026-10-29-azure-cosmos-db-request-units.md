---
title: Understanding Azure Cosmos DB Request Units
author: thibauldc
date: 2026-10-29 15:00:00
categories: [Azure, Cosmos DB]
tags: [azure, cosmosdb, performance, cost]
---
When provisioning Azure Cosmos DB, you need to estimate how much throughput your application will need. Cosmos DB expresses that capacity in **Request Units per second (RU/s)**. An RU can feel obscure when you are used to thinking in requests per second, document counts or storage size.

To choose capacity, you need three inputs: **what each operation costs, how often it runs at peak, and which partitions receive that work**. From those inputs, you can choose a throughput mode and an initial capacity, then validate it under load.

We will size an example shop workload: 200 order lookups, 20 creates and 10 queries per second at peak. The examples use **Azure Cosmos DB for NoSQL**, one region and session consistency unless stated otherwise. The appendix holds the detailed experiments and code; the main guide follows the provisioning decisions.

## Understand the capacity you are buying

A **Request Unit (RU)** measures the CPU, memory and I/O work Cosmos DB performs for an operation. Microsoft defines **1 RU** using a point read of an approximately **1 KB item** by ID and partition key, with session or eventual consistency.

Different operations consume different amounts of work. If an operation costs 5 RU and runs 100 times per second, it needs **500 RU/s**. Provisioning more RU/s lets you perform more work each second; it does not reduce that operation's charge.

Microsoft documents the factors affecting RUs and provides reference values and illustrative calculations. It does **not** provide a universal formula for calculating the exact charge of arbitrary SQL or JSON. Cosmos DB meters the work internally and returns the charge. Microsoft describes that charge as **deterministic** for the same operation and dataset; keep indexes, consistency and execution settings fixed when comparing results.

Use estimates before you have a prototype. Once you do, measure representative operations rather than trying to reverse-engineer the internal formula.

## How data is laid out in Cosmos DB

An **account** contains databases. A **database** groups **containers**. A container holds JSON documents, which Cosmos DB calls **items**. Older documentation sometimes calls a container a collection.

Our shop has an `orders` container in a `shop` database:

```json
{
  "id": "order-123",
  "customerId": "customer-42",
  "status": "open",
  "total": 42
}
```

Choose a **partition-key path** when creating the container. With `/customerId`, all orders for `customer-42` belong to one **logical partition**. Orders for `customer-17` belong to another. An item's ID and partition-key value together identify its address.

Cosmos DB maps those groups onto **physical partitions**. Several customers can share one physical partition; a small container may put all customers on one. Cosmos DB manages placement and physical partition splits as storage or throughput requirements grow.

<iframe src="/visuals/cosmos-db-ru/data-layout.html" title="Orders grouped by customer into logical partitions, placed on physical partitions with local indexes" width="100%" height="760" loading="lazy"></iframe>

[Open the data-layout diagram](/visuals/cosmos-db-ru/data-layout.html).

By default, Cosmos DB indexes item properties and maintains the index during writes. An index entry for `/status = "open"` helps find open orders without reading every document. Each physical partition has its own index, so a query across customers may need to search several local indexes.

The container's **indexing policy** controls indexed paths. More indexing adds write work and storage, but can reduce query work. Some patterns, such as sorting on multiple properties, need additional indexes. Choose the partition key and indexes around the operations you expect to run.

## 1. Build a first throughput budget

List your application operations, estimate the RU charge of each, and multiply by the **peak rate**:

```text
Required RU/s = sum of (operations per second × RU per operation)
```

For the shop, start with these **illustrative planning inputs**, not benchmark results:

| Operation | Peak operations per second | Assumed RU per operation | Demand |
|---|---:|---:|---:|
| Point read, about 1 KB | 200 | 1 | 200 RU/s |
| Create | 20 | 7 | 140 RU/s |
| Query, including the pages fetched | 10 | 15 | 150 RU/s |
| **Total** | | | **490 RU/s** |

This gives you a first capacity estimate. A **1,000 RU/s** allocation would leave 510 RU/s of arithmetic headroom. The next steps check whether the charges and traffic distribution support that choice.

Include background jobs and other applications sharing the throughput. Use peak rates rather than daily averages, and record expected data growth.

### Choose the read guarantee before estimating charges

Consistency affects the work needed to serve reads:

| Consistency | Guarantee | Read RU budget |
|---|---|---:|
| Session | Read your own writes within a client session; later reads do not go backwards. | Baseline |
| Strong | Read the latest committed version. | 2 × session |
| Bounded staleness | Limit read lag by versions or time. | 2 × session |

Strong and bounded-staleness reads consult two replicas rather than one. The RU charge of the **same write operation stays unchanged** across consistency levels, although latency can differ.

Use session charges for this example. Strong or bounded staleness doubles the read estimates, taking demand to **840 RU/s**: `400 + 140 + 300`. Leave the create estimate unchanged. The [workload calculator](/visuals/cosmos-db-ru/workload-budget.html) accepts session-baseline charges and applies this adjustment.

For your application, benchmark with the consistency you intend to deploy. Do not double charges again if you already measured with a stronger level.

## 2. Estimate the cost of each application operation

The first budget uses assumed charges. Check each assumption against the access pattern you will deploy, then replace it with a measurement.

### Point reads: use the item's address when you have it

For an order lookup, knowing `id` and `customerId` lets you use an SDK point read. A 1 KB point read cost **1 RU** in the tests. An SQL query for the same item cost **2.93 RU** because Cosmos DB also ran the query engine.

<iframe src="/visuals/cosmos-db-ru/query-cost.html" title="A point read fetches directly while equivalent SQL uses the query engine and index" width="100%" height="620" loading="lazy"></iframe>

[Open the point-read versus SQL diagram](/visuals/cosmos-db-ru/query-cost.html).

Count only eligible lookups as point reads. Item size also matters: Microsoft's reference value for a 100 KB point read is about 10 RU, not 100 RU. There is no “1 RU per KB” rule.

### SQL queries: define the query shape you will provision for

For the list-orders endpoint, record four things before measuring.

#### Partition scope: one customer or all customers?

```sql
-- One customer's open orders.
SELECT c.id, c.total FROM c
WHERE c.customerId = 'customer-42' AND c.status = 'open'

-- Every customer's open orders.
SELECT c.id, c.total FROM c WHERE c.status = 'open'
```

The first query targets one logical partition. The second can **fan out** across physical partitions, search their local indexes and combine the results. An index on `status` helps each search; it does not remove fan-out.

<iframe src="/visuals/cosmos-db-ru/query-fanout.html" title="A customer-scoped query visits one physical partition; an all-customer query fans out across physical partitions" width="100%" height="660" loading="lazy"></iframe>

[Open the query fan-out diagram](/visuals/cosmos-db-ru/query-fanout.html).

Measure at the data scale you expect. A small container with one physical partition cannot demonstrate the cost of fan-out across several partitions. The diagram explains the mechanism, not a fixed RU multiplier.

#### Filter expression: can the query use the index efficiently?

Filtering on `c.status = 'open'` and on `LOWER(c.status) = 'open'` can return the same items with different charges. Check **Query Stats** in Data Explorer for index use and documents retrieved versus returned. A higher charge alone does not prove a document scan.

#### Projection: which fields does the caller need?

Returning `id` and `total` instead of full documents reduces the payload, but Cosmos DB still has to find the matching items. Do not assume an equal percentage reduction in RUs.

#### Result count: what happens as the data grows?

Test representative result sizes, including no matches. An empty result still costs work to establish that nothing matches. A query charge is not a fixed price per returned item.

### Writes: use the intended item shape and indexing policy

Measure creates and updates separately. Cosmos DB stores the document and maintains its index entries; larger items and more indexed paths generally require more work.

In one test, creating the same 1 KB item cost **15.38 RU with default indexing** and **7 RU with selected user paths indexed**. That shows why the indexing policy belongs in the capacity estimate. It does not make 7 RU a standard create price.

Patch can reduce the payload and avoid a client-side read/modify/replace cycle, but it does not guarantee a lower RU charge than replace. Test affected queries before removing indexes.

### Pagination: budget for the pages the application fetches

Include paging settings in the operation definition. For one query returning 20 orders, a single response cost **3.29 RU**; four smaller responses cost **11.38 RU** in total. Count all service responses involved, including empty ones.

Use continuation tokens to resume a query. A growing `OFFSET` makes Cosmos DB process skipped items again. Continue while a token remains, even if a page is empty. For a user journey that stops after one page, budget that page rather than fetching the entire result set.

### Replace assumptions with measured charges

For an initial design, use reference values or the [Cosmos DB capacity estimator](https://cosmos.azure.com/costestimator/). Then seed representative data and run the actual operations with the intended indexes, consistency and page sizes.

Data Explorer shows request charges. SDK responses expose `x-ms-request-charge`; sum all responses belonging to the operation. The appendix provides Python examples and the detailed comparisons behind the observations above.

## 3. Check capacity per physical partition

Once you have replaced assumed charges with measurements, recalculate the total. Then check where that demand lands: fitting within the total does not mean each physical partition has enough capacity.

For a dedicated manual-throughput container with default equal allocation:

```text
RU/s per physical partition = provisioned RU/s ÷ physical partition count
```

Cosmos DB determines physical partition count from storage and throughput requirements. Each supports up to **50 GB** and **10,000 RU/s**. That ceiling is not an automatic allocation of 10,000 RU/s.

For example, three physical partitions sharing 1,200 RU/s receive 400 RU/s each:

| Physical partition | Allocated capacity | Demand |
|---|---:|---:|
| A | 400 RU/s | 700 RU/s |
| B | 400 RU/s | 100 RU/s |
| C | 400 RU/s | 100 RU/s |
| **Total** | **1,200 RU/s** | **900 RU/s** |

A can throttle with **HTTP 429** even though total demand fits. One customer's logical partition stays on one physical partition; it cannot use spare capacity spread across the others.

For `/customerId`, check whether your busiest customer could create this problem. Throughput redistribution and dynamic autoscale can change equal-allocation behavior, so verify your actual configuration. The small experiments in the appendix did not test hot-partition throttling.

## 4. Choose a throughput mode and starting capacity

First choose the scope of the budget. **Dedicated container throughput** gives `orders` its own allocation. **Shared database throughput** lets several containers compete for one database-level allocation; it does not reserve a separate share for each container.

Then choose how that capacity scales and how you pay:

| Mode | What you configure | When to consider it |
|---|---|---|
| **Manual** | A fixed RU/s allocation, billed hourly even when idle. | Steady, predictable traffic. |
| **Autoscale** | A maximum RU/s value; capacity scales between 10% and 100% of it. | Variable traffic needing provisioned capacity. |
| **Serverless** | No provisioned RU/s allocation; pay for consumed RUs. | Intermittent traffic that fits serverless limits. |

Manual throughput starts at **400 RU/s**, in increments of 100. Autoscale starts with a **1,000 RU/s maximum**. Storage, throughput history and configuration can raise an existing resource's minimums. Autoscale uses its own rates and hourly peak billing rules; dynamic autoscale tracks partition and region peaks independently.

For the shop's **490 RU/s estimate**, dedicated manual throughput of **1,000 RU/s**, or autoscale with a **1,000 RU/s maximum**, are starting candidates. Manual capacity leaves 510 RU/s of arithmetic headroom. Neither choice guarantees acceptable latency or handles a hot partition by itself.

### Compare the bill using your traffic pattern

At the recorded West Europe rates, the same shop workload gives these examples with **10 GB storage**, a **730-hour month** and manual capacity kept at **1,000 RU/s** all month:

| Traffic pattern | Serverless total | Manual total, no free tier |
|---|---:|---:|
| Continuous at 490 RU/s | $395.25 | $60.90 |
| One active hour per day for 30 days | $18.64 | $60.90 |

These use **USD pay-as-you-go prices recorded on 4 November 2026**, not a current quote. The appendix contains the rates and arithmetic. Check the [pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/) for your region, storage, backup and network requirements. Additional regions change the estimate.

Cosmos DB's lifetime **free tier** covers the first **1,000 RU/s and 25 GB** across one eligible account per subscription, enabled at account creation. It supports manual and autoscale, **not serverless**. With the full allowance available, it covers this manual example. It changes billing, not request charges, and is separate from time-limited Azure credits.

## 5. Validate the configuration before production

For the example, you now have a candidate: an `orders` container using `/customerId`, session reads, an indexing policy validated against your queries, and a 1,000 RU/s manual allocation or autoscale maximum. Accept it only after testing:

- **Peak traffic and bursts:** run the expected mix of lookups, writes and paged queries, including background work.
- **Skew and growth:** include your busiest customer and realistic stored data, not just evenly distributed seed items.
- **Latency and throttling:** inspect 429s, **Normalized RU Consumption by PartitionKeyRangeID** and end-to-end response time. SDK retries can hide throttling while increasing latency.

If total demand is too high, reduce operation costs or increase capacity. If one partition is hot, revisit the traffic distribution and partition key rather than relying on the total RU/s figure. Choose headroom from these tests; there is no universal safe utilization percentage.

Keep the operation charges, peak rates and data assumptions with the capacity decision. Revisit them when you change queries, indexes, consistency or expected traffic.

## Appendix: examples and test notes

### Measure a complete query in Python

Install `azure-cosmos` and set `COSMOS_ENDPOINT` and `COSMOS_KEY` in your environment. The examples assume an existing `shop` database and `orders` container with `/customerId` as its partition key. Use a read-only key for reads, keep credentials out of source control and replace sample IDs with your own.

The SDK runs the query as you consume results. The response hook below includes empty responses and sums the charge for the complete query. Reuse the client in your application; the later examples reuse this `container`.

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
results = container.query_items(
    query="SELECT c.id, c.total FROM c",
    partition_key="customer-00",
    max_item_count=5,
    response_hook=lambda headers, _: charges.append(
        float(headers["x-ms-request-charge"])
    ),
)
for page in results.by_page():
    for order in page:
        print(order["id"], order["total"])

print(f"Complete query: {sum(charges):.2f} RU")
```

### Point read and equivalent SQL

```python
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

The measured equivalent query used the ID `size-1024`; this example uses `order-123`. Consuming the iterator captures all response charges.

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

### Fetch one page with a continuation token

Pass the saved token back with the same query, parameters and partition key. Continue while `next_token` has a value, even if `items` is empty. This example stays within one partition; check SDK continuation-token support before extending it to cross-partition or aggregate queries.

```python
saved_token = None  # Use the token from the previous application request.
charges = []
pages = container.query_items(
    query="SELECT c.id, c.total FROM c",
    partition_key="customer-00",
    max_item_count=5,
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

### Patch two indexed values

This modifies the item and requires write permission. Use a test container and appropriate credentials, not the read-only key used above.

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

### Measured charges and test conditions

The tests used `azure-cosmos` **4.14.2**, one region in West Europe and no zone redundancy. Each provisioned account used a shared **400 RU/s** database, with no autoscale. The provisioned accounts defaulted to Strong consistency; baseline clients requested Session. Separate clients tested Strong and Bounded Staleness. The serverless account used Session.

Point-read, equivalent-SQL and write comparisons ran three times per mode. The 1 KB write item contained twenty nested attributes, two changing values and padding.

| Operation | Paid manual | Free-tier manual | Serverless |
|---|---:|---:|---:|
| Point read, about 1 KB item | 1 RU | 1 RU | 1 RU |
| Equivalent SQL, one item | 2.93 RU | 2.93 RU | 2.93 RU |
| Create, default indexing | 15.38 RU | 15.38 RU | 15.38 RU |
| Replace, two changed values | 11.38 RU | 11.38 RU | 11.38 RU |
| Patch, same two changes | 11.70 RU | 11.70 RU | 11.70 RU |
| Create, targeted indexing | 7 RU | 7 RU | 7 RU |

The targeted indexing policy included `customerId`, `status` and `total`, and excluded other user paths. It reduced create cost by about **54.5%** without shrinking the item. Replace cost less than create in this test because most indexed values stayed unchanged.

The 100 KB point read cost **9.95 RU**. Strong and Bounded Staleness clients returned **2 RU** for the 1 KB point read and **5.86 RU** for the equivalent SQL query, compared with 1 and 2.93 RU under Session.

### Query comparisons

The query dataset contained 200 orders across ten customers. These queries used `partition_key="customer-00"`:

```sql
-- 3.16 RU, ten results
SELECT c.id, c.total FROM c WHERE c.status = 'open'

-- 4.70 RU, the same ten results
SELECT c.id, c.total FROM c WHERE LOWER(c.status) = 'open'

-- 3.28 RU, ten full documents
SELECT * FROM c WHERE c.status = 'open'

-- 2.89 RU, no results
SELECT * FROM c WHERE c.status = 'missing'
```

Both status-filter expressions reported ten retrieved documents. Selecting fewer fields saved only a small amount in this test; the empty result still had a charge.

For the scoped/unscoped comparison, both requests selected the same ten open orders:

```sql
SELECT c.id, c.total FROM c
WHERE c.status = 'open' AND STARTSWITH(c.id, 'order-')
```

`STARTSWITH` excluded the size-test items. The scoped request used `partition_key="customer-00"` and cost **3.31 RU**. The unscoped request omitted that option, used `enable_cross_partition_query=True` and cost **3.19 RU**. This small-container test did not exercise multi-physical-partition fan-out.

### Pagination and offsets

For `SELECT c.id, c.total FROM c` within `customer-00`, the same 20 results produced these totals:

| Maximum items per page | Responses | Total charge |
|---|---:|---:|
| 100 | 1 | 3.29 RU |
| 5 | 4 | 11.38 RU |
| 1 | 20 | 54.50 RU |

The four responses charged 2.92, 2.82, 2.82 and 2.82 RU. `max_item_count` sets an upper bound, not a promised page length. There is no fixed RU-per-page tariff.

The offset tests used separate cross-partition queries without an SDK partition-key scope:

```sql
-- 2.93 RU
SELECT c.id FROM c WHERE STARTSWITH(c.id, 'order-')
OFFSET 0 LIMIT 5

-- 5.32 RU
SELECT c.id FROM c WHERE STARTSWITH(c.id, 'order-')
OFFSET 100 LIMIT 5

-- 7.47 RU
SELECT c.id FROM c WHERE STARTSWITH(c.id, 'order-')
OFFSET 190 LIMIT 5
```

Each returned five IDs. Without `ORDER BY`, these examples do not guarantee stable ordering; they demonstrate skip work, not a production paging design.

The small datasets do not validate multi-physical-partition fan-out, hot-partition throttling or cross-region consistency behavior. The figures are response-charge measurements, not an invoice comparison. The optional [raw measurement data](/visuals/cosmos-db-ru/measurements-2026-11-04.json) contains response samples, indexing policies and collection limitations.

### Microsoft's illustrative write calculations

Microsoft's [RU consumption guide](https://learn.microsoft.com/en-us/azure/cosmos-db/understand-request-unit-consumption#write-operations) gives these examples for a 1 KB item in one region:

| Operation | Work in Microsoft's example | Charge |
|---|---|---:|
| Create, ten indexed terms | 5 RU for document + 10 × 0.2 RU for index entries | 7 RU |
| Replace, two modified terms | 5 + 5 RU for old/new document + 2 × 0.2 RU removal + 2 × 0.2 RU insertion | 10.8 RU |
| Patch, two modified terms | Same 10.8 RU + 2 × 0.4 RU patch work | 11.6 RU |

These coefficients illustrate the work involved. They are not a general formula for arbitrary documents and indexing policies.

### Cost calculation details

The billing example uses **West Europe, USD, pay-as-you-go** rates recorded on **4 November 2026**:

- Serverless: **$0.305 per million consumed RUs**.
- Manual throughput: **$0.008 per 100 RU/s-hour**.
- Standard transactional storage: **$0.25 per GB-month**, counting data and indexes.

Using the rates and assumptions from step 4:

```text
Continuous serverless requests:
490 × 3,600 × 730 ÷ 1,000,000 × $0.305 = $392.7546

Intermittent serverless requests:
490 × 3,600 × 30 ÷ 1,000,000 × $0.305 = $16.1406

Manual throughput, either traffic pattern:
1,000 ÷ 100 × $0.008 × 730 = $58.40

Storage:
10 × $0.25 = $2.50
```

| Monthly cost | Serverless | Manual, no free tier | Manual, free tier |
|---|---:|---:|---:|
| Continuous request traffic | $392.75 | $58.40 | $0.00 |
| Intermittent request traffic | $16.14 | $58.40 | $0.00 |
| Storage, 10 GB | $2.50 | $2.50 | $0.00 |
| **Continuous total** | **$395.25** | **$60.90** | **$0.00** |
| **Intermittent total** | **$18.64** | **$60.90** | **$0.00** |

Continuous traffic consumes **1,287.72 million RU**; intermittent traffic consumes **52.92 million RU**. Without free tier, request costs break even at about **191.5 million RU/month** for this manual capacity, or **108.5 active hours per month** at 490 RU/s. This assumes manual capacity remains provisioned all month. The free-tier column assumes the full allowance is available. Estimates exclude taxes, currency conversion, discounts, transfer, extra backup options and other features.

## Sources

- [Request units and the factors affecting their charge](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units)
- [Understanding RU consumption and illustrative calculations](https://learn.microsoft.com/en-us/azure/cosmos-db/understand-request-unit-consumption)
- [Partitioning and horizontal scaling](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview)
- [Indexing overview](https://learn.microsoft.com/en-us/azure/cosmos-db/index-overview) and [indexing policies](https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy)
- [In-partition and cross-partition queries](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-query-container)
- [Point reads versus queries](https://devblogs.microsoft.com/cosmosdb/point-reads-versus-queries/)
- [Read/write optimization and reference point-read charges](https://learn.microsoft.com/en-us/azure/cosmos-db/optimize-cost-reads-writes)
- [Consistency levels and their throughput implications](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels#consistency-levels-and-throughput)
- [Query pagination](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/pagination) and [OFFSET LIMIT](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/offset-limit)
- [Provision throughput on containers and databases](https://learn.microsoft.com/en-us/azure/cosmos-db/set-throughput)
- [Autoscale throughput](https://learn.microsoft.com/en-us/azure/cosmos-db/provision-throughput-autoscale)
- [Redistribute throughput across partitions](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/distribute-throughput-across-partitions)
- [Lifetime free tier](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier) and [serverless](https://learn.microsoft.com/en-us/azure/cosmos-db/serverless)
- [Azure Retail Prices API](https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Azure%20Cosmos%20DB%27%20and%20armRegionName%20eq%20%27westeurope%27)
- [Python ContainerProxy API](https://learn.microsoft.com/en-us/python/api/azure-cosmos/azure.cosmos.containerproxy)
- [Troubleshoot HTTP 429](https://learn.microsoft.com/en-us/azure/cosmos-db/troubleshoot-request-rate-too-large)

Prices in the worked example date from 4 November 2026. Recheck rates before using them for a budget.
