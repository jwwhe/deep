import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { apply, hostEnv, PLUGIN_ID, name, inject } from '../lib/index.js';
import { mergeWallets } from '../src/core/wallets.js';
import { tempDir } from './helpers/tmp.js';

const LOOPBACK = '127.0.0.1';
const HOST = '127.0.0.1:3080';
const BALANCE_URL = `http://${HOST}/dsh-whale/balance.json`;

const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

function pluginEnv(overrides = {}) {
  return {
    DSHW_DATA_DIR: tempDir('plugin'),
    DSHW_LOG_LEVEL: 'silent',
    DSHW_INTERVAL_MS: '3600000',
    DEEPSEEK_API_KEY: '',
    DSH_HOME: '',
    DSH_CLIENT_VERSION: '',
    ...overrides,
  };
}

/** 最小 cordis 假宿主：只实现本插件真正用到的那几个 API，用多了这里就会露出来。 */
function createFakeCtx(services = {}, { config = {}, env = {}, strict = false } = {}) {
  // 真宿主里 connection 是核心 bundle 提供的，放行本机已登录会话；
  // 要建模「连接服务还没起来」的冷启动窗口，调用方显式传 connection: null。
  services = { connection: { admit: () => ({}) }, ...services };
  const routes = [];
  const listeners = new Map();
  const teardowns = [];
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route);
        return () => {
          const at = routes.indexOf(route);
          if (at !== -1) routes.splice(at, 1);
        };
      },
    },
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((fn) => fn !== handler));
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
    effect(fn) {
      const teardown = fn();
      if (typeof teardown === 'function') teardowns.push(teardown);
    },
    get(key) {
      return services[key];
    },
  };
  // strict 模拟真实 cordis：读一个没 inject、也没注册的服务不是返回 undefined，而是抛错。
  const host = strict
    ? new Proxy(ctx, {
        get: (target, prop, receiver) => {
          if (prop in target) return Reflect.get(target, prop, receiver);
          throw new Error(`cannot get property "${String(prop)}" without inject`);
        },
      })
    : ctx;
  const attached = apply(host, config, { env: pluginEnv(env), logger: silentLogger });
  return {
    ctx,
    routes,
    services: attached,
    dispose: () => {
      while (teardowns.length > 0) teardowns.pop()();
    },
  };
}

function fakeReq({ method = 'GET', url, headers = {}, remoteAddress = LOOPBACK, body = null }) {
  const stream = body === null ? Readable.from([]) : Readable.from([Buffer.from(body)]);
  return Object.assign(stream, {
    method,
    url,
    headers: { host: HOST, ...headers },
    socket: { remoteAddress },
  });
}

function fakeRes() {
  const res = { statusCode: 0, headers: null, chunks: [], ended: false };
  res.writeHead = (status, headers) => {
    res.statusCode = status;
    res.headers = headers;
  };
  res.end = (chunk) => {
    if (chunk !== undefined) res.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    res.ended = true;
  };
  res.body = () => Buffer.concat(res.chunks).toString('utf8');
  res.json = () => JSON.parse(res.body());
  return res;
}

/** 走真实的路由 handler：node req/res 进、写回 res 出，和宿主里跑的是同一条路径。 */
async function request(fake, { method = 'GET', url = BALANCE_URL, headers = {}, body = null, remoteAddress = LOOPBACK } = {}) {
  const res = fakeRes();
  await fake.routes[0].handler(fakeReq({ method, url, headers, body, remoteAddress }), res);
  return res;
}

/** 挂载后宿主的第一次取数是并发的：GET 只读状态，先等这一拍落地再断言数值。 */
async function settled(fake) {
  await fake.services.tracker.refresh();
  return fake;
}

function accountService(result) {
  return { deepseekAccount: { getBalance: async () => (typeof result === 'function' ? result() : result) } };
}

const ready = (normal, bonus = []) => ({ status: 'ready', value: normal, bonusWallets: bonus });

test('cordis 契约导出：name / inject / apply', () => {
  assert.equal(name, PLUGIN_ID);
  assert.deepEqual(inject, ['webServer']);
  assert.equal(typeof apply, 'function');
});

// 逐行照抄 @deepseek-ai/cordis-plugin-loader/lib/index.js 的 unwrapExports()。
// 它**先取 default**，所以 default 是裸函数时模块上的 inject / name 会被整体丢掉：
// 真机里表现为插件激活失败（读 ctx.webServer 属于「没 inject 就读」），右下角什么都没有，
// 而只查命名导出的测试全绿。上一版的 404 就是这么来的。
function unwrapExports(exports) {
  if (exports == null) return exports;
  exports = exports.default ?? exports;
  if (!exports.__esModule) return exports;
  return exports.default ?? exports;
}

