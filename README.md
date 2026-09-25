# 二级分销平台

现行后端位于 [`python_backend/`](python_backend/README.md)，使用 FastAPI、SQLAlchemy 2.0 Async、asyncpg、Pydantic v2。沿用已有 PostgreSQL 表与 Prisma 迁移；原 TypeScript 实现保留在 `src/` 用于契约对照。`pnpm start` 现启动 Python 服务并保持 3000 端口，前端 BFF 无需改地址。

先运行 `python3 -m venv python_backend/.venv`，安装 `python_backend/requirements.txt`，配置 `python_backend/.env`，再从 `python_backend/` 执行 `.venv/bin/uvicorn main:app --port 3000`。完整目录、启动步骤和接口兼容口径见 [`python_backend/README.md`](python_backend/README.md)。

以下保留原始数据库迁移与 TypeScript 对照说明。

## 文件

- `prisma/schema.prisma`：Prisma 模型、枚举、关联与索引映射。
- `prisma.config.ts`：从 `DATABASE_URL` 读取 PostgreSQL 连接地址。
- `prisma/migrations/20260922000000_init/migration.sql`：建表、外键、索引、金额 CHECK 和代理层级触发器。
- `prisma/migrations/20260922010000_platform_commission_ledger/migration.sql`：平台收益流水表；每个订单最多一条。
- `src/processOrderCommission.ts`：事务结算入口 `processOrderCommission(orderId)`。
- `src/commissionMath.ts`：精确到分的分配算法。
- `src/agentPortal/routes.ts`：代理后台路由和参数 schema。
- `src/agentPortal/auth.ts`：JWT 验证与数据库代理角色校验。
- `src/agentPortal/controllers.ts`：概览、推广链接、分润流水查询。
- `.env.example`：连接串示例。

## 迁移说明

1. 安装 Node.js 20.19+ 和依赖：`pnpm install`（也可使用 `npm install`）。
2. 复制 `.env.example` 为 `.env`，填写目标 PostgreSQL 数据库的 `DATABASE_URL`。
3. 执行 `pnpm db:validate` 校验 Prisma schema。
4. 执行 `pnpm db:deploy` 应用尚未执行的迁移；执行 `pnpm db:generate` 生成 Prisma Client。
5. 执行 `pnpm typecheck` 和 `pnpm test` 校验代码及单元测试。

`referral_code` 的唯一约束本身就是查询索引；`parent_id` 有独立索引。代理必须填写推广码。管理员可以不填推广码，且不能设置上级。数据库触发器限制层级为根代理及其直接下级，禁止出现第三级，并要求钱包所有人、订单推广人和分润收款人都是代理。

金额使用 `DECIMAL(18,2)`，比例使用 `DECIMAL(7,6)`，其中 `rate = 0.1` 表示 10%。SQL 中的 CHECK 限制金额非负、利润金额不超过订单总额、比例在 0 到 1 之间。一个订单每种分润角色最多一条流水。`customer_id` 暂作为外部客户标识保存，因为当前需求没有定义客户表。

Prisma schema 无法表达初始迁移中的 CHECK 和触发器；后续改动应保留这些 SQL 约束。创建代理与钱包应在应用层事务中完成；支付状态由支付回调可信地更新为 `paid` 后才能开始分润。

## 支付后结算

支付成功并将订单 `payment_status` 更新为 `paid` 后，调用 `processOrderCommission(orderId)`。函数在同一个数据库事务内先对订单执行 `SELECT ... FOR UPDATE`，再读取并锁定出单代理的直接上级，原子递增收款钱包的 `balance` 与 `total_earned`，写入平台及代理流水，最后将订单标记为 `settled`。重复回调会返回 `already_settled`，不会再次入账；未支付、非待结算状态或缺少钱包时事务失败。

计算使用十进制数，不使用 JS 浮点数。平台取利润的 30%，奖金池为利润减平台金额；无上级时出单人获得全部奖金池，有直接上级时出单人取奖金池的 70%，直接上级获得剩余 30%。每次乘法按四舍五入保留两位，尾差归入奖金池的剩余收款人，确保平台与代理流水合计始终等于利润。流水 `rate` 存储相对利润的名义比例：平台 `0.30`，直推 `0.70`，两级 `0.49` 与 `0.21`；遇到分级尾差时，实际金额以分配结果为准。

单元测试覆盖两种场景、分位尾差、重复回调和未支付订单；真实数据库的并发锁与迁移执行仍需在目标 PostgreSQL 环境验证。

## 代理商独立后台 API

在 `.env` 中配置 `JWT_SECRET`（至少 32 字符的随机值）、`JWT_ISSUER`、`JWT_AUDIENCE`、`AGENT_REFERRAL_BASE_URL`，然后运行 `pnpm start:agent`。已有登录服务须签发 HS256 Bearer JWT，包含 `sub`（`users.id` UUID）、`iss`、`aud` 和 `exp`（Unix 秒）。所有 `/api/agent/*` 请求先验证 JWT 签名、有效期、签发方和受众，再查询 `users` 确认当前角色是 `AGENT`。未认证返回 401，非代理返回 403。代理 ID 只取自经过验证的 `sub`，不接受请求中传入其他代理 ID。

