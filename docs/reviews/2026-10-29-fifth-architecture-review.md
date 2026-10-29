# 全仓架构复审与 Python 收敛方案

审查日期：2026-10-29。基线：`0a4342e` 加当前工作区的 OKX / Wise UI 改动。本轮仅新增审查报告、只读探针与证据，没有修改业务实现、迁移数据库或发布网站。

## 结论

项目已形成可维护的雏形：Python 负责真实业务，Next 负责页面与浏览器会话代理，原生小程序直接调用 Python，PostgreSQL 承担资金约束。**同仓不是主要问题；尚未收口的业务边界、双份数据库描述、多端状态处理和验收缺口才是。**

目前不建议直接上线真实自动付款，也不建议整仓重写或拆微服务。先修复已确认的退款乱序、会话撤销竞态与对账缺口；再处理提现结果未知、刷新与错误隔离；最后统一迁移工具和退役代码。

Python 业务后端已经存在。最值得继续迁移的是 **Prisma 迁移管理及旧 Node 后端的剩余依赖链**，而不是 React 页面。语言占比不是架构质量指标。

## 本轮证据与范围

复核范围覆盖 Python 认证、绑定、订单、分润、支付/退款、钱包、提现、对账、worker、查询/导出；SQLAlchemy 模型与 SQL 迁移；Next BFF 与页面数据状态；两套原生小程序入口和关键资金流程；展示同步、依赖及 CI。第三方依赖源码、生成目录与每个纯展示模板不作逐行安全背书。

本轮重新执行：

- Python：**41 通过、38 跳过**。未设置可用的隔离 PostgreSQL 测试库；本机 Docker 服务不可用，尝试启动也未成功。因此没有重跑数据库并发、资金生命周期、迁移升级及真实 BFF → Python → PostgreSQL 集成。
- JS/TS：**47 通过**，包含旧逻辑对照、前端工具与原生小程序测试。
- Web 生产构建成功；构建结束后独立 TypeScript 检查通过。
- Ruff 检查和格式检查通过（51 文件）；Prettier 通过。
- Pydantic → TS 契约及 OpenAPI 同步检查通过；展示同步检查通过（45 个共享文件）。
- 当前原生提现页的分页乱序探针重新复现；新增提现结果未知探针复现了变更请求内容仍复用原 key 的冲突。两个探针均使用模拟响应，没有真实资金操作。
- 静态比较 SQL 中命名 `CREATE INDEX` 与 SQLAlchemy metadata，发现 **10 个 SQL 索引未在 ORM metadata 声明**。这是元数据差异，不是断言已迁移数据库缺少这些索引。

第四轮曾在真实隔离 PostgreSQL 中复现的两项 P1 和对账缺口，本轮检查相关后端文件未发生变化，代码路径仍成立；以下明确标为“历史动态证据 + 当前代码复核”，不冒充本轮重新运行。此前的 79 项数据库全量通过不计入本轮测试结果。

未完成：真实微信/支付渠道验收、生产压力与故障演练、备份恢复、外部依赖漏洞扫描、完整渗透测试。本轮未重新做全页面截图及无障碍审计；UI 判断基于当前实现与上一轮截图，不声称全部视觉状态已验收。

## 需要优先修复的问题

### F1 · P1：已知退款尚未阻断后到支付释放佣金

证据级别：历史 PostgreSQL 动态复现 + 当前代码复核。