test('经真 Loader 的解包规则后 inject / name 仍然在', async () => {
  const namespace = await import('../lib/index.js');
  const plugin = unwrapExports(namespace);
  assert.equal(typeof plugin?.apply, 'function', 'Loader 解包后拿不到 apply');
  assert.deepEqual(plugin.inject, ['webServer'], 'default 导出把 inject 丢了');
  assert.equal(plugin.name, PLUGIN_ID);

  // 反例守住修法：裸函数 default 会被解包成函数本身，inject 直接消失。
  assert.equal(unwrapExports({ default: apply }).inject, undefined);
});

test('宿主上下文缺少 webServer 时响亮失败，而不是静默不挂载', () => {
  assert.throws(() => apply({}, {}, { env: pluginEnv(), logger: silentLogger }), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, RegExp(PLUGIN_ID));
    assert.match(error.message, /webServer/);
    return true;
  });
});

test('注册 /dsh-whale prefix 路由，并按宿主字段名回余额', async () => {
  const fake = createFakeCtx(accountService(ready([{ currency: 'CNY', balance: '88.50' }], [{ currency: 'CNY', balance: '1.25' }])));
  try {
    assert.equal(fake.routes.length, 1);
    assert.equal(fake.routes[0].kind, 'prefix');
    assert.equal(fake.routes[0].path, '/dsh-whale');
    assert.equal(fake.services.config.effectiveProvider, 'host');

    await settled(fake);
    const res = await request(fake);
    assert.equal(res.statusCode, 200);
    const payload = res.json();
    // 官网的「余额」行只算充值钱包，赠送是另一行；这里默认跟官网一致，不再把两笔钱加成一个数。
    assert.equal(payload.totalBalance, '88.50');
    assert.equal(payload.bonusBalance, '1.25');
    assert.equal(payload.bonusIncluded, false);
    assert.equal(payload.ok, true);
    assert.equal(payload.currency, 'CNY');
  } finally {
    fake.dispose();
  }
});

test('includeBonus:true 才把赠送并进总数，并标明余额已含赠送', async () => {
  const fake = createFakeCtx(
    accountService(ready([{ currency: 'CNY', balance: '88.50' }], [{ currency: 'CNY', balance: '1.25' }])),
    { config: { includeBonus: true } },
  );
  try {
    await settled(fake);
    const payload = (await request(fake)).json();
    assert.equal(payload.totalBalance, '89.75');
    assert.equal(payload.bonusBalance, '1.25');
    assert.equal(payload.bonusIncluded, true);
  } finally {
    fake.dispose();
  }
});

test('今日已用按「充值 + 赠送」总额记账，不受显示口径影响', async () => {
  // 赠送钱包被扣掉时充值余额可以不动：只显示充值余额时按显示值算差值会漏记这一段消费。
  const wallets = [{ currency: 'CNY', balance: '10.00' }];
  const bonus = [{ currency: 'CNY', balance: '2.00' }];
  let phase = 0;
  const fake = createFakeCtx(accountService(() => (phase === 0 ? ready(wallets, bonus) : ready(wallets, [{ currency: 'CNY', balance: '1.00' }]))));
  try {
    await settled(fake);
    phase = 1;
    await fake.services.tracker.refresh();
    const state = (await request(fake, { url: `http://${HOST}/dsh-whale/state.json` })).json();
    assert.equal(state.todaySpend, '1.00');
    assert.equal(state.balance, '10.00', '显示值仍然只是充值余额');
    assert.equal(state.bonus, '1.00');
  } finally {
    fake.dispose();
  }
});

test('宿主属性访问会抛错的 cordis 语义下依然能挂载并回余额', async () => {
  // 真机探针里的 400 就是这么来的：未注册的 ctx.connection 抛错而不是返回 undefined。
  // 只要 handler 还退回属性访问，每一个请求都会被宿主兜成 400。
  const fake = createFakeCtx(accountService(ready([{ currency: 'CNY', balance: '12.34' }])), { strict: true });
  try {
    await settled(fake);
    const res = await request(fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().totalBalance, '12.34');
  } finally {
    fake.dispose();
  }
});

test('入口脚本能被取到，命名空间外的路径不进挂件 handler', async () => {
  const fake = createFakeCtx();
  try {
    const entry = await request(fake, { url: `http://${HOST}/dsh-whale/widget.js` });
    assert.equal(entry.statusCode, 200);
    assert.match(entry.headers['content-type'], /javascript/);
    assert.match(entry.body(), /mountWhale/);

    // 立绘是挂件唯一自带的图片，宿主前缀下必须取到，否则真机上就是一个藏掉的形象层。
    const art = await request(fake, { url: `http://${HOST}/dsh-whale/widget/whale-girl.png` });
    assert.equal(art.statusCode, 200);
    assert.equal(art.headers['content-type'], 'image/png');

    const outside = await request(fake, { url: `http://${HOST}/api/state` });
    assert.equal(outside.statusCode, 404);
    assert.equal(outside.json().code, 'not-dsh-route');
  } finally {
    fake.dispose();
  }
});

