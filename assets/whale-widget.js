// DSH 宿主注入的前端入口：只做「在宿主页面里把挂件立起来」，规则都在 src/widget 与 src/core。
// 相对路径是刻意的：本文件挂在 /dsh-whale/widget.js，于是 './widget/whale.js'
// 解析到 /dsh-whale/widget/whale.js，再由适配器映射回 src/widget/whale.js。
import { mountWhale } from './widget/whale.js';
import { createDshSource } from './widget/dsh-source.js';

const API_BASE = '/dsh-whale';
const INTERVAL_MS = 60_000;

export function boot({ doc = document, win = window } = {}) {
  if (doc.querySelector('.dshw-root')) return null; // 宿主重复注入时不叠两只鲸鱼
  const source = createDshSource({ apiBase: API_BASE, intervalMs: INTERVAL_MS });
  const widget = mountWhale({
    doc,
    win,
    source,
    version: '0.1.0',
    onEvent: (event) => {
      if (event.type === 'warn') win.console?.warn?.('[dsh-whale]', event.message);
    },
  });
  return { widget, source };
}

export { mountWhale, createDshSource };

if (typeof document !== 'undefined' && !window.__dshwNoAutoBoot) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
  else boot();
}
