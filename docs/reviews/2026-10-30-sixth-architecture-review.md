# 第六轮代码与架构审查

日期：2026-10-30。审查对象：上一轮整改后的当前未提交工作区，Git 基线 `0a4342e`。本轮只新增报告、诊断探针和证据，没有修改业务实现、执行生产迁移或发布。

后续状态：以下四项确认问题已完成代码修复与回归，详见 [第六轮整改记录](../implementation/2026-10-30-review6-fixes.md)。本报告保留修复前证据。

## 结论

Python 后端、Next 页面/BFF、两个原生小程序的职责已经清楚；Alembic 已成为唯一迁移入口，旧 Node 业务后端已退役。这一架构值得继续维护，不需要再推倒重写或拆资金微服务。

本轮确认 **4 项仍需修改的问题：1 项 P1、3 项 P2**，均有本轮动态复现。主要风险集中在请求与数据库连接的生命周期、失败通知的处理资格、数据库保护的有效状态，以及团队页面刷新行为。

现有测试全绿，但未覆盖这些条件。因此“上一轮整改完成”只能说明当时清单与验收完成，不能推导为全部边界正确或生产已验收。本轮未复现普通代理越权读平台全局数据、重复佣金入账或分润精度漂移；这也不是完整渗透测试结论。

## R6-01 · P1：鉴权和业务各占一个连接，受限连接池会让写接口超时

