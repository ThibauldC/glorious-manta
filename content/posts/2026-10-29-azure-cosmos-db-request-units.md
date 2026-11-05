---
title: Understanding Azure Cosmos DB Request Units
author: thibauldc
date: 2026-10-29 15:00:00
categories: [Azure, Cosmos DB]
tags: [azure, cosmosdb, performance, cost]
---
When provisioning Azure Cosmos DB, you need to estimate how much throughput your application will need. Cosmos DB expresses that capacity in **Request Units per second (RU/s)**. If you are new to the service, an RU can feel obscure: how many requests does it buy, and what makes one request more expensive than another?

This article explains how Cosmos DB lays out data, what an RU measures, and how reads, queries, writes and configuration affect the charge. We then use those charges to estimate throughput and compare billing options.

The examples use **Azure Cosmos DB for NoSQL**, one region and **session consistency** unless stated otherwise. Measured results come from small workloads tested in West Europe on **4 November 2026**. They illustrate the effects to look for; they are not prices per operation that you can apply to any dataset.

## 1. How data is laid out in Cosmos DB

### Accounts, databases and containers

An **account** contains databases. A **database** groups containers. A **container** holds JSON documents, which Cosmos DB calls **items**. Older documentation sometimes calls a container a collection.

For an online shop, you might create a database named `shop` and a container named `orders`. One item could look like this:

```json
{
  "id": "order-123",
  "customerId": "customer-42",
  "status": "open",
  "total": 42
}
```

### A partition key groups related items

When creating `orders`, choose a **partition-key path**, such as `/customerId`. All items with the same value belong to one **logical partition**:

- `order-123` and `order-124` have `customerId = "customer-42"`, so they stay together.
- `order-125` belongs to `customer-17`, so it belongs to a different logical partition.

An item's **ID and partition-key value together** identify its address in the container. You need both for a point read.

Cosmos DB maps logical partitions onto **physical partitions**. A physical partition can hold several logical partitions. Cosmos DB manages their placement and splits physical partitions as storage or throughput requirements grow. A small container may have many customer keys but only one physical partition.

<iframe src="/visuals/cosmos-db-ru/data-layout.html" title="Orders grouped by customer into logical partitions, placed on physical partitions with local indexes" width="100%" height="760" loading="lazy"></iframe>

[Open the data-layout diagram](/visuals/cosmos-db-ru/data-layout.html).

This choice affects provisioning: requests for one customer go to one place, while requests across all customers may involve several physical partitions. A busy customer can also concentrate demand on one partition.

### Indexes help find items within each physical partition

By default, Cosmos DB automatically indexes item properties. Its index maps JSON paths and values to matching items. For example, an entry for `/status = "open"` helps locate open orders without reading every document.

Each physical partition has **its own index**. Cosmos DB first determines which partitions a query must visit, then uses their local indexes. An index on `status` does not make an all-customer query a single-partition query.

You control indexed paths through the container's **indexing policy**. Under the default indexing mode, Cosmos DB updates indexes as part of each write. More indexing can help queries, but adds write work and storage. You can exclude paths you do not query; some query patterns, such as sorting on multiple properties, need additional indexes.

## 2. What is an RU, and how is it calculated?

A **Request Unit (RU)** measures the CPU, memory and I/O work Cosmos DB performs for an operation. Microsoft defines **1 RU** using a point read of an approximately **1 KB item** by ID and partition key, with session or eventual consistency.

An RU is not one request. A SQL query or write can consume several RUs. It is not a per-KB tariff either: Microsoft's reference values put a 100 KB point read at about 10 RU, not 100 RU.

### The factors are documented; the exact charge must be measured

