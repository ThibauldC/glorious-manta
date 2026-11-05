---
title: Understanding Azure Cosmos DB Request Units
author: thibauldc
date: 2026-10-29 15:00:00
categories: [Azure, Cosmos DB]
tags: [azure, cosmosdb, performance, cost]
---
A point read in Azure Cosmos DB can cost 1 RU. A SQL query that returns the same item can cost almost three times as much. To understand the difference, look at the work Cosmos DB performs for each request.

Once you know an operation's charge, you can multiply it by your request rate to estimate throughput demand. Your throughput mode then determines how you pay for that workload.

The examples use **Azure Cosmos DB for NoSQL**, one region and **session consistency** unless stated otherwise. Measured results come from small workloads I tested in West Europe on **4 November 2026**. I distinguish those measurements from Microsoft's reference examples and the assumptions used for capacity planning.

## 1. Understand RU, RU/s and cost

Inside a Cosmos DB account, a **database** groups **containers**. A container holds JSON documents, which Cosmos DB calls **items**. Older documentation sometimes calls a container a **collection**.

```text
Account
└── Database: shop
    └── Container: orders, partition key /customerId
        └── Item: {"id": "order-123", "customerId": "customer-42", ...}
```

You choose a partition-key path when you create the container. Items with the same value, such as `customer-42`, belong to one **logical partition**. Cosmos DB places logical partitions on **physical partitions**, which it manages. Together, an item's `id` and partition-key value identify its address within the container.

A **Request Unit (RU)** measures the work Cosmos DB performs. Keep three quantities separate:

| Quantity | What it tells you |
|---|---|
| **RU per operation** | The CPU, memory and I/O work Cosmos DB performs for a request. |
| **RU/s** | How much work your workload needs, or how much throughput you provision, per second. |
| **Cost** | What Azure bills under your throughput mode, plus storage and other charges. |

A request that consumes 5 RU does not require a permanent allocation of 5 RU/s. Running that request 100 times per second creates a demand of 500 RU/s. Provisioning capacity for it and paying for it are separate decisions.

## 2. Understand what determines an operation's charge

### Point reads: fetch an item by its address

When you know both `id` and the partition-key value, use an SDK point read. Cosmos DB fetches the item without running the SQL query engine.

Microsoft's [point-read reference values](https://learn.microsoft.com/en-us/azure/cosmos-db/optimize-cost-reads-writes#point-reads) show the effect of item size:

| Item size | Point-read charge, session consistency |
|---|---:|
| About 1 KB | 1 RU |
| About 100 KB | 10 RU |

My tests returned **1 RU** for a 1 KB item and **9.95 RU** for a 100 KB item. Do not interpret this as “1 RU per KB”: the larger read costs about 10 RU, not 100 RU.

You can request the same item with SQL:

```sql
SELECT * FROM c
WHERE c.id = 'order-123'
  AND c.customerId = 'customer-42'
```

Cosmos DB must execute the query, look up index entries, evaluate predicates and load the matching document. The partition-key filter limits the search; it does not turn SQL into a point read.

My equivalent SQL query cost **2.93 RU**, compared with **1 RU** for the point read. Microsoft's [point reads versus queries example](https://devblogs.microsoft.com/cosmosdb/point-reads-versus-queries/) reports a similar comparison. Use the point-read API when you have the item's address.

### Queries: finding items takes work

Compare these requests:

```sql
-- One customer's open orders.
SELECT c.id, c.total FROM c
WHERE c.customerId = 'customer-42' AND c.status = 'open'
```

```sql
-- All customers' open orders.
SELECT c.id, c.total FROM c WHERE c.status = 'open'
```

Cosmos DB can route the first query to one logical partition. For the second, it searches across the relevant physical partitions and combines their results. Even if both return ten items, they can require different amounts of work.

An index contains searchable entries derived from document paths and values, such as `/status → "open"`. Cosmos DB can use those entries to find candidate items instead of scanning documents. The charge also includes document loading, processing and returning results. Returning fewer fields reduces the payload, but does not guarantee a matching percentage reduction in RUs.

In my small dataset, these queries targeted one customer's partition:

```sql
-- 3.16 RU, ten results
SELECT c.id, c.total FROM c WHERE c.status = 'open'

-- 4.70 RU, the same ten results
SELECT c.id, c.total FROM c WHERE LOWER(c.status) = 'open'

-- 3.28 RU, the ten full documents
SELECT * FROM c WHERE c.status = 'open'

-- 2.89 RU, no results
SELECT * FROM c WHERE c.status = 'missing'
```

The empty result still costs RUs: Cosmos DB has to establish that nothing matches. The two status filters also have different charges, but their recorded query metrics both reported ten retrieved documents. A higher charge alone does not prove a document scan. Inspect **Query Stats** in Data Explorer or collect SDK query metrics before explaining the difference.

<iframe src="/visuals/cosmos-db-ru/query-cost.html" title="Measured query RU charges, pagination costs, and an unmeasured partition fan-out diagram" width="100%" height="1700" loading="lazy"></iframe>

[Open the query-cost visual](/visuals/cosmos-db-ru/query-cost.html).

Partition scoping is worth testing, not assigning a fixed saving. In my small-container comparison, the scoped request cost **3.31 RU** and the unscoped request **3.19 RU** for the same ten results. This test does **not** measure multi-physical-partition fan-out. The visual explains that mechanism; it does not supply a measured multiplier.

### Read consistency: decide how fresh the result must be

Cosmos DB keeps replicas of your data. Your consistency level determines the guarantees you receive when reading them:

- **Session:** within a client session, you can read your own successful writes, and later reads do not return an older version. The SDK tracks session tokens. Reuse your `CosmosClient`; if a request moves between clients and needs the same guarantee, share the session token. Other clients can lag behind.
- **Strong:** reads return the latest committed version, regardless of the client session.
- **Bounded staleness:** in multi-region accounts, you allow a configured lag in versions or time, whichever limit is reached first. In one region, reads return the latest local data.

For **strong and bounded staleness**, Cosmos DB reads from two replicas instead of one. Budget **twice the read RUs** for point reads and queries compared with session consistency. My provisioned-account tests returned **2 RU** for the point read and **5.86 RU** for the equivalent SQL query with either stronger level.

The same write operation has the same RU charge across consistency levels, although replication can affect latency. The remaining examples use session-consistency read charges as their baseline.

### Writes: store the item and maintain its index

When you create an item, Cosmos DB stores the document and adds entries for the paths in your indexing policy. Replacing or patching it also requires index maintenance for changed values.

For this item, example index entries include `/status → "open"` and `/total → 42`:

```json
{
  "id": "order-123",
  "customerId": "customer-42",
  "status": "open",
  "total": 42
}
```

These labels illustrate path/value entries, not the physical index format. Nested fields and array elements can produce multiple entries, so counting top-level properties does not tell you the total indexing work.

<iframe src="/visuals/cosmos-db-ru/write-cost.html" title="Document indexing: Create, Replace and Patch tabs show path/value entries added or removed" width="100%" height="1100" loading="lazy"></iframe>

[Open the document-indexing visual](/visuals/cosmos-db-ru/write-cost.html).

My 1 KB test item contained twenty nested attributes, two changing values and a padding string. I measured:

| Operation | Default indexing | Targeted indexing |
|---|---:|---:|
| Create | 15.38 RU | 7 RU |
| Replace, two changed values | 11.38 RU | Not tested |
| Patch, the same two changes | 11.70 RU | Not tested |

The targeted policy included `customerId`, `status` and `total`, and excluded other user paths. Creating the same item cost about **54.5% less**, without changing its request-body size. Replace cost less than create with default indexing because most indexed values stayed unchanged.

Patch reduces the payload you send and can avoid a client-side read/modify/replace cycle. It **does not guarantee fewer RUs per write** than replace.

Keep items small and index the properties your queries need. Before removing an index, test affected queries: you can increase their charges or break sort patterns. Microsoft's illustrative write-cost calculations appear in the appendix; their coefficients are not a universal formula.

## 3. Measure the complete operation

You cannot derive an exact query charge from SQL text or result count alone. Read the **`x-ms-request-charge`** response header and sum the charges for the complete operation.

A query executes as you consume its results. It can make several service requests, including responses with no items. Reading only the last response's charge undercounts the work.

