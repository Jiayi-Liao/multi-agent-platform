import { conversationThreads, newestFirst } from "/history.js";
const { t } = window.RelayI18n;
const $ = (id) => document.getElementById(id);

/** Read full protocol messages without mixing agent activity or future replay state. */
export class ConversationLog {
  constructor({ esc, time, onInspect }) {
    Object.assign(this, { esc, time, onInspect });
    this.reader = $("conversation-reader");
    $("conversation-search").addEventListener("input", () => this.render());
    $("conversation-agent").addEventListener("change", () => this.render());
    $("conversation-panel").addEventListener("click", (event) => {
      const thread = event.target.closest("[data-conversation-thread]");
      if (thread) { this.threadId = thread.dataset.conversationThread; this.focusMessageId = null; this.render(); }
      const reply = event.target.closest("[data-conversation-reply]");
      if (reply) this.focus(reply.dataset.conversationReply);
      const inspect = event.target.closest("[data-conversation-inspect]");
      if (inspect) this.onInspect(inspect.dataset.conversationInspect);
    });
  }
  update(state, runId, { live, pair, selectedMessage }) {
    if (this.runId !== runId) {
      this.threadId = null;
      this.lastSelected = null;
      this.focusMessageId = null;
      this.readerThread = null;
      $("conversation-search").value = "";
      $("conversation-agent").value = "";
    }
    Object.assign(this, { state, runId, live, pair });
    if (selectedMessage && selectedMessage !== this.lastSelected && state.messages[selectedMessage]) {
      this.threadId = state.messages[selectedMessage].conversationId;
      this.focusMessageId = selectedMessage;
    }
    this.lastSelected = selectedMessage;
    this.render();
  }
  open(messageId) {
    const message = this.state.messages[messageId];
    if (!message) return;
    $("conversation-search").value = "";
    $("conversation-agent").value = "";
    this.threadId = message.conversationId;
    this.focusMessageId = messageId;
    this.render();
    this.focus(messageId);
  }
  focus(messageId) {
    const card = [...this.reader.querySelectorAll("[data-thread-message]")].find((node) => node.dataset.threadMessage === messageId);
    if (!card) return;
    this.focusMessageId = messageId;
    for (const node of this.reader.querySelectorAll("[data-thread-message]")) node.classList.toggle("focused-message", node === card);
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: "center" });
  }
  name(id) { return this.state.agents[id]?.name || id; }
  messageCount(count) { return t(count === 1 ? "1 message" : "{0} messages", count); }
  timestamp(value) {
    const iso = Number.isFinite(value) ? new Date(value).toISOString() : "";
    return `<time ${iso ? `datetime="${iso}" title="${iso}"` : ""}>${this.esc(this.time(value))}</time>`;
  }
  render() {
    if (!this.state) return;
    const { state, esc } = this;
    const select = $("conversation-agent"), previous = select.value;
    const options = `<option value="">${t("All agents")}</option>` + Object.values(state.agents).map((agent) => `<option value="${esc(agent.id)}">${esc(agent.name)}</option>`).join("");
    if (select.innerHTML !== options) { select.innerHTML = options; select.value = Object.hasOwn(state.agents, previous) ? previous : ""; }
    const query = $("conversation-search").value;
    const threads = conversationThreads(state, { agentId: select.value || null, pair: this.pair, query });
    const selected = threads.find((thread) => thread.id === this.threadId) || threads[0];
    this.threadId = selected?.id;
    $("conversation-count").textContent = `${t(threads.length === 1 ? "1 conversation" : "{0} conversations", threads.length)} · ${this.messageCount(threads.reduce((sum, thread) => sum + thread.messages.length, 0))}`;
    $("conversation-context").textContent = (this.live ? t("Full messages · newest first") : t("At the replay cursor · future replies are hidden"))
      + (this.pair ? ` · ${t("Filtered route: {0} ↔ {1}", ...this.pair.map((id) => this.name(id)))}` : "");
    const list = $("conversation-threads"), listScroll = list.scrollTop;
    const html = threads.map((thread) => `<button class="conversation-thread ${thread.id === selected?.id ? "selected" : ""}" data-conversation-thread="${esc(thread.id)}" aria-pressed="${thread.id === selected?.id}"><strong>${thread.participantIds.map((id) => esc(this.name(id))).join(" ↔ ")}</strong><span>${esc(thread.messages[0].content.slice(0, 110))}</span><small>${this.messageCount(thread.messages.length)} · ${esc(thread.id)}</small></button>`).join("");
    if (list.innerHTML !== html) { list.innerHTML = html; list.scrollTop = listScroll; }
    if (!selected) {
      this.readerThread = null;
      const filtered = query.trim() || select.value || this.pair;
      this.reader.innerHTML = `<div class="conversation-empty"><span aria-hidden="true">↔</span><h4>${t(filtered ? "No conversations match." : "No messages at this point.")}</h4><p>${t(filtered ? "Choose another agent or clear your search." : this.live ? "Messages appear here when agents send them." : "Move forward in replay or return to live to read later messages.")}</p><p>${t("Only messages submitted to Relay appear here.")}</p></div>`;
      return;
    }
    const changedThread = this.readerThread !== selected.id;
    // Preserve selection, expanded details, and scroll position through unrelated SSE updates.
    const scroll = this.reader.scrollTop;
    const anchor = [...this.reader.querySelectorAll("[data-thread-message]")].find((node) => node.getBoundingClientRect().bottom > this.reader.getBoundingClientRect().top);
    const anchorTop = anchor?.getBoundingClientRect().top;
    if (changedThread) {
      this.reader.innerHTML = '<header class="conversation-reader-heading"><h4></h4><span></span></header><div class="conversation-message-list"></div>';
      this.readerThread = selected.id;
    }
    this.reader.querySelector("h4").textContent = selected.participantIds.map((id) => this.name(id)).join(" ↔ ");
    this.reader.querySelector(".conversation-reader-heading span").textContent = this.messageCount(selected.messages.length);
    const container = this.reader.querySelector(".conversation-message-list");
    const cards = new Map([...container.children].map((node) => [node.dataset.threadMessage, node]));
    const retained = new Set();
    selected.messages.forEach((message, index) => {
      let card = cards.get(message.id);
      const signature = JSON.stringify([message, this.name(message.fromAgentId), this.name(message.toAgentId), t("Message details"), this.state.messages[message.replyTo]?.content]);
      if (!card) {
        card = document.createElement("article");
        card.className = "conversation-message";
        card.dataset.threadMessage = message.id;
        card.tabIndex = -1;
      }
      if (card.renderedSignature !== signature) {
        const wasOpen = !!card.querySelector("details[open]");
        card.innerHTML = this.messageHTML(message);
        if (wasOpen) card.querySelector("details").open = true;
        card.renderedSignature = signature;
      }
      card.classList.toggle("focused-message", message.id === this.focusMessageId);
      if (container.children[index] !== card) container.insertBefore(card, container.children[index] || null);
      retained.add(card);
    });
    for (const card of [...container.children]) if (!retained.has(card)) card.remove();
    if (changedThread) this.reader.scrollTop = 0;
    else if (anchor?.isConnected) this.reader.scrollTop = scroll + anchor.getBoundingClientRect().top - anchorTop;
    else this.reader.scrollTop = scroll;
  }
  messageHTML(message) {
    const { esc } = this, original = this.state.messages[message.replyTo];
    const delivery = newestFirst([{ state: "queued", timestamp: message.timestamp, eventSeq: message.eventSeq }, ...message.acknowledgements]);
    const reply = !message.replyTo ? "" : original
      ? `<button class="conversation-reply" data-conversation-reply="${esc(original.id)}">↳ ${esc(t("Reply to {0} · #{1}", this.name(original.fromAgentId), original.eventSeq))}</button>`
      : `<p class="conversation-reply">${t("Original message is unavailable at this point.")}</p>`;
    return `<header class="conversation-message-heading"><strong>${esc(this.name(message.fromAgentId))}<span> → </span>${esc(this.name(message.toAgentId))}</strong><span class="detail-tag">${esc(t(message.status))}</span></header><div class="conversation-message-meta">${this.timestamp(message.timestamp)}<span>${esc(t(message.kind || "chat"))} · #${message.eventSeq}</span></div>${reply}<div class="conversation-body">${esc(message.content)}</div><footer><button class="quiet" data-conversation-inspect="${esc(message.id)}">${t("Inspect event ↗")}</button><span>${t(message.expectsResponse ? "Expects a reply" : "No reply required")}</span></footer><details class="conversation-details"><summary>${t("Message details")}</summary><dl><dt>${t("Message:")}</dt><dd>${esc(message.id)}</dd><dt>${t("Conversation:")}</dt><dd>${esc(message.conversationId)}</dd><dt>${t("Reply to:")}</dt><dd>${esc(message.replyTo || t("Conversation start"))}</dd></dl><div class="detail-label">${t("Delivery history")}</div>${delivery.map((ack) => `<div class="conversation-delivery"><span>${esc(t(ack.state))}</span>${this.timestamp(ack.timestamp)}<span>#${ack.eventSeq}</span></div>`).join("")}</details>`;
  }
}
