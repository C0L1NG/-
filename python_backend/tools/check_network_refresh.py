"""Review-only probe; disposable test schemas or mocked browser API, no real payments."""

# ruff: noqa: E402
import asyncio
import json
import os
import socket
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
import shutil

NODE = shutil.which("node")
if not NODE:
    raise RuntimeError("Node must be on PATH")


async def main():
    data = json.loads(
        subprocess.check_output(
            [
                NODE,
                "--import",
                "tsx",
                "--input-type=module",
                "-e",
                "import {demoAdminOverview,demoNetworkNodes} from './web/lib/admin-demo-data.ts';console.log(JSON.stringify({overview:demoAdminOverview,nodes:demoNetworkNodes('all')}));",
            ],
            cwd=ROOT,
            text=True,
        )
    )
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryFile() as logs:
        server = subprocess.Popen(
            [
                NODE,
                str(ROOT / "web/node_modules/next/dist/bin/next"),
                "start",
                "-H",
                "127.0.0.1",
                "-p",
                str(port),
            ],
            cwd=ROOT / "web",
            stdout=logs,
            stderr=logs,
        )
        try:
            async with httpx.AsyncClient() as client:
                for _ in range(100):
                    try:
                        if (await client.get(base)).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.1)
            calls = []
            node = data["nodes"][0]

            async def route(route):
                url = urlsplit(route.request.url)
                q = parse_qs(url.query)
                if url.path == "/api/admin/overview":
                    value = data["overview"]
                elif url.path == "/api/admin/team-network":
                    p = int(q.get("page", ["1"])[0])
                    child = "parentId" in q
                    calls.append({"child": child, "page": p})
                    item = (
                        {
                            **node,
                            "id": f"child-{p}",
                            "displayName": f"CHILD-PAGE-{p}",
                            "teamSize": 0,
                        }
                        if child
                        else node
                    )
                    value = {
                        "items": [item],
                        "total": 40 if child else 1,
                        "page": p,
                        "pageSize": 20,
                        "totalPages": 2 if child else 1,
                    }
                else:
                    value = {
                        "items": [],
                        "total": 0,
                        "page": 1,
                        "pageSize": 20,
                        "totalPages": 0,
                    }
                await route.fulfill(
                    status=200, content_type="application/json", body=json.dumps(value)
                )

            async with async_playwright() as pw:
                browser = await pw.chromium.launch(
                    channel=os.getenv("BROWSER_CHANNEL"), headless=True
                )
                page = await browser.new_page(viewport={"width": 430, "height": 932})
                await page.route("**/api/**", route)
                await page.goto(base + "/admin/mobile/team/")
                await page.get_by_role(
                    "button",
                    name="查看" + node["displayName"] + "的代理详情",
                    exact=True,
                ).click()
                await expect(page.get_by_role("dialog")).to_be_visible()
                await page.evaluate("window.dispatchEvent(new Event('focus'))")
                await page.wait_for_timeout(350)
                await expect(page.get_by_role("dialog")).to_be_visible()
                await page.get_by_role("button", name="关闭").click()
                await page.get_by_role(
                    "button",
                    name="展开" + node["displayName"] + "的直属团队",
                    exact=True,
                ).click()
                await expect(page.get_by_text("CHILD-PAGE-1", exact=True)).to_be_visible()
                await page.get_by_role("button", name="下一页", exact=True).click()
                await expect(page.get_by_text("CHILD-PAGE-2", exact=True)).to_be_visible()
                await page.wait_for_timeout(1100)
                await page.evaluate("window.dispatchEvent(new Event('focus'))")
                await page.wait_for_timeout(350)
                await expect(page.get_by_text("CHILD-PAGE-2", exact=True)).to_be_visible()
                proof = {
                    "realBrowser": "Chrome headless, built React; controlled API",
                    "networkDetailPreservedByBackgroundRefresh": True,
                    "childPage2PreservedByBackgroundRefresh": True,
                    "networkRequests": calls,
                }
                (ROOT / "docs/reviews/evidence/review6-network-refresh-fixed.json").write_text(
                    json.dumps(proof, indent=2) + "\n"
                )
                print(json.dumps(proof))
                await browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)


asyncio.run(main())
