// 演示页胶水：把挂件挂到这个假宿主界面上，并提供 mock 数据控制与事件日志。
// 挂件本体在 src/widget/whale.js，这里不含任何业务规则。
import { createApiSource } from '/widget/state.js';
import { mountWhale } from '/widget/whale.js';
import { formatAmount, parseAmount } from '/core/money.js';

const params = new URLSearchParams(location.search);
const intervalMs = Math.max(1000, Number(params.get('interval')) || 60000);

const logList = document.getElementById('events');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

function logEvent(kind, text) {
  const li = document.createElement('li');
  li.className = kind;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  li.textContent = `${time} ${text}`;
  logList.prepend(li);
  while (logList.children.length > 40) logList.lastElementChild.remove();
}

const source = createApiSource({
  intervalMs,
  logger: (message) => logEvent('warn', message),
});

const widget = mountWhale({
  source,
  version: '0.1.0',
  onEvent: (event) => {
    if (event.type === 'snap') {
      logEvent('snap', `吸附到 ${event.edge}${event.vertical ? `/${event.vertical}` : ''}${event.mirrored ? ' · 镜像' : ''}`);
    } else if (event.type === 'setting') {
      logEvent('snap', `设置 ${event.key} → ${event.value}`);
    } else if (event.type === 'warn') {
      logEvent('warn', event.message);
    } else if (event.type === 'state') {
      const s = event.state;
      statusDot.className = `dot ${s.status === 'ok' ? '' : s.status}`;
      statusText.textContent = describeStatus(s);
      paintState(trackerView(s));
    }
  },
});

/** tracker 状态与 /api/state 响应不是同一个形状：这里统一成面板要读的那一份。 */
function trackerView(state) {
  return {
    balance: state.balanceMicro === null ? null : formatAmount(state.balanceMicro),
    todaySpend: state.meta?.todaySpend,
    status: state.status,
    stale: state.stale,
    updatedAt: state.updatedAt,
  };
}

function describeStatus(state) {
  if (state.status === 'ok') return `余额正常 · 每 ${Math.round(intervalMs / 1000)} 秒轮询`;
  if (state.status === 'stale') return `取数抖动，显示最近一次（${state.error?.code ?? ''}）`;
  if (state.status === 'unconfigured') return '未配置 DEEPSEEK_API_KEY';
  if (state.status === 'error') return `取数失败：${state.error?.code ?? ''}`;
  return '等待第一次取数…';
}

function paintState(state) {
  set('s-balance', state.balance === null ? '—' : `¥ ${state.balance}`);
  set('s-spend', state.todaySpend ? `¥ ${state.todaySpend}` : '—');
  set('s-status', state.status + (state.stale ? ' (stale)' : ''));
  set('s-updated', state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—');
}

function set(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

async function loadInitialState() {
  try {
    const response = await fetch('/api/state');
    const payload = await response.json();
    set('provider-hint', payload.provider === 'mock'
      ? '当前是 mock 数据源：没配 DEEPSEEK_API_KEY 也能把整个原型跑起来。'
      : `当前数据源：${payload.provider}`);
    set('foot-provider', `provider ${payload.provider} · 轮询 ${Math.round(intervalMs / 1000)}s`);
    if (payload.settings) widget.setSettings({ ...payload.settings, soundEnabled: true });
    paintState(payload);
  } catch (error) {
    logEvent('warn', `读取初始状态失败：${error.message}`);
  }
}

async function pushMockValue(value) {
  const response = await fetch('/api/mock/next', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const payload = await response.json();
  if (!response.ok) logEvent('warn', `mock 推进失败：${payload.code ?? response.status}`);
  return payload;
}

async function currentValue() {
  const response = await fetch('/api/state');
  const payload = await response.json();
  return payload.balanceMicro === null ? parseAmount('0') : BigInt(payload.balanceMicro);
}

document.querySelectorAll('[data-mock]').forEach((button) => {
  button.addEventListener('click', async () => {
    const kind = button.dataset.mock;
    if (kind === 'fail') {
      const response = await fetch('/api/mock/next', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fail: 'timeout' }),
      });
      const payload = await response.json();
      logEvent('state', `已安排一次失败，状态：${payload.status}`);
      paintState(payload);
      return;
    }
    const delta = kind === 'spend' ? parseAmount('0.42') : parseAmount('50');
    const next = await currentValue() + delta;
    const payload = await pushMockValue(formatAmount(next < 0n ? 0n : next, { decimals: 2 }));
    logEvent('state', `${kind === 'spend' ? '扣费' : '充值'} → ¥${payload.balance}（今日已用 ¥${payload.todaySpend}）`);
    paintState(payload);
  });
});

document.getElementById('apply-value').addEventListener('click', async () => {
  const raw = document.getElementById('set-value').value.trim();
  try {
    const micro = parseAmount(raw);
    const payload = await pushMockValue(formatAmount(micro, { decimals: 2 }));
    logEvent('state', `手动设为 ¥${payload.balance}`);
  } catch (error) {
    logEvent('warn', `金额无法解析：${error.message}`);
  }
});

document.querySelectorAll('[data-setting]').forEach((button) => {
  button.addEventListener('click', async () => {
    const key = button.dataset.setting;
    const current = widget.getSettings();
    const next = { ...current, [key]: !current[key] };
    widget.setSettings({ [key]: next[key] });
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [key]: next[key] }),
    });
    const payload = await response.json();
    logEvent('snap', `${key} → ${next[key]}（已保存：${response.ok}）`);
    if (!response.ok) logEvent('warn', JSON.stringify(payload.errors ?? payload));
  });
});

const scaleRange = document.getElementById('scale-range');
scaleRange.addEventListener('input', () => {
  const scale = Number(scaleRange.value);
  document.getElementById('scale-out').textContent = scale.toFixed(2);
  widget.setSettings({ scale });
});
scaleRange.addEventListener('change', async () => {
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scale: Number(scaleRange.value) }),
  });
  logEvent('snap', `大小 → ${Number(scaleRange.value).toFixed(2)}（已保存）`);
});

// E2E 与二次开发用的句柄
window.__dshw = { widget, source, mountWhale, createApiSource };

await loadInitialState();
logEvent('state', `挂件已挂载在右下角，轮询间隔 ${Math.round(intervalMs / 1000)} 秒`);
