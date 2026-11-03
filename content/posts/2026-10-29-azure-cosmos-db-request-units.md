---
title: How Azure Cosmos DB Calculates Request Units
author: thibauldc
date: 2026-10-29 15:00:00
categories: [Azure, Cosmos DB]
tags: [azure, cosmosdb, performance, cost]
---
A point read in Azure Cosmos DB might cost 1 RU. A query might cost 15 RU. To size your database, you need both the cost of each operation and how often your application performs it.

A **Request Unit (RU)** measures the database work needed for an operation. **RU/s** measures throughput: how much work you can perform per second. You can estimate your workload with:

```text
Required RU/s = sum of (operations per second × RU per operation)
```

The multiplication is straightforward. Finding the right cost per operation takes more care.

The examples below use **Azure Cosmos DB for NoSQL**, one region, and **session consistency**, unless stated otherwise. Microsoft publishes reference values and illustrative calculations; measure your own requests before sizing production capacity.

## 1. What one RU represents

Cosmos DB combines CPU, memory and I/O work into one measure. You do not provision those resources separately.

The usual reference point is **1 RU to read an item of about 1 KB by its ID and partition key**. A query can involve index lookups, document loading and filtering, so you cannot calculate its charge from the response size alone.

Microsoft aims for repeatable charges for the same operation on the same data and configuration. Changing your indexes, consistency level or query changes the work. Platform improvements can also change charges over time. Treat measurements as a baseline to monitor, rather than a permanent price list.

## 2. Point reads: the simplest case

Suppose your container uses `/customerId` as its partition key. You know an order's ID, `order-123`, and its customer, `customer-42`. With a configured `Container` from the .NET v3 SDK, you can read it like this:

```csharp
ItemResponse<System.Text.Json.JsonElement> response =
    await container.ReadItemAsync<System.Text.Json.JsonElement>(
        id: "order-123",
        partitionKey: new PartitionKey("customer-42"));

Console.WriteLine($"Point read: {response.RequestCharge:F2} RU");
```

You give Cosmos DB the exact address of the item. It can fetch it without running a SQL query.

Microsoft's [point-read reference values](https://learn.microsoft.com/en-us/azure/cosmos-db/optimize-cost-reads-writes#point-reads) show the effect of item size and consistency:

| Item size | Session or eventual consistency | Strong or bounded staleness |
|---|---:|---:|
| About 1 KB | 1 RU | About 2 RU |
| About 100 KB | 10 RU | About 20 RU |

**Do not use “1 RU per KB” as a formula.** A 100 KB point read costs about 10 RU in this reference, not 100 RU. Item size affects the charge, but the relationship is not a simple per-KB rate.

This SQL looks similar to a point read, but Cosmos DB still executes it as a query:

```sql
SELECT *
FROM c
WHERE c.id = 'order-123'
  AND c.customerId = 'customer-42'
```

Use the SDK's item-read operation when you know both values. Returning one item does not make a SQL query a 1 RU operation.

## 3. Writes: storing the item plus maintaining indexes

For a create, Cosmos DB stores the document and adds the indexed terms required by your indexing policy. Larger documents and more indexed terms generally mean more work.

Microsoft's [RU consumption guide](https://learn.microsoft.com/en-us/azure/cosmos-db/understand-request-unit-consumption#write-operations) illustrates a **1 KB create with ten indexed terms in one region**:

```text
Document storage work       5.0 RU
Index work: 10 × 0.2 RU    + 2.0 RU
                           --------
Illustrative create charge  7.0 RU
```

Move the slider to change the number of indexed terms and see the example charge change. The document contribution stays at 5 RU in this model.

<iframe src="/visuals/cosmos-db-ru/write-cost.html" title="Interactive illustrative write-cost model: adjust indexed terms to see the create charge" width="100%" height="850" loading="lazy"></iframe>

[Open the interactive write-cost visual on its own](/visuals/cosmos-db-ru/write-cost.html).

**The 0.2 RU coefficient belongs to this example.** Do not turn it into a universal indexing tariff or assume one JSON property equals one indexed term. Arrays and nested structures can produce more index work.