位置：[payments.py](../../python_backend/app/payments.py#L159)、[withdrawals.py](../../python_backend/app/withdrawals.py#L106)。

退款先于支付到达时，退款通知被保存在 failed inbox，因订单未支付而推迟重试。后来的 paid 在订单锁内只检查订单现状，不检查已接收的待处理退款，仍可正常入账。历史探针中 100 元利润释放 70 元代理佣金，随后模拟提现完成，退款恢复后留下 70 元追偿余额。

修改：在订单事务边界统一处理可信支付/退款事实。后到支付必须识别相关有效退款或待核对状态；尚未完成核对的收益不得直接成为可付款金额。保留付款真实结果的记账能力，不能因后续退款把已经发生的渠道付款“回滚掉”。不能仅缩短重试间隔。

验收：refund→paid、并发到达、重复回调、worker 停机/恢复、付款处理中退款；既不释放已知应退收益，也不误删真实付款事实。

历史证据：[review4-finance.json](evidence/review4-finance.json)。

### F2 · P1：退出与创建 Web 登录票据并发，旧请求可能升级为新会话

证据级别：历史 PostgreSQL 动态复现 + 当前代码复核。

位置：[auth.py:73](../../python_backend/app/routers/auth.py#L73)、[security.py](../../python_backend/app/security.py)。

鉴权仅返回 user_id。旧请求先通过鉴权，logout 增加 token_version 后，create_ticket 又读取用户最新版本写入票据，使旧请求获得可兑换的新身份。代理和管理员历史探针均能复现。

修改：依赖返回不可变身份上下文（用户、角色、获准的 token_version）；创建票据在用户行锁内核对这个原始版本，不能自动继承最新版本。退出、创建、兑换采用明确的串行化语义。

验收：两个角色分别覆盖“鉴权→退出→创建”和“创建→退出→兑换”；均不能恢复已退出会话，正常票据仍只消费一次。

历史证据：[review4-session-race.json](evidence/review4-session-race.json)。

### F3 · P2：对账未贯通“分润日志 → 实际钱包入账”

证据级别：历史故障注入 + 当前代码复核。

位置：[reconciliation.py:274](../../python_backend/app/reconciliation.py#L274)。

当前检查金额守恒、收款角色、钱包与 movements 的自洽，但没有逐笔双向匹配 commission movements 与 commission logs。历史探针给无关代理追加 10 元 commission 后，钱包与 movements 自洽，业务日志仍正确，对账却返回零差异。这是内部服务故障注入，未证明普通用户能通过公开 API 增发余额。

修改：按订单、账户、业务类型构建预期与实际集合，检查多记、漏记、错人、错金额；旧 opening 汇总账单独设迁移边界。结果应能定位订单与账户，并进入可认领的差异工单。

验收：上述四类注入均报出准确差异，正常数据为零差异。

### F4 · P2：刷新与错误边界仍破坏页面的可信度

证据级别：当前组件分支与依赖关系检查；本轮未做浏览器接口故障注入。

- [agent-context.tsx:98](../../web/components/agent-context.tsx#L98) 将 overview/referral 放入同一个 Promise.all，任一失败都会在第 174 行替换所有子页面为登录入口。推广接口故障不应遮挡流水、团队或提现。
- [admin-mobile-context.tsx](../../web/components/admin-mobile-context.tsx) 对 overview 故障只有部分页面例外，资金页仍受影响。
- [agent-ledger.tsx:136](../../web/components/agent-ledger.tsx#L136)、[admin-mobile-audit.tsx:52](../../web/components/admin-mobile-audit.tsx#L52) 在 revision 更新时重置页码和详情；[live-refresh.tsx:21](../../web/components/live-refresh.tsx#L21) 每分钟更新，读到一半会被打断。
- [admin-dashboard.tsx:555](../../web/components/admin-dashboard.tsx#L555) 未把顶部刷新版本传给 AdminTreasury；其审核列表依赖自己的 revision。顶部时间变化不代表提现列表已更新。

修改：身份状态与业务资源分开；401/403 与网络错误分开；按 wallet/overview/referral/withdrawals 等资源管理请求、旧数据和刷新。后台更新保留分页、选中订单及焦点；顶部刷新必须覆盖当前可见资源，失败时不能显示全部已更新。

验收：第 2 页展开详情停留超过 60 秒；分别注入推广、余额、概览接口失败；另一会话新增提现后点击刷新。位置、错误范围和更新时间均应准确。

### F5 · P2：原生提现页被旧分页响应覆盖

证据级别：本轮重新运行实际页面脚本，模拟请求倒序返回。

位置：[miniprogram/pages/withdrawals/index.js:20](../../miniprogram/pages/withdrawals/index.js#L20)。页码为 2，最终却显示第 1 页记录及旧钱包余额。

修改：使用递增请求序号和请求时的页码快照，只接收最新结果；隐藏/卸载后忽略响应。钱包刷新与列表分页分开管理。

证据：[review5-native-withdrawal-race.json](evidence/review5-native-withdrawal-race.json)。验收同时覆盖 onShow、快速翻页与卸载。

### F6 · P2：提现“结果未知”没有独立恢复流程

证据级别：本轮新增模拟响应探针；Web 同类实现经代码核查。

位置：[原生提现页:62](../../miniprogram/pages/withdrawals/index.js#L62)、[withdrawal-panel.tsx:37](../../web/components/withdrawal-panel.tsx#L37)。

第一次请求若已被服务端接收但响应丢失，页面将其显示为一般失败。用户修改金额后重试，仍使用旧 idempotencyKey，服务端正确拒绝为 IDEMPOTENCY_CONFLICT；页面无法恢复原操作上下文。原生探针确认“已接收 100 → 编辑为 200 → 复用相同 key → 冲突”。Web 也是仅在成功后更新 key。刷新页面又丢失旧 key，无法可靠判断上次是否成功。

修改：把一次申请视为固定的提交意图，保存 key 和原始金额/账户；超时后进入“正在确认结果”，可查询原 key 对应结果或原样重试。确认结果后才允许开始新的申请。新增查询接口时仍限定当前用户。

**不能在每次错误后直接生成新 key**，这会使同一意图在余额充足时成为两笔合法申请。验收覆盖断网、响应丢失、刷新恢复、编辑金额/账户以及重复提交。

证据：[探针](probes/review5_withdrawal_unknown_result.cjs)、[结果](evidence/review5-withdrawal-unknown-result.json)。模拟服务不替代真实数据库集成验收。

### F7 · P2：收款账户“需要审核更换”缺少实际更换流程

证据级别：当前路由与唯一约束检查；属于产品流程缺口。

位置：[finance.py:174](../../python_backend/app/routers/finance.py#L174)、[schema.prisma:222](../../prisma/schema.prisma#L222)。

代码要求新账户另行验证，但 `(user_id, provider)` 唯一限制用户每个渠道只有一条记录；换 vaultReference 返回 PAYOUT_ACCOUNT_CHANGE_REQUIRES_REVIEW。当前 verify 路由只能核验已有记录，并不能新建版本或替换账户。

修改：采用账户版本/启停状态和变更申请，审核通过后切换未来提现的默认账户；历史提现继续指向旧账户。不要原地改写已经被提款引用的账户信息。验收包含有 processing 提现时换卡、驳回、旧记录可追溯。

### F8 · P2 加固项：BFF 在限制大小前已完整读取请求体

证据级别：代码路径；未进行内存压力攻击测试，真实影响取决于入口限额。

位置：[auth-proxy.ts:55](../../web/lib/auth-proxy.ts#L55)。`request.text()` 完整缓冲后才判断 `body.length > 8192`，该判断还是字符串长度，不是 UTF-8 字节数。Python 登录层已有流式字节上限，但它保护不了先读取数据的 Next 进程。

修改：入口网关设置字节上限；BFF 流式计数并在超过上限时取消读取，Content-Length 只能作提前拒绝提示。确保中文、多字节、chunked 请求采用同一限额。此项不是已证明的授权绕过。

## 架构方面需要优化的地方

### A1 · Python 模型与数据库迁移还不是完整的一对一结构描述

当前 SQL 迁移是权威来源，SQLAlchemy 用于运行时映射，这个边界本身成立。但不能把现有 models.py 当成可直接重建全部数据库的模型。

本轮静态确认缺少 10 个命名索引，包括 orders 的 paid_at/settled_at、wallet movements 的账户/用户时间索引、withdrawals 状态时间索引、ticket 过期索引、payment inbox 重试部分索引等。平台钱包非负 CHECK、部分状态 CHECK 和数据库触发器也没有完整反映在 ORM metadata。

这些索引和约束在 SQL 迁移中存在，因此不是“当前数据库没有约束”。风险在于将来直接执行 create_all 或以不完整 metadata 自动生成迁移，可能漏建或提出删除已有索引。现有模型测试只验证部分列、类型与名称集合，不足以证明全库结构一致。

建议先建立真实迁移后数据库的结构清单与差异测试：列、精度、默认值、NULL、外键策略、唯一约束、普通/部分索引、CHECK、enum、函数和触发器。证据：[元数据差异清单](evidence/review5-metadata-index-gaps.json)。

### A2 · 保留模块化单体，按业务域收拢职责

`finance.py` 同时处理建单、支付通知、收款账户、提现、健康检查及运营查询；`agent.py` 也兼有身份接入与展示查询。后续新增功能会让业务事务、HTTP 序列化和读模型继续耦合。

建议目标结构如下，不要求一次性移动全部文件：

```text
python_backend/
  app/
    api/                 # 路由、请求校验、响应契约
    auth/                # 身份上下文、票据、撤销、微信登录
    domains/
      orders/            # 订单状态、归属快照
      commissions/       # 精确分配与结算
      payments/          # 可信通知、状态归并、退款
      treasury/          # 钱包、提现、收款账户
    queries/             # 看板、网络、流水读模型
    infrastructure/      # DB、微信和支付渠道适配器
    jobs/                # 恢复、对账、导出、清理
  migrations/            # 将来唯一的 Alembic 迁移链
  tests/
web/                     # React + 薄 BFF
miniprogram/             # 代理原生端
admin_miniprogram/       # 老板原生端
contracts/               # 自动生成契约，不手写第二份金额规则
```

依赖方向应为路由调用业务服务，业务服务控制事务，渠道适配器处理外部通信；业务模块不依赖 FastAPI Request。资金服务和对账不要拆成各自维护一份余额的微服务。新增接口可保持路径、大小写、金额字符串和错误码兼容。

### A3 · 旧后端退役不彻底，仍增加依赖和认知成本

`start` 已指向 Python，`start:legacy` 已明确拒绝运行，这点正确。但根 package.json 仍有 Fastify、Prisma Client/adapter、pg、decimal.js；根 typecheck/test 仍包含 `src/` 旧实现，`src/server.ts` 仍是可直接执行的旧启动文件。

建议把有价值的旧对照测试沉淀为跨语言无关的输入/输出 fixture，保留必要历史 tag 后移除日常源码中的旧服务器与依赖。迁移脚本尚用 Prisma 时先保留其 CLI；不得为减少 TS 比例直接删掉 Prisma 导致数据库无法升级。旧 server 直接入口也应有退役保护。

### A4 · 后台恢复与对账没有运维闭环

位置：[worker.py:35](../../python_backend/app/worker.py#L35)、[factory.py:107](../../python_backend/app/factory.py#L107)、[finance.py:455](../../python_backend/app/routers/finance.py#L455)。

worker 会重试、记录失败数量和对账差异数量，但没有持久化差异的处理状态、认领/解决记录或心跳；异常通常只记录类型，定位原因困难。ready 证明部分数据库对象可读，不证明 worker 存活、完整迁移版本或支付渠道就绪。

建议分别提供 API 存活、数据库迁移就绪、worker 最近成功周期、最老待处理通知年龄、重试耗尽数量和对账差异详情。日志保留 request_id 与脱敏堆栈，接入部署环境告警；API readiness 与全业务健康不要混成一个开关。

仓库未提供可复现的备份恢复演练、发布前迁移检查及失败回退流程；不能据此断言外部生产设施不存在。补齐运行手册并演练恢复，验收恢复后账务守恒，而不只是服务能启动。真实支付网关适配、付款回执核验仍是交付边界，手工填写 reference 不能当作已接入真实渠道的证明。

### A5 · 扩容前先测三个明确瓶颈

- 每笔分润都会锁同一个平台钱包行（commission.py:108），不同代理订单也会在此串行。现阶段优先保持正确性，先测锁等待与吞吐；不能简单去锁，也不能期待拆服务自动解决。
- 对账每五分钟汇总全量 movements，并 `.all()` 读取全部钱包、已结算订单和退款。数据增加后可能挤占恢复任务的执行时间。应分离重试与审计调度，近期增量检查配合周期全量审计，历史扫描采用受控批次/快照；不能只检查近期而遗漏历史差异。
- 兼容 `/team-tree` 仍一次加载全树；当前主 UI 已使用分页 `/team-network`，应继续保持。CSV 已流式输出，但全周期导出会长时间持有数据库快照和连接；大任务可改为后台导出、限并发与过期下载，保持旧小任务接口兼容。

这些是代码可见的增长风险，没有本轮压力数据，不声称已达到性能上限。先用接近业务规模的数据记录 p95、锁等待、连接池等待、内存和导出时长，再决定索引、汇总表或队列方案。

### A6 · 测试要覆盖异常顺序，而不仅是正常结果

保留 Decimal、事务回滚、权限、契约、迁移升级等已有测试。本轮新探针也说明：测试通过不代表请求顺序已覆盖。

优先把 F1/F2/F3/F5/F6 的探针转为正式回归，数据库并发必须跑真实 PostgreSQL；前端添加真实渲染下的自动刷新、失败隔离、请求取消与焦点保持测试，展示版截图不能替代它们。发布门禁应要求数据库套件零跳过，开发快速检查可以允许明确标注跳过。

CI 使用 Python 3.12，而本地 venv 当前为 3.14；选定并固定支持版本，或明确测试矩阵。已有 constraints.txt 已锁版本，不应误报为完全没有锁依赖。若采用 uv，则把运行与开发依赖迁入 pyproject/uv.lock 并统一 CI，不必叠加第三套依赖清单。

CI 两个 job 都构建 web，可在保留隔离性与依赖顺序的前提下共享构建产物或重新分组。优先级低于补齐资金回归。

### A7 · UI 需要统一组件和行为，而不是继续叠加风格补丁

本次现有 UI 已改善可用余额优先级、侧栏、待办和字体交付；第四轮“字体只声明未加载”的问题已被新增本地字体资产解决，不应继续当作未修问题。

仍需处理：

- Web 和两套原生小程序各自维护色值、圆角、按钮及加载状态。当前 Web 的 Wise 绿色操作、字体与间距更新未同步到原生布局；H5 好看不能代表微信原生已完成。
- globals.css 的 `.console-queue > div:nth-child(2)` 等选择器依赖组件内部 DOM 顺序；Agent 深浅主题与组件硬编码样式并存。改为明确的组件 variant/slot 与语义 token，避免插入一层容器就破坏样式。
- Admin PC 工作区仅存在 React state，刷新/分享不能保留位置。把工作区、筛选和选中订单写入可校验的 URL，权限仍由后端决定。
- admin-treasury 与 payment-recovery 的错误提示仍使用 `--positive`。统一 success/error/warning/neutral，结果未知独立展示。
- UI 高级感的下一步应是稳定状态：不跳页、不闪白、不把超时当退出，退款与收益符号一致，金额大时不破版，键盘/触控焦点可见。继续只换配色无法解决这些问题。

建议将共享设计 token 从单一文件生成 CSS 变量与 WXSS；各端保留适合平台的组件，不强行共享 React DOM。375/430/1280/1440 视口、深浅主题、金额隐藏、空/错/旧数据状态均纳入验收。

## 哪些可以用 Python 替换

### 已经是 Python，不需要再写一遍

分润、支付/退款、钱包、提现、推广绑定、JWT/微信认证、代理与老板 API、读模型、CSV 导出、对账与恢复任务均已由 `python_backend` 实现。优先修复和整理这些模块。

### 最值得迁移：Prisma CLI → Alembic

收益是 Python 后端不再为数据库部署依赖 Node/Prisma，并统一模型与迁移的维护责任。SQL 约束和触发器仍留在 PostgreSQL，Alembic 是执行和版本管理工具，不是用 Python 校验取代数据库约束。

安全顺序：

1. 固化现有迁移清单，补齐/声明 metadata 差异，记录特殊触发器、enum、CHECK、部分索引与期初账。
2. 为全新数据库建立完整基线迁移，保留必要的显式 SQL；不能仅调用当前 create_all。
3. 已有数据库先验证已应用的 Prisma 迁移与结构，再标记对应 Alembic 基线；不重复建表、重复期初入账，不能无条件 stamp head。
4. 比较“旧迁移建库”和“新基线建库”，再测试带历史订单/钱包数据的升级。验证约束、归属快照、资金守恒及 API 契约。
5. 切换 db:deploy、测试建库、运维文档和 CI 后，只保留一个新增迁移入口；最后移除 Prisma CLI/Client 与相关生成链。

Alembic 自动生成的是需要人工核查的候选迁移，尤其本项目存在模型未描述的对象。参考：[Alembic 官方自动迁移说明](https://alembic.sqlalchemy.org/en/latest/autogenerate.html)。

### 值得收尾：旧 Node API 与对照测试

把尚有价值的输入/输出断言迁至 pytest 或共享 JSON fixture，删除旧运行入口和不再使用的 Fastify/pg/Prisma Client 等依赖。不是把已退役的 TS 业务再重复翻译一次。

### 可选：Next BFF → FastAPI 同源 Cookie 接口

技术上可行，但当前 BFF 不只是转发：它承担 HttpOnly Cookie、同源校验、身份转交、登录限流上下文、退出降级及导出流式代理。

推荐近期保留薄 BFF，资金逻辑不进入它。若目标明确是减少一个运行服务，可在同源反向代理下由 FastAPI 承担浏览器会话，再评估 Next 静态输出是否满足现有动态页需要。必须保留同等 CSRF/Origin、Cookie Secure/SameSite、角色隔离、撤销、错误码和导出行为，并逐条跑 BFF 集成。不能直接删除 `web/app/api` 后只修改一个地址。

### 可以但收益较低：构建/同步脚本

prepare-showcase、sync-showcase 的文件操作可用 pathlib/shutil 重写，但当前脚本已有测试，前端仍需 Node 构建。除非统一运维环境确有收益，否则排最后。Next 配置和框架构建链继续保留其原生工具。

### 应保留在前端与数据库的部分

React/Next 交互、Tailwind、Lucide、微信 WXML/WXSS/JS、浏览器及微信生命周期不能直接改为 Python 而保持现有原生运行方式。生成的 TS 类型、前端金额显示格式和端侧状态也有保留价值；佣金计算与记账权威仍在 Python。SQL 外键、CHECK、唯一键、事务锁与追加账触发器不应移至仅应用层执行。

## 建议实施批次及完成标准

1. **资金与身份补洞**：F1、F2、F3 分别修复；真实 PostgreSQL 回归零跳过，通过乱序、并发及故障注入。保持现有外部契约。
2. **支付操作体验**：F4、F5、F6、F7；确认未知结果可恢复，刷新不误导，换卡留存历史，Web 与原生共同验收。
3. **迁移与旧代码收口**：完整 schema inventory → Alembic 基线/升级验证 → 单一迁移入口 → 旧 TS 运行链退出。
4. **运行保障与规模验证**：worker/差异告警、发布与备份恢复演练、真实渠道沙箱、读写负载与导出测试；落实入口请求大小限额。
5. **多端设计系统收口**：统一 token、状态组件、路由状态和端侧能力矩阵；复核视口与无障碍。展示版和正式接口分别验收。

不要把“目录改名、升级框架、换主题、迁移数据库工具”塞进同一提交。每批有可独立核验的结果，迁移前后的数据和接口都应能比较。
