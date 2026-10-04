# FastAPI 后端

使用 PostgreSQL + SQLAlchemy 2.0 Async / asyncpg + Pydantic v2。金额不使用二进制浮点数；SQL 约束和触发器由根目录 `prisma/migrations/` 管理。

## 目录职责

```text
main.py                        Uvicorn 入口、请求日志配置
app/config.py, db.py            环境变量、Prisma URL 适配、异步会话
app/models.py, schemas.py       数据库映射、Pydantic 响应模型
app/security.py                JWT、数据库角色/停用状态、会话版本、scrypt
app/routers/                   身份、代理、管理员、资金接口与请求校验
app/commission.py              不可变归属的事务分润
app/payments.py                可信商户事件验签、幂等支付、全额退款冲正
app/wallets.py                 行锁、原子余额操作、不可变余额变更流水
app/withdrawals.py             提现冻结、处理、确认及失败恢复
app/binding.py                 二级绑定及禁止换绑
app/queries/                   服务端统计、分页网络、UTC 净业绩
app/exports.py                 PostgreSQL 一致快照的流式 CSV
app/reconciliation.py          钱包/账本、分润守恒及旧退款检查
tools/ops.py                   管理员初始化、停用、重试、对账
tools/generate_*.py             TypeScript 与 OpenAPI 契约
constraints.txt                已验证依赖锁定版本
```

## 启动与升级

从仓库根目录：

```bash
python3 -m venv python_backend/.venv
python_backend/.venv/bin/python -m pip install -r python_backend/requirements-dev.txt
cp python_backend/.env.example python_backend/.env
# 设置 PostgreSQL、至少 32 字符随机 JWT_SECRET、issuer/audience、推广 HTTPS URL
pnpm install --frozen-lockfile
pnpm db:deploy
cd python_backend
.venv/bin/python tools/ops.py bootstrap-admin --username owner
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 3000
```

生产仅安装 `requirements.txt`，通过环境变量注入密钥。开发 HTTP 可设 `COOKIE_SECURE=false`；生产 HTTPS 保持 true。支持旧连接串 `schema`、`sslmode` / `ssl`、`connection_limit`、`pool_timeout` 和 `connect_timeout`，未知参数启动时拒绝。URL 默认 public search_path；不会连接测试以外数据库执行自动迁移。

Swagger 在 `/docs`；OpenAPI 在 `/openapi.json`。所有错误统一 JSON，参数验证保持旧 400 行为；响应带 `X-Request-ID` 和 no-store。日志仅包含关联 ID、方法、路径、状态、耗时、异常类型，不包含请求体、密码和令牌。身份入口有进程内限流，多实例部署还需可信反向代理的共享限流。

## 身份生命周期

- 管理员：`POST /api/auth/admin/login`，`{username,password}`；仅数据库管理员可登录。
- 代理：`POST /api/auth/wechat/login`，`{code,referralCode?}`；微信 code 换身份与首次绑定同事务。
- 老板微信：`POST /api/auth/wechat/admin-login`，`{code}`；独立 AppID，open_id 必须预先关联管理员。
- 单次网页登录码：代理 `/api/auth/web-ticket`，管理员 `/api/auth/admin/web-ticket`，返回 ticket；`/api/auth/web/exchange` 兑换 HttpOnly Cookie，60 秒有效且只可用一次，数据库仅存哈希。
- 令牌 2 小时有效，包含会话版本；每次请求检查当前角色、账号状态和版本。角色 audience 隔离，代理查询从 subject 派生 ID。
- 退出分别调用 `/api/agent/logout`、`/api/auth/admin/logout`，会撤销该账号所有已签发会话；密码修改、账号停用也撤销会话。小程序 401 会单次续登，密码方式的管理员回登录页重新输入密码。

运维命令（从 `python_backend/` 执行）：

```bash
.venv/bin/python tools/ops.py bootstrap-admin --username owner --wechat-open-id OWNER_OPEN_ID
.venv/bin/python tools/ops.py rotate-password --username owner
.venv/bin/python tools/ops.py account-status --user-id USER_UUID --active false
.venv/bin/python tools/ops.py cleanup-tickets
.venv/bin/python tools/ops.py retry-settlements --limit 100
.venv/bin/python tools/ops.py reconcile
```

密码安全输入。bootstrap 不覆盖已有账号。老板 open_id 来自老板小程序，不能用代理小程序的 open_id。恢复停用账号用 `--active true`。重试逐订单事务，失败非零退出，可安全重复执行；对账差异非零退出，应报警并人工核对。不要直接修改钱包或删除流水。

