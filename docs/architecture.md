# 架构简述

## 一、三条分层线

代码只有一条依赖方向：**`core` ← `widget` / `server`**，`core` 谁都不依赖。

```
src/core/     纯逻辑。无 DOM、无 Node API、无 fetch。浏览器和 Node 直接共用同一批文件。
  money.js      BigInt 定点金额：1e-8 元为最小单位（SCALE = 100000000n）
  layout.js     视口/尺寸/边距 → 坐标；吸附边判定
  ledger.js     按自然日记账：首次观测、消耗、充值（回升）分别怎么处理
  balance.js    轮询状态机：idle / ok / stale / error / unconfigured
  jsonpath.js   只支持 `a.b[0].c` 这种最小路径语法，用于兼容上游多种响应结构

src/widget/   渲染与手势。DOM 胶水，不含业务规则。
  whale.js      挂载、拖拽、吸附、缩放、菜单、数字滚动
  skin.js       鲸鱼 SVG + 挂件样式（注入式，宿主不需要额外 CSS 文件）
  state.js      createApiSource：把 /api/state 读成 tracker 认识的 provider 结果
  audio.js      提示音（WebAudio，可关）
  dsh-source.js createDshSource：同上，只是走宿主契约的 /dsh-whale/*.json

src/server/   handler 与接线。
  app.js        纯请求处理器：入一个描述请求的对象，回一个响应对象，不碰 http
  config.js     环境变量 → 配置，非法值启动即抛错
  static.js     URL 前缀 → 磁盘路径 + 目录包含检查
  store.js      原子写落盘（先 .tmp 再 rename）
  env.js        .env 读取，只填进程环境里还没有的键
  providers/    deepseek.js（真实上游）、mock.js（无密钥也能跑）
  dsh-routes.js 宿主契约 ↔ 内部 handler 的双向翻译
  start.js      http.createServer + 信号关闭 + createServices（被 lib/index.js 复用）
```

`createApp` 不 import `http`、不 import `fs` 之外的 Node 专有物，所以路由、校验、回环边界全部能在
`node --test` 里直接调用，不必起端口 —— 这是 123 条单测跑得快的原因。

## 二、免打包的关键：同一份源码在两边都能解析

前端模块写的是**相对路径** `import '../core/money.js'`。

| 环境 | 解析基准 | 解析结果 |
| --- | --- | --- |
| Node（`src/widget/whale.js`） | 文件位置 | `src/core/money.js` ✅ |
| 浏览器（演示页，脚本 URL `/widget/whale.js`） | 脚本 URL | `/core/money.js` → 静态映射到 `src/core/money.js` ✅ |
| 浏览器（DSH 宿主，脚本 URL `/dsh-whale/widget/whale.js`） | 脚本 URL | `/dsh-whale/core/money.js` → 同一批文件 ✅ |

`static.js` 里那张前缀表（`/core/`、`/widget/`、`/static/` + 兜底 `public/`）就是这套约定的服务端一侧；
`dsh-routes.js` 的 `dshPrefixes()` 只是把同一套映射换个前缀再登记一遍（`/dsh-whale/core/` 等）。
**因此整个项目没有任何构建步骤**，改完刷新即可见。

这条链是脆的（前缀表和相对路径必须同时改对），所以 `test/dsh.test.js` 里有一条专门用 `new URL()`
把入口脚本的相对 import 逐层解析出来再逐个请求 200 —— 它代替了打包器。

## 三、数据流

```
                       ┌────────────  服务端  ────────────┐
DEEPSEEK_API_KEY ──▶ config ──▶ provider.fetchBalance ──▶ balance tracker
   (只发往 upstreamBaseUrl)        deepseek | mock            │ subscribe
                                                              ▼
                                                    ledger（今日已用）+ store 落盘
                                                              │
                                             publicState() ──▶ /api/state · /dsh-whale/balance.json
                                                              ▲
                       └──────  浏览器 / DSH 界面  ───────────┘
                                        │
              state.js / dsh-source.js 读 JSON ──▶ createBalanceTracker（同一份状态机）
                                        │
                                        ▼
                              whale.js：数字滚动 / 拖拽吸附 / 菜单 / 音效
```

要点：

- **同一份状态机用两次**。服务端拿它轮上游，客户端拿它轮 `/api/state`。于是「上游抖动时沿用最近余额并标
  `stale`」「指数退避 2s→30s 且不超过 interval」「并发去重（`inFlight`）」这三条规则只有一份实现，
  服务端和挂件的行为不会分叉。
- **金额全程 BigInt 定点**，只在最后的展示层转字符串。JSON 里 `balanceMicro` 是字符串，避免浮点漂移；
  `parseAmount` 用 half-up 收敛到 1e-8。
- **今日已用**由 `ledger.js` 按自然日记账，观测分五类：`baseline / unchanged / spend / adjustment / rollover`。
  余额下降才累进 `spendMicro`，上升只累进 `adjustmentMicro`，且基线跟着每次观测移动 ——
  所以「上游偶发返回更大的数」不会被算成负消耗；跨天时新一天从当前余额重新起算，昨天累计原样保留。
- **provider 的失败分类是显式的**：`auth-failed`/`insufficient` 不可重试、`rate-limited`/`5xx`/`timeout` 可重试、
  `no-api-key` 归为 `unconfigured`（配置状态，不伪装成网络抖动）。这些分类一路透传到挂件文案。

## 四、可测性靠注入

`fetcher / now / schedule / unschedule / logger / fetchImpl / resolveStatic / register` 都是参数。
测试里给假时钟和假定时器，就能验证退避序列、并发去重和 stale 语义，而不必 sleep。
生产路径用默认值（真 `setTimeout`、真 `fetch`），默认值本身也在这里列着，没有隐藏的全局单例。

## 五、安全边界的落点

| 边界 | 实现位置 |
| --- | --- |
| 凭据只从环境变量来，日志/响应只回掩码 | `config.js`（`apiKey`、`maskSecret`），`start.js` 启动行 |
| 写操作只允许回环（远端需显式白名单） | `app.js` `canWrite()`，`dsh-routes.js` 复用同一个 `app.handle` 所以规则只有一份 |
| 静态资源不许越出登记目录 | `static.js` `candidate()`：解码 → 空字节拒绝 → `path.resolve` 后做目录包含检查（Windows 大小写折叠） |
| 上游地址可变但后果写明 | `config.js` 默认锁 `https://api.deepseek.com`；风险写在 `.env.example` 与 README |
| mock 接口的 `fail` code 白名单 | `app.js`：`/^[A-Za-z0-9_-]{1,32}$/`，因为它会被回显进响应和日志 |
| 请求体上限 | `start.js`：64 KB，超出直接 `too-large` 并断流 |

## 六、DSH 适配层为什么只有接缝

`lib/index.js` 的 `install({ register })` 把 `register` 设成**必填**，缺了抛 `TypeError`。
原因很实际：本机没有 `dsh` CLI，拿不到宿主，任何具体的注册签名都是猜。与其写一个「装了但右下角
什么都没有」的猜测实现（参考项目 issue #162 里最难查的一类故障），不如把唯一没验证的点做成一个会响的洞，
并把已验证的部分指到具体测试文件上。`cordis.patch.yml` 同理 —— 形状抄自参考项目，未真机验证，文件里写明了。
