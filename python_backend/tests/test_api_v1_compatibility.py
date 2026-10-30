import json
from pathlib import Path

from app.config import Settings
from app.factory import create_app


def test_existing_routes_requests_responses_and_schema_shapes_are_preserved():
    baseline = json.loads((Path(__file__).parent / "fixtures/api-v1-contract.json").read_text())
    settings = Settings(
        "postgresql://unused:unused@localhost/unused",
        "x" * 32,
        "saas",
        "agent-portal",
        "admin-portal",
        "https://example.com",
    )
    current = create_app(settings, session_factory=lambda: None).openapi()
    for path, operations in baseline["operations"].items():
        assert path in current["paths"], f"Removed v1 path: {path}"
        for method, expected in operations.items():
            assert method in current["paths"][path], f"Removed v1 method: {method} {path}"
            actual = current["paths"][path][method]
            for name, value in expected.items():
                assert actual.get(name) == value, f"Changed v1 {name}: {method} {path}"
    for name, expected in baseline["schemas"].items():
        assert current["components"]["schemas"].get(name) == expected, f"Changed v1 schema: {name}"