## 资金契约

完整请求参数见 [OpenAPI](../docs/api/openapi.generated.json)。原接口成功字段保留，新增资金接口提供严格 Pydantic 参数验证。

创建订单：`POST /api/admin/orders`，`{orderNo,customerId,promoterId,totalAmount,profitAmount}`，金额最多 18 位、2 位小数，利润不得超过订单额。订单号是业务幂等键；同号不同金额或受益人返回 409。数据库创建时锁定直接上级快照，金额与归属不可修改。

商户网关事件：`POST /api/payments/webhook`：

```json
{"provider":"merchant_gateway","eventId":"evt_001","orderId":"ORDER_UUID","type":"paid","transactionId":"channel_tx_001","amount":"200.00","currency":"CNY"}
```

HTTP 头 `X-Payment-Timestamp` 是 Unix 秒；`X-Payment-Signature` 是 `HMAC_SHA256(secret, timestamp + "." + 原始请求体字节)` 的十六进制值。服务器校验 5 分钟时效，`PAYMENT_WEBHOOK_SECRET` 至少 32 字符。网关须先核对支付通道原生签名、商户号、币种、订单与实付金额，再转发；外部网络重试需重新签署时间戳。同事件号业务内容不同返回 409；语义相同的 JSON 空白/金额尾零变化仍幂等。

验签后的通知先独立提交到不可修改内容的 `payment_inbox`，随后支付状态、分润日志、余额变化及处理事件记录在资金事务中提交。资金事务失败会保留通知及失败元数据，回调仍返回失败；网关重试与恢复 worker 均可重试，不依赖上游持续重发。管理员 `/api/admin/orders/{id}/settle` 和重试命令仅结算已经可信标记为 paid 的订单，不能用来模拟收款。

全额退款使用 `type=refunded`、原订单全额及独立退款交易号。按原流水冲正，保存独立退款记录；旧已经 refunded 但没有新退款记录的订单拒绝自动重处理并要求人工对账。当前不支持部分退款、向渠道发起退款或微信支付 v3 原生回调解密。

提现：`POST /api/{agent|admin}/withdrawals`，`{amount,accountId,idempotencyKey}`。同一键相同请求返回原单，不重复冻结；修改金额/账户要使用新业务键。只能使用本人已核验账户。微信账户关联登录 open_id；银行卡仅接收外部保管服务 `vault_` 标识，原卡号不入库。

老板可分页读取 `/api/admin/payout-accounts/pending` 并调用 `/{id}/verify` 记录核验凭据；提现付款账户通过 `/api/admin/withdrawals/{id}/payout-details` 读取。代理不能访问这些全局入口。

`POST /api/admin/withdrawals/{id}/review` 的 action：

- start：pending → processing，在钱包锁内检查退款欠款与冻结金额；由当前管理员独占认领，不解除冻结。其他管理员不能重复认领或确认。
- confirm：processing → paid，必须提供真实成功 `transferReference`，消耗冻结余额。
- reject：pending / processing → rejected，提供 `rejectionReason`；处理中另需 `failureReference`，解除冻结。渠道状态未知应保持 processing 并查询渠道，不能盲目解冻。

审核请求可携带 `expectedVersion` 阻止旧页面提交；认领、成功确认、驳回均写入不可修改的 `withdrawal_actions`。成功流水仍全局唯一；驳回原因与失败凭据分别保存，兼容旧客户端的 reject `transferReference`。同一经办人相同操作可幂等重试，内容不一致返回 409。退款发生在处理中时应先查渠道：已完成的付款照实记录，保留待追偿欠款，不能假装未付。

**当前付款在外部商户渠道执行，API 仅记录确认凭据。未实现自动银行/微信付款。** 渠道必须用提现单号作幂等商户业务单号。若佣金已经付出后退款，余额不为负：不足部分进入 debt_balance，未来收益/解冻先抵扣待追偿余额。

## 读取与报表

原 overview/referral/ledger/team/tree/agents/audit 路径保持；新增 `/api/agent/progress` 返回服务端月度净分成和全量团队贡献前四名，`/api/admin/team-network` 分页查询一级或指定 parentId 的二级节点。旧完整树仅用于兼容，正式 UI 不再下载全网树。

