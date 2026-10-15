# Dashboard: a chart space for each agent

Status: planned, not implemented. The sidebar currently opens a brief explaining this plan.

[简体中文](dashboard-plan.zh-CN.md)

## Purpose

Give every agent a place where users can find the charts it has created. Agents generate their own charts; the platform groups, previews, and opens the finished files.

For example, a trainer produces a loss curve and an evaluator produces a comparison chart. A user opens Dashboard, selects the relevant agent, and sees its charts.

## Page behavior

- Reuse the current run and registered agents. Every agent has its own space.
- Show each agent's name, role, and chart count. Agents with no charts show an empty state.
- Selecting an agent reveals thumbnail cards with titles and creation times, newest first.
- Click a chart to view it larger, open the original file, or download it.
- Each agent can have multiple charts. Keep ownership clear between agents.

```text
Dashboard
├─ Trainer   · 2 charts
│  ├─ Loss curve       [thumbnail] → open larger
│  └─ Learning rate    [thumbnail] → open larger
├─ Evaluator · 1 chart
│  └─ Results          [thumbnail] → open larger
└─ Writer    · no charts yet
```

## Integration

Reuse existing agent ownership and artifacts. After generating a chart, the agent submits an image with its agent identity and a title. The platform records the creation time and saves the file. Start with PNG, JPEG, and WebP images; loss curves are just one example.

Add a small image-attachment path to existing artifacts during implementation. The local server stores and serves those files; arbitrary paths on an agent's machine are not browser image URLs. Existing text artifacts continue to work. The chart space includes artifacts with image attachments.

Display finished charts directly. Agents do not need to report individual metric points or describe how to draw a chart. Experiment management, a chart editor, and point-level replay are outside this first release. Existing message and event replay stays in its current views.

## Implementation order

1. **Save images:** associate attachments with the existing run, agent, and artifact; preserve files across refreshes and restarts.
2. **Browse by agent:** add agent selection and chart cards to Dashboard, with newest-first order, a larger preview, and access to the original file.
3. **Demonstrate:** submit different charts from two agents, add English/Chinese instructions, and provide bundled synthetic images on GitHub Pages.

## Acceptance

- Every agent has a visible place, including agents that have not submitted an image.
- Two agents submit different charts; users can reliably find each agent's own work.
- A new chart appears first within its owner's space.
- Titles, times, thumbnails, larger previews, and original files are available and survive refreshes.
- English/Chinese, light/dark themes, and mobile layouts work.
