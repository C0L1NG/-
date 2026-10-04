"""Export a reproducible API contract without credentials or database connections."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python_backend"))
from app.config import Settings  # noqa: E402
from app.factory import create_app  # noqa: E402

settings = Settings(
    "postgresql://unused:unused@localhost/unused",
    "contract-only-" + "x" * 32,
    "saas",
    "agent-portal",
    "admin-portal",
    "https://example.com/register",
)
app = create_app(settings, session_factory=lambda: None)
target = ROOT / "docs/api/openapi.generated.json"
desired = json.dumps(app.openapi(), ensure_ascii=False, sort_keys=True, indent=2) + "\n"
parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if args.check:
    if not target.exists() or target.read_text() != desired:
        raise SystemExit("Stale OpenAPI: run tools/generate_openapi.py")
    print("OpenAPI matches routes, request validation and response models")
else:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(desired)
    print(f"Wrote {target}")
