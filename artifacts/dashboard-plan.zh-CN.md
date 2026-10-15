# Agent 创建 Dashboard：实施计划

状态：**规划中，尚未实现**。目前侧边栏入口展示设计说明，不是可用的图表编辑器。

[English](dashboard-plan.md)

## 目标与完整使用场景

让任意角色的 Agent 通过现有通信与历史记录链路，发布实验指标并创建看板。例如：训练 Agent 按明确的 step 上报 `train/loss`，评估 Agent 在同一个 experiment 下上报 `eval/loss`，协调 Agent 创建比较两条曲线的看板。用户观察实时更新、回到某个事件，并点击数据点查看来源 Agent、事件和相关产物。

数据模型不绑定 rewriter/verifier，也不绑定机器学习。现有 Three.js 场景继续负责展示 Agent 活动；指标采用便于阅读的二维图表工作区，共享配色、主题和语言。

## 第一版范围

- 一个 run 可包含多个 experiment、指标序列和 dashboard。第一版限定在同一个 run 内；跨 run 比较留到明确 workspace 数据模型之后。
- Agent 提交经过 schema 校验的 JSON 看板定义。用户选择看板和实验、开关序列、缩放 / 重置范围、检查数据点、复制看板定义。
- 三种组件：折线图、单值指标、结果表格。优先实现 loss / 评估曲线；默认显示原始值、明确的 step 横轴和最新值，不默认平滑。
- 左侧 Dashboard 进入独立工作区：看板选择、实时 / 暂停状态、图表网格、空状态、详情面板；不依赖选中某个 Agent。
- 本地版持久化并接收真实 Agent 写入；GitHub Pages 仅使用模拟训练 / 评估记录和浏览器内存。

第一版不做任意 HTML / JavaScript、远程 iframe、在线账号认证、训练进程管理、告警及拖拽式图表编辑器。看板用于展示已提交的数据。

## 拟议协议（目前不可调用）

```json
{
  "id": "training-overview",
  "title": "Training experiment",
  "authorAgentId": "coordinator",
  "expectedRevision": 0,
  "widgets": [{
    "id": "loss", "type": "line", "title": "Loss",
    "experimentIds": ["experiment-a"],
    "series": ["train/loss", "eval/loss"],
    "xAxis": "step", "yScale": "linear",
    "layout": { "column": 0, "row": 0, "width": 8 }
  }]
}
```

每次更新携带 `expectedRevision`，版本冲突返回 409，成功版本保留在历史中。引用不存在的实验 / 序列返回校验错误，必须先注册数据源。第一版不删除看板；新版本移除组件不会删除旧历史。

指标批次包含稳定唯一的 `batchId`、已注册的 `agentId` 和 `experimentId`。每个点包含 `series`、有限数值 `value`、非负整数 `step`，以及可选的 `observedAt`、同 run 的 `sourceEventId` / `artifactId`。序列先注册显示名称、单位和所属 Agent。在可信本地模式下，只允许匹配的路由身份上报；这是数据一致性校验，不是身份认证。

同一实验 / 序列中的 step 唯一。完全相同的重试幂等；复用批次 ID 或 step 但内容不同返回 409。不同序列可以使用相同步数。第一版更正数据需要新序列 / 实验，不能静默覆盖。非有限数值、未注册身份、无效引用和错误组件定义返回 400。继承现有同源和 JSON 校验，结束的运行不接受写入。

`R = /api/runs/:runId`：

| 拟议方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `R/experiments` | 注册实验 ID、名称、Agent、受限配置 |
| POST | `R/metric-series` | 注册实验下的序列、单位和所属 Agent |
| POST | `R/metrics/batches` | 原子追加批次，返回已提交事件序号 |
| GET | `R/metrics` | 按实验 / 序列 / step 范围 / `asOfSeq` / 分页查询 |
| POST | `R/dashboards` | 以幂等键创建版本 1 |
| PUT | `R/dashboards/:id` | 携带 `expectedRevision` 追加版本 |
| GET | `R/dashboards?asOfSeq=...` | 列出回放位置可见的看板 |
| GET | `R/dashboards/:id?asOfSeq=...` | 读取该时刻的看板版本 |

SDK 对应增加 `experiment`、`series`、`metrics`、`createDashboard`、`updateDashboard`、`dashboards`。这些仅为拟议接口，不加入当前 API 指南的“可用接口”列表。

初始限制：新接口请求最多 64 KiB（低于当前总上限 128,000 字节）、每批 500 点、每板 24 个组件、每次查询 32 条序列 / 5,000 点。精确数据分页；渲染需要降采样时明确标记，不能静默截断。根据实测调整限制。

## 持久化、实时通信与回放

