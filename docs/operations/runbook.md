# 运行、迁移与恢复手册

适用版本：Alembic `20261029_hardening`，2026-10-30 完成整改。业务仍为模块化单体，API、恢复任务和 Web 分别运行。

## 数据库迁移

从根目录运行，使用已配置的服务端 DATABASE_URL；命令不会打印密码。迁移用户需要 DDL、创建临时校验 schema 的权限。应用使用独立 schema，不与其他应用混放表。

```bash
python_backend/.venv/bin/python python_backend/tools/migrate.py upgrade
python_backend/.venv/bin/python python_backend/tools/migrate.py check
```

新空库执行完整基线及后续增量。旧库先创建备份并在副本演练，再执行：

```bash
python_backend/.venv/bin/python python_backend/tools/migrate.py adopt-prisma
python_backend/.venv/bin/python python_backend/tools/migrate.py upgrade
python_backend/.venv/bin/python python_backend/tools/migrate.py check
```

接管逐类核对列、类型、默认值、NULL、约束、索引、enum、函数和触发器。若存在 `_prisma_migrations`，还核对已完成历史和 SHA256。结构或历史不符时拒绝 stamp；不能通过删表、清空数据或手工 stamp head 绕过。接管只记录基线版本，不重放建表和期初入账。所有新增迁移只进入 `python_backend/migrations/`。

升级使用数据库事务及部署互斥锁，升级后再次验证完整结构；旧 SQL 文件的外层 BEGIN/COMMIT 由运行器移除，使事务由 Alembic 统一控制。财务迁移禁止破坏性 downgrade。失败后先确认事务回滚、版本和差异，再修复迁移或从演练过的备份恢复。

运行时默认 statement_timeout=60000ms、lock_timeout=5000ms、idle_in_transaction_session_timeout=60000ms。大库维护窗口可在迁移专用 DATABASE_URL 加 `statement_timeout=900000&lock_timeout=10000`；每项须为 1..3600000ms。不要为日常 API 永久关闭超时。

## 发布顺序

1. 在生产副本跑接管/升级、结构检查、财务对账并核对历史余额。
2. 构建固定依赖版本的 API、worker 与 Web，保留上一版可回退镜像。
3. 确认备份可恢复后运行迁移任务；失败时停止发布，不放行新版 API。
4. 启动 API，检查 `/health/ready`；它验证数据库和迁移版本。
5. 启动独立 worker，检查两个任务成功周期及待处理队列。
6. 启动 Web，验证管理员登录、代理票据兑换、资金查询和只读审计；再开放流量。

API 和 worker 必须使用相同数据库、JWT 配置和渠道参数。Next 与 API 使用同一 BFF_CONTEXT_SECRET。Web 两个 API 地址指向现行 Python 服务，WEB_ORIGIN 是浏览器实际 HTTPS origin。数据库、JWT、BFF、渠道签名分别使用独立随机秘密。

新库可使用根目录 compose.yaml：先由数据库负责人创建非超级用户运行账户并授予下述权限。填写 POSTGRES_PASSWORD、COMPOSE_DATABASE_URL（运行账户）、COMPOSE_MIGRATION_DATABASE_URL（迁移所有者账户，主机名 database，密码须 URL 编码）、JWT_SECRET、BFF_CONTEXT_SECRET、AGENT_REFERRAL_BASE_URL、WEB_ORIGIN。首次安装先 `docker compose build`、`docker compose up -d database`、`docker compose run --rm migrate`，再由数据库负责人创建并授权运行角色，最后 `docker compose up -d`。后续启动按数据库健康 → 迁移成功 → API 就绪 → Web 顺序运行。worker 独立运行。API/Web 仅绑定宿主机 127.0.0.1 的 3000/3001 端口；外层反向代理负责 HTTPS 和合法域名，小程序访问公开 API 域名。

运行账户不拥有表、不具备 CREATE/ALTER/TRIGGER 管理权限；迁移使用独立所有者账户。本地命令可设置 MIGRATION_DATABASE_URL，与 API 的 DATABASE_URL 分开。已有数据卷先按旧库流程接管，不能删除卷重建。容器定义用于复现服务边界；本轮验证不等于生产部署或镜像已发布。

运行账户权限示例（由数据库所有者执行；账户口令通过安全渠道设置，不放入 SQL 文件）：

```sql
GRANT USAGE ON SCHEMA public TO commission_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO commission_app;
GRANT INSERT, UPDATE ON users, orders, wallets, platform_wallets,
  payout_accounts, withdrawals, payment_inbox, worker_health,
  reconciliation_cases TO commission_app;
GRANT INSERT ON commission_logs, platform_commission_logs,
  wallet_movements, payment_events, refunds, withdrawal_actions TO commission_app;
GRANT INSERT, UPDATE, DELETE ON web_login_tickets, auth_rate_limits TO commission_app;
```

