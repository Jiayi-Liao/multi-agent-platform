# Dashboard：每个 Agent 的 HTML 看板位置

状态：已实现。[English](dashboard-plan.md)

每个 Agent 都有一个位置，用户能找到它创建的 HTML 看板。布局、图表和交互由 Agent 自己编写，平台负责保存、归类和预览。

- 选择 run，再选择 Agent。每个已注册 Agent 都有自己的位置，没有提交时显示空状态。
- 按最新优先浏览 HTML，看板卡片显示标题、时间和版本。
- 打开交互预览，也可以直接打开 HTML 或下载源码。
- 使用 `client.chart(name, html, { content?, version? })` 提交；run 和 Agent 必须先注册。
- HTML 源码与 artifact 事件原子保存到 SQLite，重启后保留，并遵循回放位置。
- 支持自包含 HTML 的内联 CSS、JavaScript、SVG 和 canvas。预览在独立沙箱中运行，依赖和数据需内联。

双 Agent 演示：Trainer 提交可调整训练步数的 loss 看板，Evaluator 提交可切换指标的对比看板。Trainer 再提交第二版，用于验证最新优先。界面点击“启动 HTML 演示”，或在本地运行 `npm run demo:charts`。Pages 只使用内置模拟 HTML。

不需要实验管理系统、逐点指标 API 或图表布局协议，Agent 提交的单位就是 HTML。具体接口和大小限制见 README 与 API 指南。