Install `azure-cosmos` and set `COSMOS_ENDPOINT` and `COSMOS_KEY` in your environment. This example assumes an existing `shop` database and `orders` container with `/customerId` as its partition key. Use a read-only key for read examples and keep credentials out of source control.

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

In my test, this query returned 20 orders. Four responses charged **2.92, 2.82, 2.82 and 2.82 RU**, for a total of **11.38 RU**.

### Pagination changes the work you measure

`max_item_count` sets an upper bound per page, not a promised item count. Cosmos DB can split execution because of response size, execution time or available throughput. An empty page does not necessarily mean the query has finished.

Smaller pages can add requests and overhead. For the same query and 20 results, I measured:

| Maximum items per page | Responses | Total charge |
|---|---:|---:|
| 100 | 1 | 3.29 RU |
| 5 | 4 | 11.38 RU |
| 1 | 20 | 54.50 RU |

Fetching one item per page cost about **16.6 times** as much as fetching all results in one response. There is no fixed “RU per page” tariff. Keep page size, data, indexing and consistency fixed when comparing queries.

For a Next button, keep the **continuation token** and resume the same query instead of starting again. Continue while a token remains, even if a page is empty. The appendix shows the Python pattern for a single-partition query.

Avoid using a growing offset to simulate that progress. Cosmos DB still processes skipped items:

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

Each query returned five IDs from the 200-order test. Without `ORDER BY`, these examples do not guarantee stable ordering; they demonstrate the extra work of skipping items. Continuation tokens preserve progress without repeating that skip work. When measuring user journeys, count the pages users actually fetch rather than assuming they read the entire result set.

## 4. Turn measurements into throughput requirements

Once you have representative charges, multiply each by its peak operation rate:

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

With 1,000 RU/s provisioned, this workload needs 49% of capacity and leaves 510 RU/s of arithmetic headroom. Strong or bounded staleness doubles the read estimates, taking the total to **840 RU/s** while leaving the create assumption unchanged.

Enter your own rates and measured charges in the calculator. Use **session-consistency read charges** as the baseline before choosing a consistency level.

<iframe src="/visuals/cosmos-db-ru/workload-budget.html" title="RU calculator: multiply request rates by charges and compare demand with provisioned capacity" width="100%" height="1450" loading="lazy"></iframe>

[Open the RU calculator](/visuals/cosmos-db-ru/workload-budget.html).

Include background work and other applications sharing the throughput. Size for peak traffic, not the daily average, and validate latency under load. The total alone does not tell you whether every partition has enough capacity.

### How throughput divides across partitions

You provision throughput on a container or share database-level throughput across containers. For the following example, use a **container with dedicated manual throughput** and the default equal allocation policy.

Cosmos DB manages the physical partition count according to storage and provisioned throughput. Each physical partition can hold up to **50 GB** and support up to **10,000 RU/s**. As the container grows, Cosmos DB can split physical partitions. You do not choose one physical partition per customer, and the count is not simply the number of distinct partition-key values.

Under the default policy:

```text
RU/s per physical partition = container's provisioned RU/s
                              ÷ number of physical partitions
```

Suppose a container has three physical partitions and 1,200 RU/s provisioned. Each receives **400 RU/s**. Several logical partitions can share each physical partition; their requests compete for its allocation. A customer does **not** receive a separate 400 RU/s allowance.

The **10,000 RU/s ceiling** is different from the **400 RU/s allocated** in this example. A logical partition remains on one physical partition, so one hot partition-key value cannot use capacity spread across multiple physical partitions.

### Why a hot partition can throttle below the total budget

Now direct 700 RU/s of demand to physical partition A and 100 RU/s to each of B and C:

| Physical partition | Allocated capacity | Demand |
|---|---:|---:|
| A | 400 RU/s | 700 RU/s |
| B | 400 RU/s | 100 RU/s |
| C | 400 RU/s | 100 RU/s |
| **Total** | **1,200 RU/s** | **900 RU/s** |

Total demand fits, but A exceeds its allocation. Requests to A can receive **HTTP 429: Request rate too large** despite spare capacity on B and C. The SDK retries according to its retry policy, which can increase end-to-end latency.

Check **Normalized RU Consumption by PartitionKeyRangeID**, throttling and application latency. Choose a partition key that distributes traffic and supports common queries. Customer-based partitioning scopes customer queries, but one very active customer can still create a hot partition.