test('index-inject 表里挂一条能自挂载的 script row，且文本不含标签字符', async () => {
  const fake = createFakeCtx();
  try {
    const table = [];
    fake.ctx.emit('webserver/index-inject', table);
    assert.equal(table.length, 1);
    assert.equal(table[0].kind, 'script');
    assert.equal(table[0].placement, 'body');
    assert.match(table[0].text, /import\('\/dsh-whale\/widget\.js'\)/);
    // 宿主把 row.text 原样放进 <script>...</script>，出现 </ 或注释起始符就能越出脚本上下文。
    assert.ok(!table[0].text.includes('</'), '注入文本不能包含结束标签序列');
    assert.ok(!table[0].text.includes('<!--'), '注入文本不能包含注释起始符');
  } finally {
    fake.dispose();
  }
});

test('宿主的第二次取数之前，首次读取如实报 idle 而不是错误', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fake = createFakeCtx(accountService(async () => {
    await gate;
    return ready([{ currency: 'CNY', balance: '5.00' }]);
  }));
  try {
    const first = await request(fake);
    assert.equal(first.statusCode, 200);
    const payload = first.json();
    assert.equal(payload.status, 'idle');
    assert.equal(payload.totalBalance, null);
    assert.equal(payload.ok, false);
    // 等待中的这一拍不该累加退避计数，否则挂件会把「正在取」当成「取不到」。
    const waiting = (await request(fake, { url: `http://${HOST}/dsh-whale/state.json` })).json();
    assert.equal(waiting.status, 'idle');
    assert.equal(waiting.consecutiveFailures, 0);
    assert.equal(waiting.pending, false);
    release();
    await settled(fake);
    assert.equal((await request(fake)).json().totalBalance, '5.00');
  } finally {
    fake.dispose();
  }
});

test('admit 拒绝的请求不进 handler', async () => {
  const cases = [
    [{ rejection: 401 }, 401, 'unauthenticated'],
    [{ rejection: 403 }, 403, 'forbidden-origin'],
  ];
  for (const [admission, status, code] of cases) {
    // strict 那一趟证明：真实 cordis 上连接服务是经 ctx.get 取到的，不是属性访问。
    for (const strict of [false, true]) {
      const fake = createFakeCtx({ connection: { admit: () => admission } }, { strict });
      try {
        const res = await request(fake);
        assert.equal(res.statusCode, status, strict ? 'strict ctx' : 'plain ctx');
        assert.equal(res.json().code, code);
      } finally {
        fake.dispose();
      }
    }
  }
});

test('连接服务尚未就绪时拒绝而不是放行（冷启动那两百毫秒）', async () => {
  // 真机实测出来的缺陷：引擎端口刚监听时 dsh-client-connection 还没注册，
  // 不带会话的本地请求照样从 balance.json 拿到 200 和真实金额。缺席必须当成「不放行」。
  const fake = createFakeCtx({
    connection: null,
    ...accountService(ready([{ currency: 'CNY', balance: '9999.00' }])),
  });
  try {
    const res = await request(fake);
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().code, 'guard-unavailable');
    assert.ok(!res.body().includes('9999.00'), '拒绝的响应里不能带金额');
    assert.ok(!res.body().includes('totalBalance'), '拒绝的响应不该是余额载荷');

    // 静态入口同样走这条门禁：宁可让挂件多等一拍，也不在没校验的时候开门。
    const entry = await request(fake, { url: `${BALANCE_URL.replace('/balance.json', '/widget.js')}` });
    assert.equal(entry.statusCode, 503);
  } finally {
    fake.dispose();
  }
});

test('连接服务晚到也能恢复放行：缺席不缓存', async () => {
  let connection = null;
  const routes = [];
  const ctx = {
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
    on: () => () => {},
    effect: (fn) => fn(),
    get: (key) => (key === 'connection' ? connection : undefined),
  };
  const attached = apply(ctx, {}, { env: pluginEnv(), logger: silentLogger });
  try {
    assert.equal((await request({ routes, services: attached })).statusCode, 503, '连接服务缺席时先拒绝');
    connection = { admit: () => ({}) };
    assert.equal((await request({ routes, services: attached })).statusCode, 200, '服务起来后同一条 handler 就放行，不缓存上次的缺席');
  } finally {
    attached.tracker.stop();
  }
});

