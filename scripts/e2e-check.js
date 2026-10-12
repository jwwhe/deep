// 端到端冒烟：真的把 npm start 那条命令拉起来，再按 README 里承诺的每条路径逐一验收。
// 与 node --test 的分工：单测管规则，这里管「装完到底能不能跑起来」。
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOT_TIMEOUT_MS = 8000;

let failures = 0;
let checks = 0;

function ok(name, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let lastError = '未开始';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return true;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`  · 等待 ${base} 就绪超时：${lastError}`);
  return false;
}

async function main() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-e2e-'));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'src/server/start.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DSHW_PORT: String(port),
      DSHW_DATA_DIR: dataDir,
      DSHW_PROVIDER: 'mock',
      DSHW_INTERVAL_MS: '3000',
      DSHW_LOG_LEVEL: 'silent',
    },
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    console.log(`\n鲸鱼娘挂件 · 端到端检查（${base}，数据目录 ${dataDir}）\n`);

    ok('进程启动并通过 /healthz', await waitForHealth(base));

    console.log('资源与 404：');
    const home = await fetch(`${base}/`);
    const html = await home.text();
    ok('GET / 返回 HTML', home.status === 200 && /<script type="module"/.test(html), `HTTP ${home.status}`);

    // 页面自己引用了什么就检查什么，不靠人肉维护清单。
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
      .filter((ref) => ref.startsWith('/') && !ref.startsWith('//'));
    for (const ref of refs) {
      const response = await fetch(`${base}${ref}`);
      ok(`页面引用 ${ref}`, response.status === 200, `HTTP ${response.status}`);
    }

    const modules = [
      '/widget/whale.js', '/widget/state.js', '/widget/skin.js', '/widget/audio.js',
      '/core/money.js', '/core/layout.js', '/core/balance.js', '/core/ledger.js',
    ];
    for (const ref of modules) {
      const response = await fetch(`${base}${ref}`);
      ok(`挂件模块 ${ref}`, response.status === 200, `HTTP ${response.status}`);
    }

    // 素材 URL 由 skin.js 里的 import.meta.url 推出，两条挂载前缀都要能取到，否则真机上形象层会被藏掉。
    // 仓库里只有这一张图，取不到就是取不到 —— 没有备用素材可回落。
    for (const asset of ['/widget/whale-girl.png', '/dsh-whale/widget/whale-girl.png']) {
      const response = await fetch(`${base}${asset}`);
      const isPng = (response.headers.get('content-type') || '').startsWith('image/');
      ok(`素材 ${asset}`, response.status === 200 && isPng, `HTTP ${response.status} ${response.headers.get('content-type')}`);
    }

    const missing = await fetch(`${base}/no-such-file.js`);
    ok('不存在的路径返回 404', missing.status === 404, `HTTP ${missing.status}`);
    // fetch 会先把 ../ 归一化，所以这条实际验的是「服务端目录结构不外露」；
    // 真正的穿越用例在 test/static.test.js 里直接打 resolveStaticPath。
    const escaped = await fetch(`${base}/src/server/config.js`, { redirect: 'manual' });
    ok('服务端源码不作为静态资源提供', escaped.status === 404, `HTTP ${escaped.status}`);
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    ok('HEAD / 不返回实体', head.status === 200 && (await head.text()) === '', `HTTP ${head.status}`);

    console.log('\nDSH 宿主契约（/dsh-whale/*）：');
    for (const ref of ['/dsh-whale/widget.js', '/dsh-whale/widget/whale.js', '/dsh-whale/widget/dsh-source.js', '/dsh-whale/core/money.js']) {
      const response = await fetch(`${base}${ref}`);
      ok(`宿主路径 ${ref}`, response.status === 200, `HTTP ${response.status}`);
    }
    const dshState = await (await fetch(`${base}/dsh-whale/balance.json`)).json();
    ok('balance.json 用宿主字段名', typeof dshState.totalBalance === 'string', `totalBalance=${dshState.totalBalance}`);
    ok('balance.json 带今日已用', typeof dshState.todayUsed === 'string', `todayUsed=${dshState.todayUsed}`);
    ok('没有赠送钱包时 bonusBalance 为 null', dshState.bonusBalance === null, `bonusBalance=${dshState.bonusBalance}`);
    ok('未知宿主接口 404', (await fetch(`${base}/dsh-whale/nope.json`)).status === 404);
    ok('模拟注入页可访问', (await fetch(`${base}/dsh.html`)).status === 200);

    console.log('\n接口与记账：');
    const state0 = await (await fetch(`${base}/api/state`)).json();
    ok('GET /api/state 有余额', typeof state0.balance === 'string' && state0.status === 'ok', `balance=${state0.balance}`);

    await fetch(`${base}/api/mock/next`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: '99.99' }) });
    const state1 = await (await fetch(`${base}/api/state`)).json();
    ok('推进 mock 后余额更新', state1.balance === '99.99', `balance=${state1.balance}`);
    const spend = Number(state1.todaySpend);
    ok('今日已用按余额差记账', Number.isFinite(spend) && spend > 0, `todaySpend=${state1.todaySpend}`);

    const badValue = await fetch(`${base}/api/mock/next`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'abc' }) });
    ok('非法金额被挡在 400', badValue.status === 400, `HTTP ${badValue.status}`);

    const badJson = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    ok('坏 JSON 被挡在 400', badJson.status === 400, `HTTP ${badJson.status}`);

    const notAllowed = await fetch(`${base}/api/state`, { method: 'DELETE' });
    ok('未支持的方法返回 405', notAllowed.status === 405, `HTTP ${notAllowed.status}`);

    console.log('\n设置持久化：');
    const saved = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scale: 1.4, nope: 7 }) });
    const savedBody = await saved.json();
    ok('POST /api/settings 接受合法字段', saved.ok && savedBody.settings.scale === 1.4, JSON.stringify(savedBody.settings));
    ok('未知字段进 ignored 而不是静默丢弃', Array.isArray(savedBody.ignored) && savedBody.ignored.includes('nope'), JSON.stringify(savedBody.ignored));
    const settingsFile = path.join(dataDir, '.dshw-settings.json');
    ok('设置已落盘', fs.existsSync(settingsFile));
    const echo = await (await fetch(`${base}/api/state`)).json();
    ok('重启前的状态里能看到设置', echo.settings.scale === 1.4);

    console.log('\n优雅关闭：');
    child.kill('SIGTERM');
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 4000);
      child.once('exit', (exitCode) => { clearTimeout(timer); resolve(exitCode); });
    });
    if (process.platform === 'win32') {
      // Windows 上 child.kill('SIGTERM') 走 TerminateProcess，信号处理函数根本不会跑，
      // 所以这里只能验「进程确实退出了」；退出码为 0 的优雅关闭要在 POSIX 上验。
      ok('进程已退出（Windows：只验退出，不验优雅）', code !== 'timeout', `exit=${code}`);
    } else {
      ok('SIGTERM 后进程退出', code === 0, `exit=${code}`);
    }
    ok('关闭过程无 stderr 输出', stderr.trim() === '', stderr.trim().slice(0, 200));
  } finally {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? '全部通过' : '存在失败'}：${checks - failures}/${checks} 项\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('端到端检查自身出错：', error);
  process.exit(1);
});