This example assumes equal manual allocations. Throughput redistribution and dynamic autoscale can change partition-level allocations or scaling behavior. Check actual partition-level demand and capacity rather than applying the equal-share calculation to every configuration. The small tests in this article did not measure hot-partition throttling.

## 5. Translate the workload into a bill

An operation's RU charge describes the work performed. Your throughput mode determines how Azure bills it:

| Mode | What you pay for |
|---|---|
| **Manual provisioned throughput** | The RU/s you provision, billed hourly, including idle capacity. |
| **Autoscale** | Scaled capacity under the hourly billing rules, up to your configured maximum. Dynamic autoscale tracks peaks per partition and region. |
| **Serverless** | Consumed RUs, without reserving an RU/s allocation. Capacity limits still apply. |

My manual, free-tier manual and serverless accounts returned the same request charges for the tested operations. Changing the mode changed the billing model, not those operations' measured work.

### Free tier covers provisioned capacity

You can enable Cosmos DB's **lifetime free tier** on one account per subscription, at account creation. It covers the first **1,000 RU/s and 25 GB of storage** across that account. Manual and autoscale provisioned throughput qualify; **serverless does not**.

Free tier changes the bill, not the operation's RU charge. It is separate from the Azure free account's time-limited credits and allowances.

### Compare steady and intermittent traffic

The [Azure Retail Prices API](https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Azure%20Cosmos%20DB%27%20and%20armRegionName%20eq%20%27westeurope%27) listed these **West Europe, USD, pay-as-you-go** rates when checked on **4 November 2026**:

- Serverless: **$0.305 per million consumed RUs**.
- Manual throughput: **$0.008 per 100 RU/s-hour**.
- Standard transactional storage: **$0.25 per GB-month**, including data and index storage.

Use the earlier **490 RU/s workload**, **1,000 RU/s manual capacity**, **10 GB total billable storage** and a **730-hour month**. Compare continuous traffic with the same workload active for one hour per day over 30 days. Keep manual capacity provisioned for the whole month in both cases.

| Monthly cost | Serverless | Manual, no free tier | Manual, free tier |
|---|---:|---:|---:|
| Continuous traffic: 1,287.72 million RU | $392.75 | $58.40 | $0.00 |
| Intermittent traffic: 52.92 million RU | $16.14 | $58.40 | $0.00 |
| Storage, 10 GB | $2.50 | $2.50 | $0.00 |
| **Continuous total** | **$395.25** | **$60.90** | **$0.00** |
| **Intermittent total** | **$18.64** | **$60.90** | **$0.00** |

Serverless costs less for the intermittent workload without free tier; manual throughput costs less for the continuous workload. Free tier covers the chosen manual capacity and storage only if the full allowance is available. There is no serverless “with free tier” price.

These estimates exclude taxes, currency conversion, negotiated discounts, network transfer, extra backup options and other features. Additional regions change provisioned-capacity billing. Capacity limits, bursts and partitioning also constrain the mode you can use. Recheck the [pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/) for your account; the appendix contains the arithmetic behind this comparison.

## 6. Apply this to your workload

1. **Measure representative operations.** Include complete query execution and the pages your users fetch.
2. **Find the expensive work.** Compare point reads with SQL, inspect query metrics and review item size and indexing.
3. **Change one thing and measure again.** Keep data, consistency and paging settings fixed for comparisons.
4. **Validate capacity under peak load.** Check partition-level utilization, throttling and end-to-end latency.
5. **Estimate the bill for your traffic pattern.** Account for idle provisioned capacity, storage and any free-tier allowance.

## Appendix: examples and test notes

### Additional Python examples

These examples reuse the `container` client from section 3. Replace the sample IDs with items in your own container.

**Point read**

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

**Equivalent SQL query**

The measured item used the ID `size-1024`; this example uses `order-123`. Consuming the iterator executes the query and captures all response charges.

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

**One page with a continuation token**

Pass the saved token back with the same query, parameters and partition key on the next application request. Continue while `next_token` has a value, even if `items` is empty. This example stays within one partition; check the SDK's continuation-token support before extending it to cross-partition or aggregate queries.

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

**Patch two indexed values**

This operation requires write permission and modifies the item. Use a test container and credentials with the required permission, not the read-only key used for the earlier examples.

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