test('没有账号服务时回落到宿主凭据库里的 API key', async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({ url, auth: options.headers.Authorization });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ is_available: true, balance_infos: [{ total_balance: '42.10', currency: 'CNY' }] }),
    };
  };
  const fake = createFakeCtx({ credentials: { resolve: async (ref) => (ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-test-1234567890' } : undefined) } });
  try {
    await settled(fake);
    const res = await request(fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().totalBalance, '42.10');
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /api\.deepseek\.com\/user\/balance$/);
    assert.equal(seen[0].auth, 'Bearer sk-test-1234567890');
  } finally {
    globalThis.fetch = originalFetch;
    fake.dispose();
  }
});

test('三级来源全空时显示未配置，并说明查过哪些来源', async () => {
  const fake = createFakeCtx({
    ...accountService(null),
    credentials: { resolve: async () => undefined },
  });
  try {
    await settled(fake);
    const res = await request(fake);
    assert.equal(res.statusCode, 200);
    const payload = res.json();
    assert.equal(payload.status, 'unconfigured');
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'no-balance-source');
    assert.match(payload.error.message, /DeepSeek/);
  } finally {
    fake.dispose();
  }
});

test('账号服务抛错不会被当成未登录悄悄吞掉', async () => {
  const fake = createFakeCtx(accountService(() => {
    throw new Error('grant expired');
  }));
  try {
    await settled(fake);
    const payload = (await request(fake)).json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'account-throw');
    assert.match(payload.error.message, /grant expired/);
  } finally {
    fake.dispose();
  }
});

test('config 显式写 includeBonus:false 时结果与默认一致', async () => {
  const fake = createFakeCtx(
    accountService(ready([{ currency: 'CNY', balance: '10' }], [{ currency: 'CNY', balance: '5' }])),
    { config: { includeBonus: false } },
  );
  try {
    await settled(fake);
    const res = await request(fake);
    assert.equal(res.json().totalBalance, '10.00');
    assert.equal(res.json().bonusBalance, '5.00');
  } finally {
    fake.dispose();
  }
});

test('DSH_HOME 存在且没显式给数据目录时，配置落进 harness 的家', () => {
  const home = path.join(os.tmpdir(), 'dshw-home');
  assert.equal(hostEnv({ DSH_HOME: home }).DSHW_DATA_DIR, path.join(home, 'whale-widget'));
  assert.equal(hostEnv({ DSH_HOME: home, DSHW_DATA_DIR: 'D:/elsewhere' }).DSHW_DATA_DIR, 'D:/elsewhere');
  assert.equal(hostEnv({}).DSHW_DATA_DIR, undefined);
});

test('mergeWallets 的边界：未登录、失败、空列表、坏金额、多币种', () => {
  assert.equal(mergeWallets(null).code, 'not-signed-in');
  assert.equal(mergeWallets({ status: 'failed' }).code, 'account-balance-failed');
  assert.equal(mergeWallets({ status: 'ready', value: [], bonusWallets: [] }).code, 'empty-wallets');
  assert.equal(mergeWallets({ status: 'ready', value: [{ currency: 'CNY', balance: 'abc' }] }).code, 'bad-wallet-amount');
  assert.equal(mergeWallets(ready([{ currency: 'CNY', balance: '1' }], [{ currency: 'CNY', balance: 'x' }])).code, 'bad-wallet-amount');

  const ok = mergeWallets(ready([{ currency: 'CNY', balance: '0.1' }], [{ currency: 'CNY', balance: '0.2' }]));
  assert.equal(ok.ok, true);
  assert.equal(ok.balanceMicro, 10000000n, '默认只显示充值钱包');
  assert.deepEqual(
    { paid: ok.meta.paidMicro, bonus: ok.meta.bonusMicro, total: ok.meta.totalMicro },
    { paid: 10000000n, bonus: 20000000n, total: 30000000n },
  );
  assert.equal(ok.note, undefined);

  // 只有赠送钱包的账号（没充过值）不该被当成「上游形状不对」，如实显示 0 元 + 赠送。
  const giftOnly = mergeWallets(ready([], [{ currency: 'CNY', balance: '3.00' }]));
  assert.equal(giftOnly.balanceMicro, 0n);
  assert.equal(giftOnly.meta.bonusMicro, 300000000n);

  const multi = mergeWallets({ status: 'ready', value: [{ currency: 'CNY', balance: '3' }, { currency: 'USD', balance: '9' }] });
  assert.equal(multi.ok, true);
  assert.equal(multi.currency, 'USD');
  assert.match(multi.note, /多币种/);
});
