"""Real React/browser regression with controlled API faults; no real accounts or transfers."""

import argparse
import asyncio
import json
import os
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]


def fixtures(node):
    source = """import { getDemoAgent } from './web/lib/demo-data.ts';
import { demoAdminOverview, demoAuditItems } from './web/lib/admin-demo-data.ts';
console.log(JSON.stringify({agent:getDemoAgent('first'),overview:demoAdminOverview,audit:demoAuditItems}));"""
    return json.loads(
        subprocess.check_output(
            [node, "--import", "tsx", "--input-type=module", "-e", source], cwd=ROOT, text=True
        )
    )


async def run(browser_name, output):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node is required")
    data = fixtures(node)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryFile(mode="w+") as logs:
        server = subprocess.Popen(
            [
                node,
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
            env={**os.environ, "WEB_ORIGIN": base},
        )
        try:
            async with httpx.AsyncClient() as client:
                for _ in range(100):
                    try:
                        if (await client.get(base)).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    if server.poll() is not None:
                        raise RuntimeError("Next server exited")
                    await asyncio.sleep(0.1)
                else:
                    raise RuntimeError("Next startup timed out")
            state = {
                "referral_failure": True,
                "overview_failure": True,
                "changed": False,
                "withdrawals": [],
                "posts": 0,
                "intents": {},
                "activity_pages": [],
                "withdrawal_reads": 0,
            }
            records = [
                {
                    **data["agent"]["ledger"][0],
                    "id": f"record-{i}",
                    "orderNo": f"QA-{i:04d}",
                    "commissionAmount": "10.00",
                }
                for i in range(1, 17)
            ]
            account_id = "11111111-1111-4111-8111-111111111111"
            state["owner"] = account_id
            wallet = {**data["agent"]["wallet"], "balance": "1000.00", "debtBalance": "0.00"}

            async def route_api(route):
                request = route.request
                url = urlsplit(request.url)
                path, params = url.path, parse_qs(url.query)
                value, status = {}, 200
                if path == "/api/agent/overview":
                    value = data["agent"]["overview"]
                elif path == "/api/agent/referral":
                    value, status = (
                        ({"code": "TEST_FAILURE"}, 500)
                        if state["referral_failure"]
                        else (data["agent"]["referral"], 200)
                    )
                elif path == "/api/agent/activity":
                    page = int(params.get("page", ["1"])[0])
                    state["activity_pages"].append(page)
                    size = int(params.get("pageSize", ["8"])[0])
                    items = [dict(item) for item in records[(page - 1) * size : page * size]]
                    if state["changed"]:
                        for item in items:
                            if item["id"] == "record-9":
                                item["commissionAmount"] = "60.00"
                    value = {
                        "items": items,
                        "page": page,
                        "pageSize": size,
                        "total": 16,
                        "totalPages": (16 + size - 1) // size,
                    }
                elif path == "/api/agent/activity-summary":
                    value = {
                        "netEarnings": "160.00",
                        "ownEarnings": "160.00",
                        "teamEarnings": "0.00",
                    }
                elif path == "/api/admin/overview":
                    value, status = (
                        ({"code": "TEST_FAILURE"}, 500)
                        if state["overview_failure"]
                        else (data["overview"], 200)
                    )
                elif path == "/api/admin/commission-audit":
                    page = int(params.get("page", ["1"])[0])
                    value = {
                        "items": data["audit"],
                        "page": page,
                        "pageSize": 8,
                        "total": 16,
                        "totalPages": 2,
                    }
                elif path.endswith("/payout-accounts"):
                    value = {
                        "items": [
                            {
                                "id": account_id,
                                "provider": "bank",
                                "verified": True,
                                "label": "测试收款账户",
                            }
                        ]
                    }
                elif path.endswith("/wallet"):
                    value = wallet
                elif path == "/api/admin/withdrawals" and request.method == "POST":
                    body = request.post_data_json
                    state["posts"] += 1
                    item = {
                        "id": "22222222-2222-4222-8222-222222222222",
                        "amount": body["amount"],
                        "status": "pending",
                        "userId": state["owner"],
                        "accountScope": "platform",
                        "createdAt": "2026-10-29T02:00:00Z",
                        "payoutReference": None,
                    }
                    state["intents"][body["idempotencyKey"]] = item
                    await route.abort("failed")  # Accepted by simulated server; response lost.
                    return
                elif path == "/api/admin/withdrawals":
                    state["withdrawal_reads"] += 1
                    value = {
                        "items": state["withdrawals"],
                        "total": len(state["withdrawals"]),
                        "page": 1,
                        "pageSize": 20,
                    }
                elif path.startswith("/api/admin/withdrawal-intents/"):
                    value = state["intents"].get(path.rsplit("/", 1)[-1])
                    if not value:
                        value, status = {"code": "WITHDRAWAL_INTENT_NOT_FOUND"}, 404
                elif path == "/api/admin/system-health":
                    value = {"workers": [], "unresolvedCases": 0, "exhaustedPaymentEvents": 0}
                elif path == "/api/admin/reconciliation-cases":
                    value = {"items": [], "total": 0, "page": 1, "pageSize": 10}
                elif path == "/api/admin/operations-summary":
                    value = {
                        "pendingWithdrawals": len(state["withdrawals"]),
                        "processingWithdrawals": 0,
                        "failedPaymentEvents": 0,
                        "pendingPaymentEvents": 0,
                        "unverifiedAccounts": 0,
                    }
                elif path == "/api/agent/team":
                    value = {"items": [], "total": 0, "page": 1, "pageSize": 20, "totalPages": 0}
                else:
                    value, status = {"code": "UNMOCKED_API", "path": path}, 404
                await route.fulfill(
                    status=status,
                    json=value,
                    headers={"X-Account-ID": state["owner"]} if path.endswith("/wallet") else {},
                )

            results = {}
            async with async_playwright() as driver:
                browser = await driver.chromium.launch(
                    channel="chrome" if browser_name == "chrome" else None
                )
                context = await browser.new_context(viewport={"width": 375, "height": 812})
                await context.route("**/api/**", route_api)
                page = await context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                await page.clock.install()
                await page.goto(base + "/agent/ledger/")
                await expect(page.get_by_role("heading", name="分润明细")).to_be_visible()
                await expect(page.get_by_text("推广信息暂时不可用", exact=False)).to_be_visible()
                await page.get_by_role("button", name="加载更早记录").click()
                await page.get_by_text("#0009", exact=True).click()
                dialog = page.get_by_role("dialog")
                await expect(dialog).to_be_visible()
                state["changed"] = True
                await page.clock.fast_forward(61_000)
                await expect(dialog).to_be_visible()
                await expect(dialog).to_contain_text("60.00")
                assert state["activity_pages"][-1] == 2
                results["agent_referral_failure_isolated"] = True
                results["background_refresh_keeps_page_and_detail"] = True

                await page.set_viewport_size({"width": 1440, "height": 1000})
                await page.goto(base + "/admin/pc/?view=treasury")
                await expect(page.get_by_role("heading", name="资金执行与提现审核")).to_be_visible()
                initial_reads = state["withdrawal_reads"]
                await page.get_by_role("button", name="刷新当前页面").first.click()
                for _ in range(50):
                    if state["withdrawal_reads"] > initial_reads:
                        break
                    await asyncio.sleep(0.05)
                assert state["withdrawal_reads"] > initial_reads
                results["admin_overview_failure_does_not_block_treasury"] = True
                results["global_refresh_updates_withdrawal_list"] = True
                await page.goto(base + "/admin/pc/?view=audit&page=2&period=month")
                await expect(page.get_by_role("heading", name="订单分账记录")).to_be_visible()
                assert parse_qs(urlsplit(page.url).query).get("page") == ["2"]
                results["task_url_restores_workspace_page_and_period"] = True

                await page.goto(base + "/admin/pc/?view=treasury&fundsTab=withdraw")
                amount = page.get_by_label("提现金额", exact=True)
                await amount.fill("12.30")
                await page.get_by_role("button", name="提交提现申请", exact=True).click()
                await expect(
                    page.get_by_role("button", name="核对上次申请结果", exact=True)
                ).to_be_visible()
                await expect(amount).to_have_attribute("readonly", "")
                state["owner"] = "33333333-3333-4333-8333-333333333333"
                await page.reload()
                await expect(page.get_by_label("提现金额", exact=True)).to_have_value("")
                await expect(page.get_by_text("已找回申请", exact=False)).to_have_count(0)
                state["owner"] = account_id
                await page.reload()
                await expect(page.get_by_text("已找回申请", exact=False)).to_be_visible()
                results["account_switch_does_not_reuse_previous_intent"] = True
                assert state["posts"] == 1
                results["unknown_withdrawal_recovers_after_reload_without_duplicate"] = True

                state["overview_failure"] = False
                state["referral_failure"] = False
                await page.goto(base + "/admin/pc/?view=overview")
                await page.get_by_text("平台可用余额", exact=False).first.wait_for()
                await page.screenshot(path=str(output / "admin-1440.png"), full_page=True)
                for width in (375, 430):
                    await page.set_viewport_size({"width": width, "height": 900})
                    await page.goto(base + "/agent/")
                    await expect(
                        page.get_by_role("button", name="申请提现", exact=True)
                    ).to_be_visible()
                    await page.evaluate("document.fonts.ready")
                    assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                    await page.screenshot(path=str(output / f"agent-{width}.png"), full_page=True)
                assert not errors, errors
                results["mobile_375_430_no_horizontal_overflow"] = True
                results["javascript_page_errors"] = errors
                await browser.close()
            (output / "ui-verification.json").write_text(
                json.dumps(results, ensure_ascii=False, indent=2) + "\n"
            )
            print(json.dumps(results, ensure_ascii=False))
        finally:
            server.terminate()
            try:
                await asyncio.to_thread(server.wait, 10)
            except subprocess.TimeoutExpired:
                server.kill()
                await asyncio.to_thread(server.wait)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", choices=["chrome", "chromium"], default="chromium")
    parser.add_argument(
        "--output", type=Path, default=ROOT / "docs/implementation/evidence/hardening-2026-10-29"
    )
    args = parser.parse_args()
    asyncio.run(run(args.browser, args.output))