已验证 JWT 的代理/管理员 GET 在数据库身份读取前开启只读 REPEATABLE READ 事务，使同一个响应中的金额、计数与列表来自一致快照。统一 UTC 周期。成交净额按支付减退款事件统计，入账净收益按分成减冲正事件统计；同月退款净额抵消，跨月退款计入退款发生月份。今日预计＝今日净入账＋今日支付待结算佣金。团队规模是当前注册的直属代理人数，排行按当前团队成员的周期净平台贡献。旧 `/api/agent/ledger` 保留原始分配及 REVERSED；新增 `/api/agent/activity` 按入账/冲正发生时间返回正佣金与负退款（entryType=commission/refund），Web 与原生小程序已接入。不能把旧接口原分成重复求和当作净收益。老板月度审计包含当月退款的历史订单；CSV 保留原分配并新增当期净GMV、平台净收益和代理净佣金列。

`GET /api/admin/commission-export?period=all|month&q=...` 在只读 REPEATABLE READ 快照中流式读取，浏览器无需拼装全部页。包含原始分配、退款时间与状态，外部文本处理 CSV 公式前缀，经过 Decimal 验证的金额保留数值类型，包括负数退款。特别大的历史导出仍需后续后台任务化及压测。

## 验证

```bash
.venv/bin/python -m pytest -q
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/commission_test' .venv/bin/python -m pytest -q
.venv/bin/python -m ruff check . ../scripts/configure-miniprogram.py
.venv/bin/python -m ruff format --check . ../scripts/configure-miniprogram.py
.venv/bin/python tools/generate_ts_contracts.py --check
.venv/bin/python tools/generate_openapi.py --check
```

集成测试仅连接库名以 `_test` 结尾的测试库，逐测试隔离 schema 并应用真实迁移。没有测试 URL 时数据库用例跳过。对真实支付通道、微信真机、正式迁移和远程 CI 的验证需要部署环境，不能由本地模拟替代。


## 第二轮整改后的运行配置

新增迁移 `20261003010000_second_review_fixes` 添加通知收件箱、共享限流计数、提现认领/驳回字段和审批历史，以及实际退款查询的复合索引。先备份、在生产副本演练，再通过原 Prisma 迁移流程应用，不能用 `create_all` 代替。

Next 与 Python 必须设置相同的随机 `BFF_CONTEXT_SECRET`（至少 32 字符，不能使用 `NEXT_PUBLIC_` 前缀）。网页登录在未配置时返回 503。Next 为每个浏览器生成 HttpOnly `rate_client`，将请求路径、方法、原始请求体哈希、时间与该匿名标识签名后传给 Python；不采用浏览器的 `X-Forwarded-For`。Python 不接受没有有效签名的 BFF 身份。计数保存在 PostgreSQL，多进程共享；每个来源与登录路径每个自然分钟 20 次，管理员账户每分钟 100 次，后者防止轮换匿名标识绕过限制。直接小程序请求仍按网络来源限制；公网应另配置入口总量限制。计数不保存密码或明文用户名，窗口到期由 worker/清理命令移除。

在 API 服务之外，单独启动并由进程管理器监督恢复任务：

```bash
cd python_backend
.venv/bin/python -m app.worker
```

每 30 秒选择最多 100 条到期通知，失败按 30 秒至 1 小时退避，自动尝试最多 20 次。行锁与原订单幂等规则防止重复分账。超过次数或持续失败时，在老板资金中心的“支付恢复”页定位、修复原因后重试；该入口只能重新处理原验签通知，不能改支付金额或模拟收款。每 5 分钟运行业务对账和过期计数清理；延迟超过 5 分钟的通知、对账差异和任务周期失败写 ERROR 日志。部署方需将这些日志及 worker 存活状态接入现有告警系统。本仓库尚未连接外部通知服务。

手工批处理：

```bash
.venv/bin/python tools/ops.py retry-payment-events --limit 100
.venv/bin/python tools/ops.py reconcile
```

`GET /api/admin/payment-events` 支持分页查看恢复状态；`POST /api/admin/payment-events/{event_id}/retry` 支持管理员在修复后重试。`/health/ready` 检查本轮所需表/字段，缺少迁移时不应放行流量。钱包对账覆盖余额、业务增量规则、提现冻结/付款/释放状态、审批历史、订单归属与分配比例、退款记录和孤立引用；数据库账本对得上仍不能替代真实支付渠道对账。

真实网页网关及恢复进程的检查（先构建 `web`，Node 加入 PATH）：

```bash
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/commission_test' \
  .venv/bin/python tools/check_bff_integration.py
```

检查临时启动 Next 与 FastAPI，验证网关不同浏览器的限流隔离、HttpOnly 登录和恢复进程第一轮对账，然后停止服务并清理测试 schema。该步骤已加入 CI 配置，本地通过不代表远程 CI 已执行。
