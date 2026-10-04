"""Configure both native projects without committing merchant secrets."""

import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("--agent-appid", required=True)
parser.add_argument("--admin-appid", required=True)
parser.add_argument("--api-url", required=True)
parser.add_argument("--web-url", required=True)
args = parser.parse_args()
if urlsplit(args.api_url).scheme != "https" or not urlsplit(args.api_url).hostname:
    parser.error("API URL must use HTTPS and be registered in WeChat request domains")
if urlsplit(args.web_url).scheme != "https" or not urlsplit(args.web_url).hostname:
    parser.error("Web URL must use HTTPS and be registered as a WeChat business domain")
for appid in (args.agent_appid, args.admin_appid):
    if not appid.startswith("wx") or len(appid) != 18 or not appid[2:].isalnum():
        parser.error("AppIDs must be WeChat wx identifiers")
root = Path(__file__).resolve().parents[1]
for folder, appid in [
    ("miniprogram", args.agent_appid),
    ("admin_miniprogram", args.admin_appid),
]:
    config = root / folder / "project.config.json"
    value = json.loads(config.read_text())
    value["appid"] = appid
    config.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    (root / folder / "config.js").write_text(
        "module.exports = { API_BASE_URL: "
        + json.dumps(args.api_url.rstrip("/"))
        + ", WEB_BASE_URL: "
        + json.dumps(args.web_url.rstrip("/"))
        + " }\n"
    )
print("AppIDs configured. Validate both projects in WeChat developer tools.")