位置：[security.py:65](../../python_backend/app/security.py#L65)、[db.py:57](../../python_backend/app/db.py#L57)、[finance_accounts.py:40](../../python_backend/app/routers/finance_accounts.py#L40)、[payout_accounts.py:9](../../python_backend/app/payout_accounts.py#L9)。

鉴权依赖使用 `get_session` 查询用户，该 session 随请求结束才关闭；进入资金服务后又用同一个 factory 新开 session。第一条连接仍占用，服务需要第二条才能继续。多个写请求同时完成鉴权时，会出现连接池被身份查询占满、业务互相等待的情况。提现、审批等同类路由也使用此模式。

**本轮复现**：真实 PostgreSQL、合法代理 JWT，设置受支持参数 `connection_limit=1&pool_timeout=1`，调用 `POST /api/agent/payout-accounts`。约 1 秒后返回 500，服务获取连接发生 TimeoutError；没有真实付款。较大连接池并不意味着必现，但并发达到池容量时同样存在饥饿风险。

**修改方案**：明确请求级 Unit of Work。写请求要么复用同一 session/事务，要么在业务开始前释放短生命周期的鉴权连接，并把不可变身份版本传入资金事务作必要校验。读取接口仍保留身份与金额的一致快照。不要仅加大连接池掩盖问题。

**验收**：连接池 1/2/5 的 HTTP 集成测试覆盖绑定账户、提现、审批和票据；并发写入不因嵌套申请连接而超时，金额仍守恒，撤销竞态回归继续通过。

## R6-02 · P2：无效退款通知能污染后续合法支付归并

位置：[payments.py:244](../../python_backend/app/payments.py#L244)，尤其 255–266 的候选选择。

`provider` 与 `transactionId` 各自通过 Pydantic 校验后，拼接的渠道 reference 仍可能超过数据库 128 字符。首次处理会正确拒绝，但通知保留为 failed。后来合法退款建立 `refund_pending` 后，后到支付会按时间选出第一条金额相同的未处理退款，没有再次检查 reference 长度或该通知是否具有业务处理资格。

**本轮复现顺序**：

1. 未支付订单收到 `transactionId` 为 128 字符的退款通知，返回 `INVALID_PAYMENT_REFERENCE`，failed inbox 保留。
2. 同单收到合法退款通知，因支付尚未到达返回 `ORDER_NOT_PAID`，持久化退款保护。
3. 合法 paid 到达，选中第一条无效退款，写 Refund 时发生数据库异常。
4. 重试合法退款仍为 `ORDER_NOT_PAID`；订单停留 pending、refund_pending=true，余额 0。

这没有多发佣金，但阻断该单自动恢复，并使相关代理及平台的新提现继续受到退款保护限制。前提是可信接入层发送了此类格式错误通知；并非未签名的互联网请求可以直接触发。

**修改方案**：把可重试错误与永久无效通知分开；保留原始证据的同时设置 quarantine/terminal 状态。统一计算并校验渠道 reference，归并只消费通过完整业务资格校验的退款。不可直接清掉退款保护绕过核对。

**验收**：无效退款→合法退款→合法 paid 可完成正确终态，自动重试不被无效证据反复阻塞；永久无效通知仍可审计定位。

## R6-03 · P2：迁移核对没有检测触发器是否真正启用

位置：[schema_inventory.py:22](../../python_backend/app/schema_inventory.py#L22)。

触发器只比较名称和 `pg_get_triggerdef`，没有比较 `pg_trigger.tgenabled`；索引只比较 `pg_indexes.indexdef`，未记录 `indisvalid/indisready`。定义存在与保护有效是不同的状态。

**本轮复现**：在隔离 schema 禁用 `wallet_movements_append_only`，数据库 tgenabled 变为 D；当前结构清单前后比较仍为 `[]`。因此依赖同一清单的结构验收无法识别该漂移。索引有效状态遗漏属于代码确认，本轮没有故意构造 invalid index。

这需要数据库所有者或维护操作权限；受限应用角色本身不能禁用触发器，不能描述为普通代理的越权漏洞。实际风险是维护/恢复后误判财务保护正常。

**修改方案**：结构清单加入触发器启用模式、索引 ready/valid 等有效性状态，评估内部外键触发器的启用检查。关键保护失效应拒绝迁移验收或就绪检查，且给出具体对象名。

**验收**：禁用财务触发器后 check 必须失败；恢复后通过；已有新库、旧库接管、备份恢复与正常运行角色测试继续通过。

## R6-04 · P2：团队页面仍被后台刷新打断

位置：[admin-network.tsx:149](../../web/components/admin-network.tsx#L149)、[admin-network.tsx:220](../../web/components/admin-network.tsx#L220)、[live-refresh.tsx:13](../../web/components/live-refresh.tsx#L13)。

`refreshKey` 更新触发加载 effect，直接执行 `setSelected(null)`，同时 loading 分支替换整片团队列表。二级团队 Children 随之卸载，内部页码回到初始 1。

**本轮真实浏览器复现**：在老板移动端团队页打开代理详情，模拟窗口 focus 后详情关闭；展开二级团队并到第 2 页，再 focus 刷新后自动回到第 1 页。使用当前 Web 生产构建、Chrome 和受控 API；不是微信原生真机测试。PC 与移动 Web 复用同一组件，也应一起整改。

**修改方案**：区分首次加载与后台更新，保留列表实例；选中对象按 ID 关联最新记录；子团队分页提升为按 parentId 保存的状态。仅在筛选/周期变化时显式重置，后台刷新不能清空用户位置。必要时把团队搜索、根/子页码和选中代理纳入 URL。

**验收**：详情打开和子页第 2 页分别跨越一分钟刷新、窗口切换和请求失败；选择、页码与焦点不丢失，金额更新且旧数据时间明确。

## 架构与产品的后续优化

以下是明确的增长或交付改进，不能与上述已复现故障混为一谈。

1. **把会话边界统一为工程规则。** Identity 已有版本上下文，但大量写接口仍只向服务传 user_id，并另开事务。优先解决 R6-01，再用一个小的依赖/事务约定统一资金、账户、绑定和审批；不必为此重命名整仓目录。
2. **补齐处理中资金的人员交接。** 当前 processing 提现只能由 claimed_by 完成。若经办管理员停用，其他管理员会被拒绝；运维可以恢复原账号，但系统没有正式的受控转交流程。建议先核对渠道结果，再通过高权限转交、原因和不可变历史完成交接；不能自动过期重新付款。此项为代码流程评估，未进行真实渠道试验。
3. **按真实规模做容量预算。** 对账已分批扫描订单，但仍全量读取钱包、汇总和部分差异；周期性对账会消耗连接与长快照。应测 1 万/10 万级合成数据的连接池等待、锁等待、峰值内存和导出时长，再决定增量对账+周期全量、后台导出或汇总表。200 笔本机基线不能证明生产容量。
4. **收敛组件行为，而非继续换肤。** AdminDashboard 622 行、AdminTreasury 572 行，包含数据请求、URL、表单和展示；建议分离可测试的资源 hook、任务状态与展示组件。主题 token 已建立，但 `admin-network`、`admin-mobile-context` 等仍有硬编码色值，可按组件逐步迁移。先统一刷新、错误、空数据、旧数据和结果未知状态，视觉一致性才稳定。
5. **为发布保留可追踪版本。** 当前大量改动尚未提交；应在修复上述问题后建立可审阅提交，再跑远程 Python 3.12/3.14 CI 和镜像启动测试。生产副本迁移、权限、监控、微信真机和真实渠道验收依然是发布步骤，不由本地测试替代。

Python 适合继续承担通知状态机、对账任务、报表导出、迁移与测试工具。React 页面、Next Cookie BFF 和微信平台生命周期继续保留各自技术栈；目前没有再迁移一套前端到 Python 的收益证据。

## 本轮验证范围与证据

- Python：**128 passed，0 skipped**，PostgreSQL 16 隔离库，`--require-database`。
- JS/TS/原生生命周期：**37 passed，0 skipped**。
- 独立 TypeScript、Ruff、TS 契约、OpenAPI、51 个共享展示文件同步检查通过。
- 新增 3 个后端故障探针，见 [结果](evidence/review6-backend-probes.json) 与 [可复用脚本](probes/review6_backend.py)。
- 新增真实 Chrome 团队刷新回归，见 [结果](evidence/review6-network-refresh.json) 与 [可复用脚本](probes/review6_network_refresh.py)。

本轮使用上一轮已生成的当前 Web 生产构建做浏览器探针，没有重新打包或重跑全部 UI 截图、备份恢复、Docker 镜像构建、远程 CI、依赖漏洞扫描、微信真机或真实支付渠道测试。浏览器探针与数据库探针分别覆盖不同边界。本轮不是对每一行代码和第三方依赖的逐行安全背书。

复现命令从仓库根目录执行（先准备可删除、以 `_test` 结尾的 PostgreSQL 库；Node 加入 PATH）：

```bash
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/commission_test' \
  python_backend/.venv/bin/python docs/reviews/probes/review6_backend.py
python_backend/.venv/bin/python docs/reviews/probes/review6_network_refresh.py
```

建议顺序：**R6-01 连接生命周期 → R6-02 无效通知隔离 → R6-03 迁移有效状态 → R6-04 团队刷新**。每项先转为失败回归，再修复并保留原资金与契约测试。
