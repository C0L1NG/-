# 二级分销平台

模块化单体：FastAPI 处理身份、订单与资金；Next.js 提供正式网页和 Cookie BFF；两个原生微信工程分别服务代理和老板。公开展示使用虚构数据，不能提交真实资金操作。

## 工程边界

- `python_backend/`：现行后端，FastAPI + SQLAlchemy Async + PostgreSQL；业务写入集中在服务层，统计查询位于 `app/queries/`。
- `python_backend/migrations/`：唯一数据库迁移入口，由 Alembic 管理；保留完整 SQL 基线、CHECK、索引和追加账触发器，不使用 `create_all()` 替代迁移。
- `web/`：正式 Next.js 网页；`/admin/pc/`、`/admin/mobile/`、`/agent/` 隔离；`/login/` 签发 HttpOnly Cookie。后端再次检查角色和数据范围。
- `miniprogram/`：代理原生微信端，首页 / 进展 / 明细 / 我的，团队、海报和提现为子页面。
- `admin_miniprogram/`：老板原生微信端，大盘 / 团队 / 审计；通过单次登录码打开资金操作网页。
- `showcase-template/`：可还原的静态展示入口；`showcase-site/` 是本地生成与发布工程，共享组件来自 `web/`。
- `design/tokens.json`：Web 与两套小程序共用的主题变量来源，通过 Python 脚本生成 CSS/WXSS。
- 旧 Node API、Prisma 工具链已退出日常工程；旧金额结果保留为 Python fixture。历史实现可通过 Git `0a4342e` 查看。

升级范围、资金接入条件与发布顺序见 [升级记录](docs/implementation/2026-10-03-upgrade.md)。原问题见 [审查报告](docs/reviews/2026-10-03-project-review.md)。

## 本地启动

需要 PostgreSQL 16、Node.js 22、pnpm 11.25、Python 3.12（CI 同时覆盖 3.14）。

```bash
pnpm install --frozen-lockfile
python3.12 -m venv python_backend/.venv
python_backend/.venv/bin/python -m pip install -r python_backend/requirements-dev.txt
cp .env.example .env
cp python_backend/.env.example python_backend/.env
cp web/.env.example web/.env.local
# 填写相同的 DATABASE_URL、JWT 参数及 Next/Python 共用 BFF_CONTEXT_SECRET
# 以下用于新空库。旧库先按运行手册完成备份、结构核对和接管。
pnpm db:deploy
cd python_backend
.venv/bin/python tools/ops.py bootstrap-admin --username owner
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 3000
```

另一个终端从根目录运行 `pnpm --dir web dev`，打开 `http://localhost:3001/login/`。管理员密码由命令行安全输入，至少 12 字符。代理从微信授权登录后在“我的”生成 60 秒单次网页登录码。Web BFF 的两个 API 地址必须指向同一个现行 Python 服务；生产设置 `WEB_ORIGIN=https://你的前端域名`，供反向代理下严格同源校验。

资金恢复与对账单独运行：在 `python_backend/` 执行 `.venv/bin/python -m app.worker`。现有 Prisma 数据库先执行 `pnpm db:adopt`，核对通过后再 `pnpm db:deploy`；接管不重复建表或重复写入期初余额。流程见 [运行与迁移手册](docs/operations/runbook.md)。

`http://localhost:3000/docs` 提供接口文档。`/health/live` 检查进程，`/health/ready` 检查数据库及平台钱包迁移。JWT、微信密钥和支付签名密钥仅放服务端环境变量，不能写入小程序或 `NEXT_PUBLIC_*`。

## 分润与时间规则

利润 X 的 30% 分配给平台，剩余奖金池给代理。无上级时出单人独享奖金池；有直属上级时奖金池按 70% / 30% 分配，名义比例为利润的 49% / 21%。计算使用 Decimal，按分四舍五入，剩余分位归入奖金池或导师，保证金额守恒。

新订单在**创建时**固定直属上级和 `two_level_v1` 版本。之后绑定上级不改变旧订单受益人；禁止三级及换绑。已结算旧订单迁移时使用原流水恢复归属。

金额返回两位小数字符串，旧接口路径、方法和 camelCase 成功响应字段保留。报表统一 UTC、左闭右开周期：GMV 为期内支付金额减期内全额退款；收益为期内入账减期内冲正；今日预计为今日净入账加今日支付待结算分成。跨月退款可使当月净指标为负。代理新资金活动接口按发生时间列出负退款；月度审计导出包含跨月退款及当期净额。历史收益与平台钱包均为虚拟账面余额，不能等同银行账户余额。

## 资金入口