A replace involves work on the old and new document, plus changed index terms. It can cost around twice a create, depending on what changes. A patch can reduce your request payload and client-side work, but it does **not guarantee a lower RU charge** than a replace.

To reduce write costs, keep items small and exclude properties you do not need to filter or sort on from indexing. Check your queries before removing indexes: lower write charges can come with more expensive queries or unsupported sort patterns.

## 4. Queries: count the work, not just the results

Compare these requests on a container partitioned by `/customerId`:

```sql
-- Orders for one customer: can target that customer's logical partition.
SELECT c.id, c.total
FROM c
WHERE c.customerId = 'customer-42'
  AND c.status = 'open'
```

```sql
-- Open orders across customers: may fan out across physical partitions.
SELECT c.id, c.total
FROM c
WHERE c.status = 'open'
```

The first query gives Cosmos DB a partition-key equality filter. The second can require work across multiple physical partitions. Both might return ten orders, yet have different charges.

Query cost depends on index lookups, documents loaded and processed, query complexity, and the amount of data returned. A suitable index can avoid loading large numbers of documents. Projecting just `id` and `total` reduces the response payload, but does not guarantee a proportional RU reduction.

Even a query returning zero results can consume RUs. Cosmos DB still has to determine that no items match.

### Add the charges from all pages

Cosmos DB can return a query in several pages. Each response reports its own charge, including pages that contain no items.

For this **illustrative** execution:

| Response | Charge |
|---|---:|
| Page 1 | 3.2 RU |
| Page 2 | 4.1 RU |
| Page 3 | 2.7 RU |
| **Complete query** | **10.0 RU** |

Logging only the first response would report 3.2 RU and miss most of the cost.

Use `RequestCharge` on each response and sum it until you finish reading. This .NET v3 example assumes an existing, configured `container`:

```csharp
var query = new QueryDefinition(
    "SELECT c.id, c.total FROM c WHERE c.status = @status")
    .WithParameter("@status", "open");

using FeedIterator<System.Text.Json.JsonElement> pages =
    container.GetItemQueryIterator<System.Text.Json.JsonElement>(
        query,
        requestOptions: new QueryRequestOptions
        {
            PartitionKey = new PartitionKey("customer-42")
        });

double totalRu = 0;
while (pages.HasMoreResults)
{
    FeedResponse<System.Text.Json.JsonElement> page = await pages.ReadNextAsync();
    totalRu += page.RequestCharge;
    // Process any items in this page.
}

Console.WriteLine($"Complete query: {totalRu:F2} RU");
```

The explicit `PartitionKey` option scopes this query to one customer. Omit that scope only if you intend to search across customers. Keep query shape, data, indexing and paging settings consistent when comparing measurements.

You can also inspect **Query Stats** in the portal's Data Explorer. For an expensive query, use query metrics to compare documents retrieved with documents returned and inspect index use. A large gap is a reason to investigate the access pattern, rather than add throughput first.

## 5. Turn request charges into a throughput budget

Suppose your application performs this workload in one second. These are **illustrative planning inputs**, not benchmark results:

| Operation | Operations per second | RU per operation | Demand |
|---|---:|---:|---:|
| Point read, about 1 KB | 200 | 1 | 200 RU/s |
| Create | 20 | 7 | 140 RU/s |
| Query, all pages included | 10 | 15 | 150 RU/s |
| **Total** | | | **490 RU/s** |

With 1,000 RU/s provisioned, that is 49% of capacity and 510 RU/s of arithmetic headroom.

Try your own request rates and charges in the calculator. Enter **session-consistency read charges** as the baseline, then choose a consistency level. The bars show demand against the capacity you enter; this is a throughput estimate, not an Azure price quote.

<iframe src="/visuals/cosmos-db-ru/workload-budget.html" title="Interactive RU calculator: change request rates, request charges, consistency and capacity to move the throughput bars" width="100%" height="1450" loading="lazy"></iframe>

[Open the RU calculator on its own](/visuals/cosmos-db-ru/workload-budget.html).

Stronger consistency also changes this calculation. With **strong or bounded staleness**, budget about twice the read charge for point reads and queries. Keeping the create assumption unchanged:

```text
Point reads: 200 × 2 RU  = 400 RU/s
Creates:      20 × 7 RU  = 140 RU/s
Queries:      10 × 30 RU = 300 RU/s
                          --------
Total                     840 RU/s
```

Use peak traffic and representative item sizes when sizing capacity. A daily average hides short bursts. Include other operations, background work and traffic from applications sharing the same throughput allocation. Extra capacity gives you room for those differences, but the right margin depends on your workload.

## 6. A hot partition can throttle below the total budget

For a simplified **manual-throughput** example, assume Cosmos DB spreads 1,200 RU/s equally across three physical partitions: 400 RU/s each.

Your application requests 700 RU/s on partition A and 100 RU/s on each of B and C. The total demand is 900 RU/s, below 1,200, but A exceeds its own allocation.

Adjust each partition's requested demand with the sliders. Compare each moving bar with the 400 RU/s marker, even if total demand stays below 1,200 RU/s.

<iframe src="/visuals/cosmos-db-ru/hot-partition.html" title="Interactive hot-partition example: move demand bars against each partition's 400 RU/s budget" width="100%" height="1150" loading="lazy"></iframe>

[Open the interactive hot-partition visual on its own](/visuals/cosmos-db-ru/hot-partition.html).

You can receive **HTTP 429: Request rate too large** on A despite spare capacity elsewhere. The SDK retries throttled requests according to its retry policy, which can increase end-to-end latency. Do not treat spare total capacity as a guarantee that every request will succeed without throttling.

Check **Normalized RU Consumption by PartitionKeyRangeID**, throttling and application latency. Choose a partition key that distributes traffic while supporting your common queries. For customer-based partitioning, one very active customer can still create a hot partition.

This example assumes equal allocations. Features such as dynamic autoscale and throughput redistribution can change the allocation; the partition-level demand still matters.

## 7. RUs and your Azure bill

An operation's RU charge describes resource consumption. Your throughput mode determines how Azure bills it:

| Mode | What you pay for |
|---|---|
| Manual provisioned throughput | The RU/s capacity you provision, billed hourly, even if you do not use all of it. |
| Autoscale provisioned throughput | Capacity that scales within a configured range, with hourly billing based on the highest scaled throughput. Dynamic autoscale accounts for peaks per partition and region. |
| Serverless | The RUs your operations consume, rather than a reserved RU/s allocation. |

For the 490 RU/s example, a constant hour of traffic consumes **490 × 3,600 = 1,764,000 RU**. In serverless, that consumption contributes to your usage bill. With manual 1,000 RU/s throughput, you pay for the provisioned capacity for the hour, not just those consumed RUs.

Storage and other applicable charges are separate. In provisioned-throughput accounts, Cosmos DB provisions capacity in each configured region. Adding a region affects cost; do not multiply one response's RU charge by the region count and call that your invoice. Use the [pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/) for your region, throughput mode and account configuration.

## Measure first, then change one thing

Start by recording the charge for your most frequent operations and your most expensive queries. Include every query page. Multiply those charges by peak request rates, then check partition-level utilization and latency under load.

Prefer point reads where you know the item's address. For the remaining operations, test smaller items, targeted indexes or better partition scoping. Measure again after each change so you can see whether it helped.

## Sources

- [Request Units as a throughput and performance currency](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units)
- [Understanding Request Units Consumption](https://learn.microsoft.com/en-us/azure/cosmos-db/understand-request-unit-consumption), including the illustrative write calculation
- [Optimize request cost](https://learn.microsoft.com/en-us/azure/cosmos-db/optimize-cost-reads-writes), including point-read reference values and query pagination
- [Find the request unit charge](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/find-request-unit-charge)
- [Troubleshoot request rate too large exceptions](https://learn.microsoft.com/en-us/azure/cosmos-db/troubleshoot-request-rate-too-large)
- [Autoscale throughput FAQ](https://learn.microsoft.com/en-us/azure/cosmos-db/autoscale-faq)

Documentation checked on 29 October 2026. Example workloads are illustrative; no live-account benchmark results appear in this post.
