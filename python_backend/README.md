# FastAPI 后端（现行实现）

此目录直接使用已有 PostgreSQL 表，不运行 `Base.metadata.create_all()`，也不重建 Prisma 迁移。SQLAlchemy 映射包含 `users`、`orders`、`wallets`、`commission_logs` 和已有的 `platform_commission_logs`；数据库的 CHECK、触发器、外键和唯一索引仍以 `prisma/migrations/` 中已经部署的 SQL 为准。

## 目录

```text
python_backend/
├── main.py                 # Uvicorn ASGI 入口
├── requirements.txt        # 运行依赖
├── requirements-dev.txt    # pytest 依赖
├── app/
│   ├── config.py           # 与旧服务相同的环境变量
│   ├── db.py               # asyncpg 引擎、每请求 AsyncSession
│   ├── models.py           # 现有五张表及 PG 枚举的 1:1 映射
│   ├── schemas.py          # Pydantic v2 的原 JSON 响应契约
│   ├── periods.py          # UTC 报表周期
│   ├── presentation.py     # 跨端响应格式化
│   ├── queries/            # 管理员层级树读取模型
│   ├── security.py         # Bearer/Cookie JWT、数据库当前角色校验
│   ├── validation.py       # 额外查询参数与 400 兼容校验
│   ├── commission.py       # 精确到分的计算和单事务分润
│   ├── binding.py          # 扫码绑定直属上级
│   ├── wechat.py           # 微信 code2session / 小程序码
│   ├── factory.py          # FastAPI 装配及 400 校验兼容
│   └── routers/
│       ├── agent.py        # 代理端及微信登录路由
│       └── admin.py        # 老板端路由
└── tests/                  # pytest 异步单元及契约测试
```

## 快速启动

从仓库根目录运行：

```bash
python3 -m venv python_backend/.venv
python_backend/.venv/bin/python -m pip install -r python_backend/requirements.txt
cp python_backend/.env.example python_backend/.env
# 编辑 python_backend/.env，配置已有 PostgreSQL 和 JWT/微信参数
cd python_backend
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 3000
```

Swagger：`http://127.0.0.1:3000/docs`；OpenAPI JSON：`http://127.0.0.1:3000/openapi.json`。`pnpm start` 也会启动此 Python 服务。现有 `web/.env.example` 已指向 3000 端口，Next.js BFF 无需修改。原 TypeScript 服务仍可用 `pnpm start:legacy` 对照验证。

运行测试：

```bash
cd python_backend
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

真实 PostgreSQL 结算测试需要独立测试数据库（库名以 `_test` 结尾）。设置 `TEST_DATABASE_URL` 后，测试会在该库创建临时 schema，应用现有 Prisma SQL 迁移，并发调用两次分润函数，核对只入账一次；结束后删除临时 schema。未设置该变量时仅跳过这两项集成测试。GitHub Actions 会提供测试数据库并运行它们。

## 兼容口径

- 保留原后端全部 11 个 API 的路径及 HTTP 方法，包括微信登录、绑定上级、小程序码、代理团队与流水、管理员总览、树、代理详情和审计；同时实现 Next.js 原有的 `POST /api/agent/logout` Cookie 清除响应。
- 成功响应沿用原 camelCase 字段，金额始终是两位小数字符串；数据库字段仍是 snake_case。角色、支付、结算和分润枚举的数据库值是小写，响应值保持原来的大写。
- JWT 仍为 HS256，需原 `iss`、`aud`、`exp` 与 UUID `sub`。同时接受原 Bearer 头和 Next.js 的 `agent_access_token` / `admin_access_token` Cookie，权限每次回查 `users.role`。
- `process_order_commission()` 使用 `SELECT ... FOR UPDATE` 锁订单、`FOR SHARE` 锁出单代理；钱包用 SQL 原子加法。平台流水、两级代理流水和订单状态在同一事务提交。重复回调返回 `already_settled`。
- UTC 的今日、本月及前一月口径与旧服务一致。`/api/admin/overview?period=day` 仍额外返回 `activePromoterCount`，其他周期不输出此字段。

正式切换前，先在测试 PostgreSQL 上应用原 Prisma 迁移并进行并发支付回调与真实查询验证；当前单元测试不会自动连接生产库。
