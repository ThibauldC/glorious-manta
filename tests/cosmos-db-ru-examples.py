"""Run the article's Python against a lazy, multi-page Cosmos test double."""
import ast
import contextlib
import io
import os
from pathlib import Path
import re
import sys
from types import ModuleType
from unittest.mock import patch


class Pages:
    def __init__(self, options, token):
        self.options = options
        self.index = int(token.split("-")[1]) if token else 0
        self.continuation_token = token

    def __iter__(self):
        return self

    def __next__(self):
        pages = [[{"id": "order-123", "total": 42}], [], [{"id": "order-456", "total": 45}]]
        if self.index >= len(pages):
            raise StopIteration
        index = self.index
        self.options["response_hook"]({"x-ms-request-charge": str([3.2, 4.1, 2.7][index])}, None)
        self.index += 1
        self.continuation_token = f"page-{self.index}" if self.index < 3 else None
        return iter(pages[index])


class Query:
    def __init__(self, options):
        self.options = options

    def by_page(self, continuation_token=None):
        return Pages(self.options, continuation_token)

    def __iter__(self):
        for page in self.by_page():
            yield from page


class Container:
    def read_item(self, **options):
        assert options["item"] == "order-123"
        assert options["partition_key"] == "customer-42"
        options["response_hook"]({"x-ms-request-charge": "1"}, None)
        return {"id": "order-123", "total": 42}

    def query_items(self, **options):
        if options["query"] == "SELECT c.id, c.total FROM c":
            assert options["partition_key"] == "customer-00"
            assert options["max_item_count"] == 5
            assert "parameters" not in options
        else:
            assert options["partition_key"] == "customer-42"
        return Query(options)

    def patch_item(self, **options):
        assert options["partition_key"] == "customer-42"
        assert options["patch_operations"] == [
            {"op": "set", "path": "/status", "value": "shipped"},
            {"op": "set", "path": "/total", "value": 45},
        ]
        options["response_hook"]({"x-ms-request-charge": "11.6"}, None)


container = Container()


class Client:
    def __init__(self, endpoint, **options):
        assert options["consistency_level"] == "Session"

    def get_database_client(self, name):
        assert name == "shop"
        return self

    def get_container_client(self, name):
        assert name == "orders"
        return container


article = Path("content/posts/2026-10-29-azure-cosmos-db-request-units.md").read_text()
blocks = re.findall(r"```python\n(.*?)```", article, re.S)
assert len(blocks) == 5
cosmos = ModuleType("azure.cosmos")
cosmos.CosmosClient = Client
scope = {}
with patch.dict(sys.modules, {"azure": ModuleType("azure"), "azure.cosmos": cosmos}), patch.dict(
    os.environ, {"COSMOS_ENDPOINT": "https://example.invalid", "COSMOS_KEY": "test"}
), contextlib.redirect_stdout(io.StringIO()):
    for index, block in enumerate(blocks):
        ast.parse(block)
        exec(block, scope)
        if index in (0, 2):
            # Include the empty middle response; do not stop at it or count only the last page.
            assert scope["charges"] == [3.2, 4.1, 2.7]
            assert sum(scope["charges"]) == 10
        if index == 1:
            assert scope["charges"] == [1]
        if index == 3:
            assert scope["next_token"] == "page-1"
            assert len(scope["items"]) == 1
            assert scope["charges"] == [3.2]
            # Resuming at an empty response must still expose the next token.
            resumed = scope["results"].by_page(continuation_token=scope["next_token"])
            assert list(next(resumed)) == []
            assert resumed.continuation_token == "page-2"
        if index == 4:
            assert scope["charges"] == [11.6]
print("Python examples pass, including empty responses and continuation tokens.")