I used `azure-cosmos` **4.14.2**, one region in West Europe and no zone redundancy. Each provisioned account used a shared **400 RU/s** database, with no autoscale. The provisioned accounts defaulted to Strong consistency; baseline clients requested Session. Separate clients tested Strong and Bounded Staleness. The serverless account used Session.

The point-read, equivalent-SQL and write comparisons each ran three times per mode:

| Operation | Paid manual | Free-tier manual | Serverless |
|---|---:|---:|---:|
| Point read, about 1 KB item | 1 RU | 1 RU | 1 RU |
| Equivalent SQL, one item | 2.93 RU | 2.93 RU | 2.93 RU |
| Create, default indexing | 15.38 RU | 15.38 RU | 15.38 RU |
| Replace, two changed values | 11.38 RU | 11.38 RU | 11.38 RU |
| Patch, same two changes | 11.70 RU | 11.70 RU | 11.70 RU |
| Create, targeted indexing | 7 RU | 7 RU | 7 RU |

The query dataset contained 200 orders across ten customers. For the scoped/unscoped comparison, both requests selected the same ten open orders with this SQL:

```sql
SELECT c.id, c.total FROM c
WHERE c.status = 'open' AND STARTSWITH(c.id, 'order-')
```

`STARTSWITH` excluded the size-test items. The scoped request used `partition_key="customer-00"` and cost **3.31 RU**. The unscoped request omitted that option, used `enable_cross_partition_query=True` and cost **3.19 RU**. The status-filter and pagination comparisons used `customer-00`; the offset tests were cross-partition requests without an SDK partition-key scope.

These small datasets do not validate multi-physical-partition fan-out, hot-partition throttling or cross-region consistency behavior. The figures are response-charge measurements, not an invoice comparison. The optional [raw measurement data](/visuals/cosmos-db-ru/measurements-2026-11-04.json) contains per-response charges, indexing policies and collection limitations.

### Microsoft's illustrative write calculations

Microsoft's [RU consumption guide](https://learn.microsoft.com/en-us/azure/cosmos-db/understand-request-unit-consumption#write-operations) gives these examples for a 1 KB item in one region:

| Operation | Work in Microsoft's example | Charge |
|---|---|---:|
| Create, ten indexed terms | 5 RU for document + 10 × 0.2 RU for index entries | 7 RU |
| Replace, two modified terms | 5 + 5 RU for old/new document + 2 × 0.2 RU removal + 2 × 0.2 RU insertion | 10.8 RU |
| Patch, two modified terms | Same 10.8 RU + 2 × 0.4 RU patch work | 11.6 RU |

These coefficients belong to the examples. They do not predict the exact charge for an arbitrary document or indexing policy.

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

Without free tier, request costs break even at about **191.5 million RU/month** for this manual capacity: `$58.40 ÷ $0.305` gives the number of million-RU units. At an active demand of 490 RU/s, that is about **108.5 active hours per month**. This comparison assumes you keep manual capacity provisioned all month; it does not establish which mode can meet your burst or latency requirements.

## Sources

- [Request units](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units)
- [Consistency levels](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels)
- [Point reads versus queries](https://devblogs.microsoft.com/cosmosdb/point-reads-versus-queries/)
- [Understanding RU consumption](https://learn.microsoft.com/en-us/azure/cosmos-db/understand-request-unit-consumption)
- [Optimize request cost](https://learn.microsoft.com/en-us/azure/cosmos-db/optimize-cost-reads-writes)
- [Python ContainerProxy API](https://learn.microsoft.com/en-us/python/api/azure-cosmos/azure.cosmos.containerproxy)
- [Query pagination](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/pagination) and [OFFSET LIMIT](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/offset-limit)
- [Partitioning and horizontal scaling](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview)
- [Redistribute throughput across partitions](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/distribute-throughput-across-partitions)
- [Lifetime free tier](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier)
- [Serverless billing](https://learn.microsoft.com/en-us/azure/cosmos-db/serverless)
- [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Troubleshoot HTTP 429](https://learn.microsoft.com/en-us/azure/cosmos-db/troubleshoot-request-rate-too-large)

Prices in the worked example date from 4 November 2026. Recheck rates before using them for a budget.