不要授予财务日志 UPDATE/DELETE。新增迁移后按新对象复核授权；schema 名与账户名按环境替换。使用其他平台已有受限运行角色时，保持同等边界。

## 资金处理规则

- 可信网关全额支付和全额退款；原生支付渠道验签由接入适配层负责，不接受浏览器“已支付”。
- 收到有效退款后建立持久化订单保护，并与相关钱包的付款认领串行化。待核对期间，相关代理和平台不能新建提现或开始付款；已开始的渠道操作必须核对真实结果再记录。
- 退款先到时，后到支付在同一事务中完成退款归并，不产生中间可用佣金。重复事件保持幂等。若缺钱包或数据不一致，证据保留在 inbox，修复后重试。
- 提现请求超时属于结果未知。Web/原生端保存原编号和原始内容，查询本人 `withdrawal-intents/{key}` 或原样重试；不能生成新编号“再试一次”。
- 银行账户更换创建待核验版本，核验通过后切换未来申请；旧提现继续引用旧账户。驳回不影响当前有效账户。平台不保存完整银行卡号，只使用付款保管服务的引用。
- 已知真实付款不会因为退款而被抹除；账上追偿继续展示并阻断新的付款。

## 恢复任务、对账与告警

```bash
cd python_backend
.venv/bin/python -m app.worker
.venv/bin/python tools/ops.py retry-payment-events --limit 100
.venv/bin/python tools/ops.py reconcile
```

恢复每 30 秒执行；对账独立每 5 分钟执行。对账验证业务分配、实际钱包变动及余额，历史 opening 有明确截止时间；订单与退款扫描分批处理，避免一次把全部订单加载到 Python。

老板资金中心的“系统运行与对账”提供 worker 最近成功时间、重试耗尽数量、差异及认领。认领互斥；认领不等于已修复，只有完整对账不再发现该差异才自动关闭。手工 reconcile 同样更新差异状态。

外部监控应消费服务日志并配置：恢复任务成功超过 90 秒未更新、对账超过 900 秒未更新、5 分钟以上待处理通知、重试耗尽、资金差异与 5xx/锁等待。告警目的地、值班责任和 RPO/RTO 由部署负责人登记。仓库不内置外部收件地址，也不会自动向其他人发送通知。

日志记录请求编号、异常类型和调用位置，不记录口令、JWT、SQL 参数或异常原文。客户/账户明细仅通过受保护的管理员接口查看。

## 备份与恢复演练

生产使用加密、异地、受限访问的 PostgreSQL 备份，并根据目标 RPO 配置 WAL/PITR；备份成功必须结合实际恢复验证。恢复先进入隔离环境，运行迁移 check、reconcile 和关键余额核对，再由发布流程切换流量。不能只根据备份文件存在就视为可恢复。

本仓库提供一次性演练，**只接受库名以 `_test` 结尾的 TEST_DATABASE_URL**。在该 PostgreSQL 容器内使用 pg_dump/pg_restore，恢复到另一个随机测试数据库，比较结构、迁移版本、订单和资金对账，结束后清理测试库。

```bash
TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55439/commission_test' \
  python_backend/.venv/bin/python python_backend/tools/check_restore.py \
  --docker-container commission-hardening-test --output /tmp/restore-proof.json
```

本地合成数据演练证明流程可用，不代表生产备份、生产权限或真实支付渠道已验收。

## 发布前验证

```bash
cd python_backend
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/commission_test' \
  .venv/bin/python -m pytest -q --require-database
```

此外检查生成的 TS/OpenAPI、设计 token、JS/原生生命周期、Web/展示构建、真实 BFF 链与浏览器故障回归。CI 配置了 Python 3.12/3.14；远程 CI 是否通过以实际运行结果为准。

性能基线：`tools/check_capacity.py --orders 200 --concurrency 8 --output /tmp/capacity.json`，需要相同 TEST_DATABASE_URL。记录合成结算 p95/吞吐、全量对账、网络查询与导出耗时。平台钱包仍是全网结算串行点，未达到压测证据前不盲目去锁、分库或拆资金微服务。

## 多端验收边界

Web 浏览器回归使用受控 API 故障；真实数据库/权限另测。静态展示使用虚构数据，不提交资金操作。两套小程序共享设计变量，但原生组件保留各自平台生命周期。微信登录、扫码首绑、太阳码、保存海报、web-view 与真实转账仍需持有效 AppID/商户配置在开发者工具和真机验收。
