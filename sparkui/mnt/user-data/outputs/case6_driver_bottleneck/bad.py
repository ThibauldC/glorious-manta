"""Case 6 bad run: the work moves to the driver and the cluster goes quiet.

Quiz-only case. Do not present this in the talk.

The aggregation is expressible in Spark. Instead this script collects the rows and
loops over them in plain Python, so the middle of the run happens on one thread of
one machine while every executor sits idle.

What the Spark UI should show:
  Jobs      a long wall-clock gap between the collect job and the write job
  Executors zero active tasks during the gap, driver GC time climbing
  SQL       the second query starts with LocalTableScan, so the rows came from
            the driver rather than from storage
  Stages    the collect stage is the slowest stage, and it is not the problem

CALIBRATION. Start with one month. Print len(rows), check the driver memory on your
capacity, then widen DEMO_MONTHS until the Python loop runs five to ten minutes.
If the driver dies, cut the row count. Do not keep raising maxResultSize.
"""

import time

from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.getOrCreate()

TRIP_TABLE = "nyc_yellow_trips"
OUTPUT_PATH = "Files/nyc_taxi/demo_outputs/case6/bad"
DEMO_YEAR = 2024
DEMO_MONTHS = (1,)

spark.conf.set("spark.driver.maxResultSize", "8g")
spark.sparkContext.setJobDescription("CASE 6 BAD: aggregate on the driver")

trips = (spark.table(TRIP_TABLE)
         .where((F.col("pickup_year") == DEMO_YEAR)
                & F.col("pickup_month").isin(*DEMO_MONTHS))
         .where(F.col("tpep_pickup_datetime").isNotNull())
         .select("PULocationID", "DOLocationID", "trip_distance", "total_amount"))

collect_started = time.perf_counter()
rows = trips.collect()
print(f"CASE 6 collect: {time.perf_counter() - collect_started:.1f}s, {len(rows):,} rows")

# Everything below runs on one thread of the driver. The executors have nothing to do.
driver_started = time.perf_counter()
totals = {}
for row in rows:
    key = (row.PULocationID, row.DOLocationID)
    trips_so_far, revenue, distance = totals.get(key, (0, 0.0, 0.0))
    totals[key] = (trips_so_far + 1,
                   revenue + (row.total_amount or 0.0),
                   distance + (row.trip_distance or 0.0))
print(f"CASE 6 driver loop: {time.perf_counter() - driver_started:.1f}s, {len(totals):,} routes")

summary = spark.createDataFrame(
    [(pu, do, trips_so_far, revenue, distance / trips_so_far)
     for (pu, do), (trips_so_far, revenue, distance) in totals.items()],
    ["PULocationID", "DOLocationID", "trips", "revenue", "average_distance"])

write_started = time.perf_counter()
(summary.write.format("delta").mode("overwrite")
 .option("overwriteSchema", "true").save(OUTPUT_PATH))
print(f"CASE 6 write: {time.perf_counter() - write_started:.1f}s")
print(f"CASE 6 BAD total: {time.perf_counter() - collect_started:.1f}s")
