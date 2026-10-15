import { newestFirst } from "/history.js";
const { t } = window.RelayI18n;
const $ = (id) => document.getElementById(id);

/** Agent-authored HTML stays in an opaque-origin iframe, never in the app DOM. */
export class ChartGallery {
  constructor({ transport, esc, robot, time, onDemo, onLive, onStop }) {
    Object.assign(this, { transport, esc, robot, time });
    $("chart-demo").onclick = onDemo;
    $("chart-follow").onclick = onLive;
    $("chart-stop").onclick = onStop;
    $("dashboard-page").addEventListener("click", (event) => {
      const button = event.target.closest("[data-chart-agent]");
      if (!button) return;
      this.agentId = button.dataset.chartAgent;
      this.render();
      document.querySelector(`[data-chart-agent="${CSS.escape(this.agentId)}"]`)?.focus({ preventScroll: true });
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-chart-open]");
      if (button) this.open(button.dataset.chartOpen);
    });
    $("chart-dialog").addEventListener("close", () => {
      this.documentId = null;
      $("chart-viewer").replaceChildren();
    });
  }
  update(state, runId, live, visible) {
    if (this.runId !== runId) {
      this.agentId = null;
      $("chart-dialog").close();
    }
    Object.assign(this, { state, runId, live });
    if (this.documentId) {
      if (state?.artifacts.some((a) => a.html?.id === this.documentId)) this.renderViewer();
      else $("chart-dialog").close();
    }
    if (visible) this.render();
  }
  url(artifact, download = false) { return this.transport.chartUrl(this.runId, artifact.html, download); }
  preview(artifact) {
    if (!artifact.html) return "";
    const { esc } = this, url = this.url(artifact);
    if (!url) return `<p class="no-events">${t("HTML preview unavailable")}</p>`;
    return `<div class="chart-preview"><iframe class="chart-preview-frame" src="${esc(url)}" title="${esc(t("Preview: {0}", artifact.name))}" sandbox="allow-scripts" referrerpolicy="no-referrer" tabindex="-1" aria-hidden="true" loading="lazy"></iframe><button class="chart-preview-open" data-chart-open="${esc(artifact.html.id)}" aria-label="${esc(t("Open HTML dashboard: {0}", artifact.name))}"><span>${t("Open & interact ↗")}</span></button></div>`;
  }
  render() {
    const { state, esc } = this;
    const agents = Object.values(state?.agents || {}), artifacts = state?.artifacts || [];
    const selected = agents.find((a) => a.id === this.agentId) || agents[0];
    this.agentId = selected?.id;
    const count = (id) => artifacts.filter((a) => a.agentId === id && a.html).length;
    $("chart-run-title").textContent = state?.run.title || t("Choose a run or launch the HTML demo.");
    $("chart-total").textContent = t("{0} dashboards · {1} agents", artifacts.filter((a) => a.html).length, agents.length);
    $("chart-follow").hidden = !state || this.live;
    $("chart-stop").hidden = this.transport.staticDemo || !this.live || state?.run.status !== "running";
    $("chart-mode").textContent = !state ? t("YOUR AGENTS’ HTML WORK") : this.live ? t(state.run.status === "running" ? "● LIVE" : "SAVED DASHBOARDS") : t("AT THE REPLAY CURSOR");
    $("chart-mode").className = `live-tag ${!this.live && state ? "replay" : ""}`;
    $("chart-agent-count").textContent = t("{0} agents", agents.length);
    $("chart-agent-list").innerHTML = agents.map((a) => `<button class="chart-agent ${selected?.id === a.id ? "selected" : ""}" data-chart-agent="${esc(a.id)}" aria-pressed="${selected?.id === a.id}" aria-label="${esc(t("{0}, {1} dashboards", a.name, count(a.id)))}">${this.robot(a.id)}<span><strong>${esc(a.name)}</strong><small>${esc(a.role)}</small></span><b>${count(a.id)}</b></button>`).join("") || `<p class="no-events">${t("No agents at this point.")}</p>`;
    $("chart-rename").hidden = !selected;
    $("chart-rename").disabled = !this.live;
    $("chart-rename").textContent = t("Rename");
    $("chart-rename").title = t(this.live ? "Change display name" : "Return to live to rename agents");
    $("chart-rename").dataset.renameAgent = selected?.id || "";
    $("chart-agent-title").textContent = selected?.name || t("Every agent gets a place.");
    $("chart-agent-role").textContent = selected?.role || t("Choose an agent to see its dashboards.");
    const charts = newestFirst(artifacts.filter((a) => a.agentId === selected?.id && a.html));
    $("chart-count").textContent = t("{0} dashboards", charts.length);
    $("chart-grid").innerHTML = charts.map((a) => `<article class="chart-card">${this.preview(a)}<div class="chart-card-body"><span class="eyebrow">${esc(nameOf(state, a.agentId))} / HTML / v${a.version || 1}</span><h3>${esc(a.name)}</h3>${a.content ? `<p>${esc(a.content)}</p>` : ""}${this.time(a)}<div class="chart-card-actions"><span>HTML · ${Math.ceil(Number(a.html.byteLength) / 1024)} KB</span><a href="${esc(this.url(a, true))}" download>${t("Download HTML ↓")}</a></div></div></article>`).join("") || `<div class="chart-empty"><span aria-hidden="true">⌘</span><h3>${t("No HTML dashboards yet.")}</h3><p>${selected ? t("{0} has not submitted an HTML dashboard at this point.", esc(selected.name)) : t("Register an agent or run the two-agent HTML demo to get started.")}</p><a href="./api.html#charts">${t("How to submit HTML ↗")}</a></div>`;
  }
  open(documentId) {
    const artifact = this.state?.artifacts.find((a) => a.html?.id === documentId);
    if (!artifact || !this.url(artifact)) return;
    this.documentId = documentId;
    this.renderViewer();
    if (!$("chart-dialog").open) $("chart-dialog").showModal();
  }
  renderViewer() {
    const a = this.state.artifacts.find((item) => item.html?.id === this.documentId), { esc } = this;
    $("chart-viewer-title").textContent = a.name;
    $("chart-close").textContent = t("Close ×");
    const frame = $("chart-viewer").querySelector("iframe");
    // Preserve the agent's interactive state through SSE events and language changes.
    if (!frame || frame.dataset.documentId !== a.html.id)
      $("chart-viewer").innerHTML = `<iframe class="chart-full-frame" data-document-id="${esc(a.html.id)}" src="${esc(this.url(a))}" title="${esc(a.name)}" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><div id="chart-viewer-meta" class="chart-viewer-meta"></div>`;
    $("chart-viewer-meta").innerHTML = `<div><strong>${esc(nameOf(this.state, a.agentId))}</strong>${this.time(a)}<span class="chart-sandbox-note">${t("Interactive HTML · isolated preview")}</span></div><div class="chart-viewer-actions"><a href="${esc(this.url(a))}" target="_blank" rel="noopener">${t("Open HTML ↗")}</a><a class="primary" href="${esc(this.url(a, true))}" download>${t("Download HTML ↓")}</a></div>`;
  }
}
function nameOf(state, id) { return state.agents[id]?.name || id; }