- `GET /api/agent/overview`：返回 `balance`、`totalEarned`、`directAgentCount`、`currentCommissionRatePercent`、`todayEstimatedEarnings`、`estimateDate`、`estimateTimeZone`。金额为两位小数的字符串。今日预计收益按 **UTC 当日创建且已支付、未结算** 的订单计算，包含本人出单所得和作为直接上级所得；现有订单表没有 `paid_at`，所以这不是“今日付款订单”的口径。
- `GET /api/agent/referral`：返回 `referralCode` 和完整 `referralUrl`；在配置的公开注册地址上添加 URL 编码后的 `ref` 参数。缺少推广码返回 409。
- `GET /api/agent/ledger?page=1&pageSize=20`：按结算时间倒序分页，只返回该代理为收款人的分润流水。`page` 为 1–10000 的整数，`pageSize` 为 1–100 的整数；其他查询参数或不合法参数返回 400。每条包含订单号、订单利润、分润角色、相对利润比例（`rate` / `ratePercent`）、实际入账金额、`settlementStatus` 与 `settledAt`。`settledAt` 来自同一结算事务写入的流水时间。

接口测试使用 Fastify 注入请求验证鉴权、数据隔离、分页和返回字段；上线前仍需用目标数据库运行迁移与真实查询验证。

## 管理端与代理端前端

`web/` 包含 Next.js、Tailwind CSS 和 Lucide React 前端。复制 `web/.env.example` 为 `web/.env.local`，填写 `ADMIN_API_BASE_URL` 与 `AGENT_API_BASE_URL`。运行 `pnpm --filter admin-dashboard-web dev` 后访问 `http://localhost:3001`。

- `/admin/pc/`：老板 PC 端，Wise Dark 资金中枢、可展开二级团队树、全网分润审计流，支持本月/全周期与搜索。`/` 保留为同一页面的兼容入口。
- `/admin/mobile/`：老板手机端大盘；`/admin/mobile/team/`：按一级代理筛选并展开二级团队；`/admin/mobile/audit/`：分页审计订单，展开 30%/49% 或 70%/21% 的实际入账。三页共用固定底部导航。
- `/agent/` 及其子路由：独立的代理商移动端，只读取代理本人授权范围的数据。

管理端手机页面是适配 375–430px 的 React H5，可在微信内置浏览器使用。若要作为原生微信小程序的 `web-view` 页面上线，还需在微信后台配置业务域名并接通管理员登录会话；当前仓库没有管理员小程序登录桥接。商户资金提现 API 尚未接入，按钮会明确提示；“对账导出”会分页读取管理员审计 API 并下载 CSV。

管理员登录服务需要设置 `admin_access_token` **HttpOnly、SameSite=Lax、Secure** Cookie。Next.js 的 `/api/admin/*` BFF 读取 Cookie 并转发 JWT，前端 JavaScript 不接触令牌。

`web/app/agent/` 提供独立的移动优先代理商 Web 入口，使用 `agent_access_token` 读取本人范围的 API。四个代理页面位于 `web/components/agent-*.tsx`，适配 375–430px 手机视口。`POST /api/agent/logout` 可清除代理会话 Cookie。
# 公开演示

`showcase-site/` 是无需登录的老板 PC、老板手机三页和代理商四页静态演示，所有代理、订单与金额均为虚构数据。生产 `web/` 仍须按角色鉴权。

## 双端架构

- `web/`：老板总控 Web。浏览器只保存 HttpOnly `admin_access_token`，Next.js BFF 转发 `/api/admin/*`。
- `miniprogram/`：原生微信小程序代理端。通过 `wx.login` 换取 audience 为代理端的 JWT。
- `src/adminPortal/`：只允许数据库当前角色为 `ADMIN`，提供全局资金、二级团队树、代理透视及全网分润审计。
- `src/agentPortal/`：只允许数据库当前角色为 `AGENT`，所有钱包、团队、推广码和流水查询都从 JWT subject 派生代理 ID。

管理员与代理商 JWT 使用不同 audience（`ADMIN_JWT_AUDIENCE` / `JWT_AUDIENCE`）。角色声明不从客户端或 JWT 读取，每次请求都回查 `users.role`。

## API

### 管理员

- `GET /api/admin/overview?period=all|month|previous_month|day`（时间段按 UTC 订单创建时间过滤；`day` 额外返回今日不同出单代理数）
- `GET /api/admin/team-tree?period=all|month`（钱包余额和历史收益始终是全周期；成交与平台贡献按选定周期汇总）
- `GET /api/admin/agents/:agentId`
- `GET /api/admin/commission-audit?page=1&pageSize=20&period=month|all&q=关键词`（按订单号或出单人搜索）

### 微信代理端

- `POST /api/auth/wechat/login`，请求体 `{ "code": "wx.login code" }`
- `GET /api/agent/overview`
- `GET /api/agent/referral`
- `GET /api/agent/mini-program-code`
- `POST /api/agent/bind-parent`，请求体 `{ "referralCode": "..." }`
- `GET /api/agent/team`
- `GET /api/agent/ledger?from=2026-09-01&to=2026-10-01`

扫码场景值为 `r=<referralCode>`。小程序登录成功后调用绑定接口；后端在一个事务中按稳定顺序锁定邀请人与被邀请人，只允许未绑定且没有下级的代理绑定到一级代理。数据库触发器同时禁止第三层和后续换绑。

## 微信小程序配置

1. 在 `miniprogram/config.js` 设置后端 HTTPS 域名，并在微信公众平台加入 request 合法域名。
2. 将 `miniprogram/project.config.json` 的 `appid` 替换为真实小程序 AppID。
3. 服务端配置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`。
4. 在微信开发者工具中导入 `miniprogram/`。推广页会请求无限小程序码、生成 Canvas 分享海报并保存到相册。

微信首页在 `miniprogram/pages/home/`，采用暖灰绿底色、悬浮白色余额卡、果绿提现按钮、双列业绩卡和卡片式分润流；推广页的分享海报也采用同一配色。直属人数、余额、今日预计和活动流读取代理本人 API；本月分成按 UTC 月份分页汇总流水的分位整数。提现申请 API 尚未定义，首页按钮目前只展示明确的未接入提示。