- 管理员创建订单：`POST /api/admin/orders`，订单号幂等，金额与归属不可变。
- 可信商户网关事件：`POST /api/payments/webhook`，HMAC 验签、时间戳校验、事件幂等、支付和分润同事务；当前支持全额支付 / 全额退款。
- 提现：代理 / 管理员 `POST /api/{agent|admin}/withdrawals`，先冻结余额；老板通过 `/api/admin/withdrawals/{id}/review` 开始处理、记录渠道成功或失败凭据。**本实现不会自动向银行或微信发起转账。**
- 退款按原始流水冲正；已付出的佣金形成非负待追偿余额，后续收益和解冻资金优先抵扣。
- 余额变化均记录不可修改的 `wallet_movements`；对账与结算恢复命令见后端指南。
- 已接收的有效退款先建立付款保护；退款先到、支付后到时，在同一事务内终结退款，不释放中间可提现佣金。有效待核对退款会阻断相关代理及平台新的提现/付款认领，已发生的渠道付款仍按真实结果记账。
- 提现响应未知时保留原编号、金额和账户，先查询或原样重试。不能通过换编号规避未知结果。收款账户按版本核验切换，历史提现保留原账户。

支付网关必须先完成所选支付通道的原生验签，再转发签名事件。此接口不是微信支付 v3 的直接回调地址。实际商户收款、退款发起、自动付款和银行卡保管服务需要按选定渠道接入；不可用浏览器传入的“支付成功”代替。

## 检查与展示工程

```bash
pnpm contract:generate
pnpm contract:check
pnpm typecheck
pnpm test
pnpm --dir web build
pnpm format:check
pnpm design:check
python_backend/.venv/bin/python -m ruff check python_backend scripts/configure-miniprogram.py scripts/generate-design-tokens.py
# 必须是可删除测试库，库名以 _test 结尾
cd python_backend
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/commission_test' .venv/bin/python -m pytest -q --require-database
```

集成测试创建临时 schema，运行真实 Alembic 迁移，结束后删除 schema。`--require-database` 在没有测试库或任何用例跳过时失败；快速单元检查可不加该参数。CI 还验证真实浏览器故障状态、Next → Python 鉴权链及测试库备份恢复。

浏览器回归：构建 `web` 后执行 `python_backend/.venv/bin/python -m playwright install chromium`，再运行 `python_backend/.venv/bin/python python_backend/tools/check_ui.py`。浏览器使用受控 API 响应验证页面状态；真实数据库与 BFF 另有集成检查。

```bash
pnpm showcase:prepare
pnpm showcase:check
pnpm --dir showcase-site install --ignore-workspace --frozen-lockfile
pnpm --dir showcase-site build
```

准备脚本能从根仓库还原展示工程，保留既有站点入口和托管身份。组件同步支持嵌套目录、资源及删除检查。构建输出是本地预览产物；发布是单独步骤。

## 微信工程配置

```bash
python3 scripts/configure-miniprogram.py \
  --agent-appid wx0123456789abcdef --admin-appid wxabcdef0123456789 \
  --api-url https://api.example.com --web-url https://console.example.com
```

示例 AppID 必须换为实际注册值。后端分别配置 `WECHAT_APP_*` 和 `ADMIN_WECHAT_APP_*`；在微信后台登记 request 合法域名和老板 web-view 业务域名。管理员微信登录仅允许预先关联的老板 open_id，不会自动注册管理员。代理扫码首绑与注册同事务，冷启动和热启动均等待绑定完成。

两套工程均需在微信开发者工具和真机验证登录、扫码、太阳码、保存海报、后台恢复与网页桥接。手机网页预览或 JavaScript 模拟测试不能替代微信真机验收。

## 本轮全面整改

资金通知排序保护、会话撤销、逐笔对账、提现结果恢复、收款账户版本、页面资源隔离、任务 URL、运行状态与差异认领已纳入代码和回归。Alembic 接管、容器部署、备份恢复、性能基线及多端主题生成说明见 [整改交付记录](docs/implementation/2026-10-30-system-hardening.md) 和 [运行手册](docs/operations/runbook.md)。下方早期记录描述当时版本；旧路径以对应 Git 版本为准。


## 第二轮审查整改

已新增支付通知持久化与退避恢复、退款风险下的提现阻断、经办人独占认领及审批历史、两端退出竞态保护、网关签名身份与数据库共享限流、读取快照、负数 CSV 及退款查询索引。老板资金中心提供表单审核和支付恢复入口。运行前配置 Next/Python 共用的 `BFF_CONTEXT_SECRET`，应用新增迁移并单独运行恢复 worker；详细说明见 [Python 运行指南](python_backend/README.md) 与 [第二轮整改记录](docs/implementation/2026-10-03-second-upgrade.md)。

## 第三轮审查与交易平台风格界面

改用中性黑白金融界面，桌面提供资金总览、代理网络、分账审计、资金管理四个工作区。修复后端异常时 Web 退出未清 Cookie、老板手机代理详情不可见、原生金额隐私未跨页同步和演示月度团队排名错误。当前网页预览与截图见 [实现说明](docs/implementation/2026-10-04-exchange-ui.md)，检查证据与剩余改进见 [第三轮审查](docs/reviews/2026-10-04-third-review.md)。本轮未修改分润比例或数据库结构，未更新公网展示站。
