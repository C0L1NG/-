# 第六轮复审整改

对应 [复审报告](../reviews/2026-10-30-sixth-architecture-review.md)，四项确认问题已修复。本轮没有新增数据库迁移或修改既有 API JSON 契约。

## 修改与验收

- **R6-01 连接生命周期**：写请求完成身份读取后释放连接，服务继续持有自己的资金事务。普通 GET 保留一致快照；流式导出释放身份查询连接，再由导出服务管理快照。新增池容量 1/2/5 的真实 HTTP 并发账户写入、提现、付款认领/确认、票据和导出回归。
- **R6-02 失败通知隔离**：超长渠道 reference 的通知保留 failed 证据和错误码，自动重试次数标记为耗尽；后续支付归并排除此类无效退款。合法退款→支付可正常到达退款终态，不产生中间佣金。人工核对仍可看到原通知；更正后的渠道事实使用新的 eventId，不允许修改原通知内容。
- **R6-03 保护有效状态**：结构清单增加用户触发器启用模式，以及索引 valid/ready。迁移接管、升级后校验、check 和恢复演练共用此清单；禁用账本触发器会产生 drift，重新启用后恢复一致。
- **R6-04 团队刷新**：后台刷新保留团队组件实例、详情与子分页；选中代理数据同步更新。接口失败时保留已有团队并展示错误。浏览器回归确认 focus 刷新后详情仍打开、二级团队仍在第 2 页，已加入 CI。

Python `tests/test_review6_regressions.py` 为正式数据库回归；浏览器工具为 `tools/check_network_refresh.py`。旧 `docs/reviews/probes/review6_*` 是复审时复现故障的历史脚本，修复后其故障断言不再成立，应使用正式回归验证新版。

## 验证

- 全套 Python：**133 passed，0 skipped**，真实隔离 PostgreSQL 16，强制数据库模式。
- JS / 原生生命周期：**37 passed，0 skipped**。
- Web 生产构建、TypeScript、Ruff、Prettier、契约生成同步和展示共享文件同步通过。
- 专项团队刷新：真实 Chrome、当前正式构建，详情与二级分页保持。
- 真实 BFF、完整浏览器状态回归与静态展示构建通过；[验收汇总](evidence/review6-fixes/verification-summary.json)、[登录链路](evidence/review6-fixes/bff-verification.json)、[页面回归](evidence/review6-fixes/ui-verification.json)、[团队刷新](evidence/review6-fixes/network-refresh-verification.json)。

额外修正 BFF 测试跨自然分钟的偶发误报：允许测试批次跨一个限流窗口，同时断言数据库对应来源的单窗口计数确实达到 21 后返回 429；生产限流规则没有改变。

提交前可复现：

```bash
cd python_backend
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/commission_test' \
  .venv/bin/python -m pytest -q --require-database
# 从仓库根目录，先构建 web 并安装 Playwright Chromium
python_backend/.venv/bin/python python_backend/tools/check_network_refresh.py
# 本机已安装 Chrome 时可设置 BROWSER_CHANNEL=chrome
```

这些修改仍在本地工作区，未提交、推送或部署生产。人员交接、生产规模容量测试、远程 CI 和真实微信/支付渠道验收仍按复审建议独立推进，不能视为本轮已完成。