1. 增加带 schema 版本的 `experiment.registered`、`metric.series.registered`、`metric.batch.appended`、`dashboard.revised` 事件。批次原子提交，时间戳与顺序号由服务端赋值；生产者观察时间单独保留。
2. 用增量 SQLite migration 增加指标索引投影 `(run_id, experiment_id, series, step, event_seq)` 与看板版本投影。事件和投影同事务写入。完整批次只在事件日志中保留一份，索引行支持有界查询；兼容已有数据库和 run。
3. append-only 日志为事实来源，投影表可从日志重建。migration 事务执行；导出版本 2 包含新数据与 schema 元信息。通过导出样例重建回放测试后，才声明兼容；已有版本 1 导出仍可供现有应用读取。
4. 复用 SSE 发送已提交的看板 / 指标事件，按最后 seq 补发，以事件 / 批次 ID 去重。浏览器合并重绘，最多每秒四次，不丢弃记录。
5. 看板、实验、序列和数据点都满足 `event_seq <= asOfSeq`。回到过去时，未来数据与看板版本必须消失。提交顺序控制历史可见性，即使生产者时间戳被回填。
6. 曲线横轴用明确的 step；提交顺序只决定何时可见。补报的旧 step 不应篡改历史。点击点跳到对应批次事件，并以 series + step 识别批内具体点和来源。
7. 历史列表最新在前，曲线横轴从小到大。暂停时显示“有新事件”，只在用户返回实时时推进到最新提交位置。

当前前端会载入 run 的全部事件。该功能必须同步引入有界指标查询、元数据初始化和分页历史加载；否则即使数据库有索引，大批次日志仍会撑大浏览器内存。保留旧接口兼容小规模历史，并说明其内存成本。

## 界面与 Agent 使用流程

Dashboard 顶部：看板 / 实验选择、实时状态、带时区的最后更新时间。下方是宽幅图表网格。每个组件展示单位、来源 Agent、图例、数据范围、加载 / 空 / 错误状态及是否降采样。共享悬停线对齐相同 step；缺失步数保持缺口。对数轴明确拒绝或提示非正数。单值指标注明 latest / min / max 的聚合规则和对应 step；结果表限制列 schema 与行数。

空状态提供 SDK 示例、JSON schema 和模拟 loss 曲线。详情可跳转 Agent 档案、源事件、相关 artifact。保留默认英文并提供中文、键盘操作、无障碍摘要 / 数据表、减少动态效果和深浅主题。翻译不修改 Agent 名称或实验内容。

功能发布时提供只读 schema / 示例发现接口，附完整本地脚本：创建 run → 注册任意 trainer / evaluator / coordinator → 注册实验 / 序列 → 创建看板 → 上报批次 → 完成 → 查看和回放。失败响应给出字段级错误。结构化看板与自由文本 artifact 分开建模。

## 分阶段实施与验收门槛

| 阶段 | 交付 | 通过条件 |
| --- | --- | --- |
| 0：协议评审 | schema、错误模型、migration、样例、界面草图 | 确认 loss 场景、容量、幂等和回放语义 |
| 1：存储与 API | 事务事件 / 索引、查询、SDK、schema 发现 | 当前数据库升级、重复 / 冲突 / 重启测试、精确 asOfSeq 查询 |
| 2：工作区 | 看板导航、切换、折线 / 单值 / 表格、详情 | 端到端脚本产出可见图表，点击点定位源事件 |
| 3：实时与回放 | SSE 合并 / 重连、暂停 / 实时、分页历史 | 新数据流入，倒带移除未来点 / 版本，重连无重复 |
| 4：发布 | Pages 模拟样例、中英文文档、性能 / 无障碍 | CI、干净构建、本地与公开站验证、migration / 导出恢复说明 |

阶段 0 确认数据规模和渲染方式后再估工期。先用 10,000 / 100,000 点做原型，再依据交互成本、无障碍、包体积和许可证选择图表渲染方案；图表生命周期与 Three.js 分离。

## 关键验收场景

- trainer 与 evaluator 上报 100 步，两条 loss 曲线可见；协调 Agent 创建的单值和表格与源数据一致。
- 两个 Agent 同时更新看板：一个成功，一个收到版本冲突，不丢更新。
- 重连 / 重启后重试批次，不重复写入；冲突批次原子失败。
- 相同时间戳、补报旧 step、一个批次多个点：可见性按 seq，横轴按 step，来源定位正确。
- 回放到实验 / 点 / 看板版本创建前，未来内容不可见；切换 run / 看板取消过期查询。
- 拒绝 NaN / infinity、超量负载、未知序列、跨 run 引用、结束后写入、危险组件与可执行标记。
- 验证旧库升级和投影重建；进程中断后已提交记录保留，不出现半批数据。
- 10 序列合计 100,000 点测试：查询有界，降采样明确，暂停回放仍流畅。目标普通交互低于 200 ms，正常批次无超过 100 ms 长任务；记录实际浏览器 / 硬件数据，发布前据此调整。
- 中文 / 英文、深浅主题、390 px 布局、键盘、图表摘要和 Pages 数据隔离全部通过。

## 后续决策

跨 run 比较与保留策略、指标更正、用户编辑与 Agent 所有权、分析数据下载、远程认证，均在第一版后单独评审，并先明确权限和历史语义。
