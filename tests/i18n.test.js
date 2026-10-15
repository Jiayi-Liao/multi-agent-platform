import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');
function environment(saved = null, blocked = false) {
  const listeners = {}, windowListeners = {}, nodes = [], writes = [];
  const storage = new Map(saved ? [['relay-language', saved]] : []);
  const button = { isConnected: true, textContent: '', attributes: {}, setAttribute(k,v) { this.attributes[k]=v; }, getAttribute(k) { return this.attributes[k]; }, addEventListener(k,fn) { this[k]=fn; } };
  const document = {
    documentElement: {},
    addEventListener: (type, fn) => { listeners[type]=fn; },
    createTreeWalker: () => { let i = 0; return { nextNode() { this.currentNode=nodes[i++]; return !!this.currentNode; } }; },
    querySelectorAll: (selector) => selector === '[data-language-toggle]' ? [button] : [],
  };
  const window = { addEventListener: (type,fn) => { windowListeners[type]=fn; }, dispatchEvent: (e) => writes.push(e), };
  runInNewContext(script, { window, document, Intl, NodeFilter: { SHOW_TEXT: 4 }, CustomEvent: class { constructor(type, options) { this.type=type; this.detail=options.detail; } }, localStorage: { getItem: (k) => { if(blocked) throw Error('Unavailable'); return storage.get(k); }, setItem: (k,v) => { if(blocked) throw Error('Unavailable'); storage.set(k,v); } } });
  return { api: window.RelayI18n, nodes, document, storage, button, listeners, writes, windowListeners };
}

test('English is default; language preference and parameterized labels survive switching', () => {
  const e = environment();
  assert.equal(e.api.locale(), 'en');
  assert.equal(e.document.documentElement.lang, 'en');
  e.listeners.DOMContentLoaded();
  e.button.click();
  assert.equal(e.api.t('EVENT {0} / {1}', 2, 9), '事件 2 / 9');
  assert.equal(e.storage.get('relay-language'), 'zh-CN');
  assert.equal(e.document.documentElement.lang, 'zh-CN');
  assert.equal(environment(e.storage.get('relay-language')).api.locale(), 'zh-CN');
  assert.match(e.api.formatTimestamp(Date.UTC(2026, 9, 15, 2, 3, 4, 123)), /123/);
  assert.equal(e.api.formatTimestamp(undefined), '—');
  e.button.click();
  assert.equal(e.api.t('EVENT {0} / {1}', 2, 9), 'EVENT 2 / 9');
  assert.equal(e.writes.at(-1).type, 'relay:languagechange');
});

test('only captured authored copy is translated; recorded content and code stay verbatim', () => {
  const e = environment('zh-CN');
  const make = (text, skipped = false) => ({ isConnected: true, nodeValue: text, parentElement: { closest: () => skipped } });
  const label = make('  Artifacts\n'), code = make('Artifacts', true);
  e.nodes.push(label, code);
  e.listeners.DOMContentLoaded();
  assert.equal(label.nodeValue, '  产物\n');
  assert.equal(code.nodeValue, 'Artifacts');
  const agentOutput = make('Artifacts');
  e.nodes.push(agentOutput); // Runtime output is created after the authored capture.
  e.api.setLanguage('en');
  e.api.setLanguage('zh-CN');
  assert.equal(agentOutput.nodeValue, 'Artifacts');
  assert.equal(e.api.t('A novel runtime output'), 'A novel runtime output');
  e.windowListeners.storage({ key: 'relay-language', newValue: 'en' });
  assert.equal(label.nodeValue, '  Artifacts\n');
});

test('language switching still works if localStorage is unavailable', () => {
  const e = environment(null, true);
  e.listeners.DOMContentLoaded();
  e.api.setLanguage('zh-CN');
  assert.equal(e.api.t('Overview'), '总览');
  e.api.setLanguage('en');
  assert.equal(e.api.t('Overview'), 'Overview');
});