Microsoft [documents the factors that affect RUs](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units#request-unit-considerations): item size, indexing, query work and consistency, among others. It also publishes reference values and illustrative breakdowns for operations.

It does **not** provide a universal formula that lets you derive an exact charge from arbitrary SQL or JSON. Cosmos DB meters the operation internally and returns its charge. You can understand why an operation costs more without knowing the internal weighting of every CPU, memory and I/O step.

The charge is not random. Microsoft describes it as **deterministic** for a given operation over a given dataset. Keep data, indexes, consistency and execution settings fixed when comparing results. Pagination can change the total, as we will see below.

For provisioning, use reference values for an initial estimate, then **measure representative operations against representative data**. Data Explorer shows request charges; SDK responses expose the `x-ms-request-charge` header. Sum all responses belonging to the operation, not just the last page.

### RU is work; RU/s is capacity

If a request costs **5 RU** and you run it **100 times per second**, that request pattern needs **500 RU/s**. Increasing provisioned RU/s lets you perform more work per second; it does not make the same request cheaper in RUs.

Billing is a third quantity. With manual throughput, you pay for provisioned RU/s, including idle capacity. With serverless, you pay for consumed RUs. We will compare those after sizing the workload.

## 3. What affects the charge of a request?

### Point reads: item size and direct addressing

Use a point read when you know the item's ID and partition-key value. Cosmos DB can fetch the item directly instead of executing SQL.

| Session-consistency read | Measured charge |
|---|---:|
| Point read, about 1 KB | 1 RU |
| Point read, about 100 KB | 9.95 RU |
| SQL query for the same 1 KB item | 2.93 RU |

The equivalent SQL was:

```sql
SELECT * FROM c
WHERE c.id = 'order-123' AND c.customerId = 'customer-42'
```

Even with both address values in the filter, Cosmos DB runs the query engine. That extra path explains why SQL costs more than the point-read API for this lookup.

<iframe src="/visuals/cosmos-db-ru/query-cost.html" title="A point read fetches directly while equivalent SQL uses the query engine and index" width="100%" height="620" loading="lazy"></iframe>

[Open the point-read versus SQL diagram](/visuals/cosmos-db-ru/query-cost.html).

**For sizing:** identify the lookups your application can perform as point reads. Do not assign the 1 RU baseline to every read endpoint.

### SQL queries: scope, filters and document loading

A query's cost depends on the work needed to find and process results. Consider these factors separately.

#### Partition scope: where must Cosmos DB search?

```sql
-- One customer's open orders.
SELECT c.id, c.total FROM c
WHERE c.customerId = 'customer-42' AND c.status = 'open'

-- Every customer's open orders.
SELECT c.id, c.total FROM c WHERE c.status = 'open'
```

The first query targets one logical partition. The second can visit multiple physical partitions, search each local index and combine results. This is **fan-out**. Cross-partition queries can use indexes; they still perform work in more places.

<iframe src="/visuals/cosmos-db-ru/query-fanout.html" title="A customer-scoped query visits one physical partition; an all-customer query fans out across physical partitions" width="100%" height="660" loading="lazy"></iframe>

[Open the query fan-out diagram](/visuals/cosmos-db-ru/query-fanout.html).

My small-container comparison cost **3.31 RU scoped** and **3.19 RU unscoped** for the same ten results. It did not exercise multi-physical-partition fan-out, so it cannot establish its cost. Test your expected data scale; ten customer keys do not imply ten physical partitions.

#### Filter expression: how does the query use the index?

Within one customer partition, filtering on `c.status = 'open'` cost **3.16 RU**. Filtering on `LOWER(c.status) = 'open'` returned the same ten results but cost **4.70 RU**.

The expression changed the execution work. This does not prove a document scan: both recorded metrics showed ten retrieved documents. Use **Query Stats** in Data Explorer to inspect index use and documents retrieved versus returned.

#### Projection: how much of each item do you return?

For those ten orders, selecting `id` and `total` cost **3.16 RU**; selecting full documents cost **3.28 RU**. Returning fewer fields reduced the payload, but produced only a small RU saving in this test. Cosmos DB still had to find the items.

#### Result count: an empty result is not free

The query for `status = 'missing'` returned nothing and cost **2.89 RU**. Cosmos DB performed work to establish that no items matched. Result count alone cannot predict the charge.

**For sizing:** benchmark each important query shape at realistic data volumes. Keep partition scope, filters, returned fields and page settings in the workload description.

### Writes: document size and index maintenance

A create stores the item and adds index entries. A replace or patch also maintains entries affected by changed values. Larger items and more indexed paths generally mean more write work.

For a 1 KB item with nested attributes, I measured:

| Operation | Charge |
|---|---:|
| Create, default indexing | 15.38 RU |
| Create, only selected user paths indexed | 7 RU |
| Replace, two changed values, default indexing | 11.38 RU |
| Patch, the same changes, default indexing | 11.70 RU |

The targeted policy indexed `customerId`, `status` and `total`, and excluded other user paths. It reduced create cost by about **54.5%** without shrinking the item. Replace cost less than create in this test because most indexed values stayed unchanged.

Patch reduces the payload sent and can avoid a client-side read/modify/replace cycle. It does **not** guarantee a lower RU charge than replace.

**For sizing:** measure writes with the indexing policy you intend to deploy. Do not assume that every 1 KB create costs 7 RU, or remove indexes without testing the affected queries.

### Pagination: the same results can require more requests

A query can return several service responses. Smaller pages can add requests and execution overhead, changing the total RU charge.

For the same query returning 20 orders in one customer partition:

| Maximum items per page | Responses | Total charge |
|---|---:|---:|
| 100 | 1 | 3.29 RU |
| 5 | 4 | 11.38 RU |
| 1 | 20 | 54.50 RU |

The four-response case charged 2.92 + 2.82 + 2.82 + 2.82 = **11.38 RU**. Counting only its final response would miss most of the charge.

`max_item_count` is an upper bound, not a promised page length. Cosmos DB can return an empty page before execution finishes. Keep and reuse **continuation tokens** for a Next button; continue while a token remains. A growing `OFFSET` makes Cosmos DB process skipped items again, so later pages can cost more. The appendix includes examples.

**For sizing:** use the application's page settings and count the pages users actually fetch. There is no fixed RU-per-page price.

### Consistency: stronger reads cost more RUs

**Yes, consistency affects the RU charge.** Cosmos DB keeps replicas. Strong and bounded-staleness reads consult two replicas rather than one, doubling read RUs compared with session consistency.

| Consistency | Read guarantee | Read RU budget |
|---|---|---:|
| Session | Read your own writes within a client session; later reads do not go backwards. | Baseline |
| Strong | Read the latest committed version. | 2 × baseline |
| Bounded staleness | Limit how far reads can lag, by versions or time. | 2 × baseline |

My tests returned **1 → 2 RU** for the point read and **2.93 → 5.86 RU** for the equivalent SQL query. The RU charge of the **same write operation stays unchanged** across consistency levels, although latency can differ.

**For sizing:** choose the read guarantee your application needs before benchmarking. Do not double charges again if you already measured with strong or bounded staleness. Session is the baseline throughout this article.

## 4. How much throughput should you provision?

### Build a workload budget

List the operations your application performs, their measured charges and their **peak rates**:

```text
Required RU/s = sum of (operations per second × RU per operation)
```

These are **illustrative planning inputs**, not benchmark results:

| Operation | Operations per second | RU per operation | Demand |
|---|---:|---:|---:|
| Point read, about 1 KB | 200 | 1 | 200 RU/s |
| Create | 20 | 7 | 140 RU/s |
| Query, all pages included | 10 | 15 | 150 RU/s |
| **Total** | | | **490 RU/s** |

With **1,000 RU/s** provisioned, this workload needs 49% of capacity and leaves 510 RU/s of arithmetic headroom. With strong or bounded staleness, the read estimates double and total demand becomes **840 RU/s**; the create estimate stays unchanged.

You can try your own numbers in the [workload calculator](/visuals/cosmos-db-ru/workload-budget.html). Enter session-consistency read charges as its baseline, then select the consistency level.

Include background work and applications sharing the throughput. Before you have a prototype, use the [Cosmos DB capacity estimator](https://cosmos.azure.com/costestimator/) for a starting estimate. Replace assumptions with measured charges as soon as you can.

### Check the partition budget, not only the total

You can provision dedicated throughput on a container or share database-level throughput across containers. Dedicated throughput gives a container its own budget; containers sharing a database compete for that database's capacity.

For a **dedicated manual-throughput container with default equal allocation**:

```text
RU/s per physical partition = provisioned RU/s ÷ physical partition count
```

Cosmos DB determines the physical partition count from storage and throughput requirements. Each physical partition supports up to **50 GB** and **10,000 RU/s**. That ceiling is not an automatic allocation of 10,000 RU/s.

Suppose the container has three physical partitions and 1,200 RU/s provisioned. Each receives 400 RU/s, shared by its logical partitions:

| Physical partition | Allocated capacity | Demand |
|---|---:|---:|
| A | 400 RU/s | 700 RU/s |
| B | 400 RU/s | 100 RU/s |
| C | 400 RU/s | 100 RU/s |
| **Total** | **1,200 RU/s** | **900 RU/s** |

Total demand fits, but A exceeds its allocation. It can throttle requests with **HTTP 429** despite spare capacity elsewhere. One customer's logical partition stays on one physical partition, so a hot customer cannot consume spare capacity spread across the others.

Choose a key that distributes peak traffic while supporting common queries. Monitor **Normalized RU Consumption by PartitionKeyRangeID**, 429s and end-to-end latency. SDK retries can hide throttling while increasing response time. Throughput redistribution and dynamic autoscale can change the equal-allocation behavior; check your actual configuration.

### Select capacity and validate it under load

Manual throughput starts at **400 RU/s**, in increments of 100. Autoscale starts with a **1,000 RU/s maximum** and scales between 10% and 100% of the configured maximum. Storage, throughput history and resource configuration can raise the minimums available to an existing resource.

For the 490 RU/s example, 1,000 RU/s manual capacity or a 1,000 RU/s autoscale maximum are **starting candidates**, not guarantees. Load-test peak traffic, bursts and partition skew. Choose headroom from observed latency and throttling; there is no universal safe utilization percentage.

## 5. How does that capacity become a bill?

| Mode | What you configure | What you pay for |
|---|---|---|
| **Manual** | A provisioned RU/s value. | Provisioned capacity, billed hourly, including idle time. |
| **Autoscale** | A maximum RU/s value. | Scaled capacity under hourly peak billing rules. Dynamic autoscale tracks partition and region peaks independently. |
| **Serverless** | No provisioned RU/s value. | Consumed RUs. Capacity limits still apply. |

The modes returned the same RU charges for my tested operations. Their billing models differ. Manual suits steady demand; autoscale handles variable provisioned demand; serverless can suit intermittent workloads when its limits meet your requirements.

### Compare continuous and intermittent traffic

Using **West Europe, USD, pay-as-you-go** rates recorded on **4 November 2026**:

- Serverless: **$0.305 per million consumed RUs**.
- Manual throughput: **$0.008 per 100 RU/s-hour**.
- Standard transactional storage: **$0.25 per GB-month**, counting data and indexes.

Assume the **490 RU/s workload**, **1,000 RU/s manual capacity**, **10 GB storage** and a **730-hour month**. Keep manual capacity provisioned all month. Intermittent traffic runs for one hour per day over 30 days.

| Monthly cost | Serverless | Manual, no free tier | Manual, free tier |
|---|---:|---:|---:|
| Continuous request traffic | $392.75 | $58.40 | $0.00 |
| Intermittent request traffic | $16.14 | $58.40 | $0.00 |
| Storage, 10 GB | $2.50 | $2.50 | $0.00 |
| **Continuous total** | **$395.25** | **$60.90** | **$0.00** |
| **Intermittent total** | **$18.64** | **$60.90** | **$0.00** |

The same active workload produces different bills depending on how long it runs. The appendix contains the arithmetic. Autoscale has its own rates and peak billing rules; this table does not price it as manual throughput.

Cosmos DB's **lifetime free tier** covers the first **1,000 RU/s and 25 GB** across one eligible account per subscription, enabled at account creation. It supports manual and autoscale, **not serverless**. The free-tier column assumes the full allowance is available. Free tier changes billing, not request charges, and is separate from time-limited Azure credits.

These one-region estimates exclude taxes, transfer, extra backup options and other features. Recheck the [pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/) for your region and account before budgeting.

## Start with the workload, then validate the provisioned capacity

For an initial design, list your item sizes, write patterns, query shapes, consistency requirements and peak request rates. Use those to estimate RU/s, choose a partition key and select a throughput mode.

Then measure representative operations and load-test the design. Provision for **the work each request performs, how often it runs, and where that work lands**. Total request count alone is not enough.

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

For the scoped/unscoped comparison, both requests selected the same ten open orders:

```sql
SELECT c.id, c.total FROM c
WHERE c.status = 'open' AND STARTSWITH(c.id, 'order-')
```

`STARTSWITH` excluded the size-test items. The scoped request used `partition_key="customer-00"` and cost 3.31 RU. The unscoped request omitted that option, used `enable_cross_partition_query=True` and cost 3.19 RU.

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

Using the rates and assumptions from section 5:

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

Continuous traffic consumes **1,287.72 million RU**; intermittent traffic consumes **52.92 million RU**. Without free tier, request costs break even at about **191.5 million RU/month** for this manual capacity, or **108.5 active hours per month** at 490 RU/s. This assumes manual capacity remains provisioned all month.

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
