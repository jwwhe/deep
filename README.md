# 鲸鱼娘余额挂件 · 可运行原型（dsh-whale-widget-proto）

挂在界面右下角的一只鲸鱼娘：显示 DeepSeek 账户余额与今日已用，可以拖拽吸附到四边/角落、
贴左时自动镜像翻转、余额变动时数字逐帧滚动。

定位参考开源项目 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)，
实现思路与目录结构见 [`docs/architecture.md`](docs/architecture.md)，来源说明见 [`PROVENANCE.md`](PROVENANCE.md)。

**它是什么**：一个零依赖、无构建步骤的前端/全栈原型 —— 装上就能跑，没配密钥也能用 mock 数据看到完整交互。
**它不是什么**：没有用户体系与鉴权、不做多租户、不接付费，也不是生产级部署方案（详见 [`docs/limitations.md`](docs/limitations.md)）。

---

## 30 秒跑起来

```bash
cd dsh-whale-widget-proto        # 项目根目录，后面的命令都在这里执行
cp .env.example .env             # 可选：没有 .env 也能直接启动，全部走默认值
npm start                        # 零依赖，连 npm install 都不用
```

打开 <http://127.0.0.1:3080/> —— 鲸鱼娘出现在右下角，演示面板可以拖她、缩放、改余额看数字滚动。

```
鲸鱼娘余额挂件 v0.1.0 已启动
  界面      http://127.0.0.1:3080/
  状态      http://127.0.0.1:3080/api/state
  provider  mock · DEEPSEEK_API_KEY 未配置
  数据目录  C:\Users\<you>\AppData\Local\Temp\dshw-proto
  提示：未检测到 DEEPSEEK_API_KEY，当前用 mock 数据驱动原型；配好 key 后重启即接真实余额。
```

**环境要求**：Node.js ≥ 20.10（实测 v22.18.0）。`npm test` 传的是 glob 参数，需要 Node ≥ 21。
无运行依赖、无构建步骤、无包管理器 lockfile 之外的东西 —— `dependencies` 与 `devDependencies` 都是空的。

**关于这只鲸鱼长什么样**：`src/widget/whale-girl.png` 是**仓库里唯一的一张形象图**（`public/favicon.svg`
是演示页的标签页图标，与形象无关）—— 深蓝渐变长发、女仆装、鲸鳍耳加一条鲸尾的**Q 版（大头）全身立绘**，
由本项目作者用 AI 生成，再从一张三视图设定表里裁出正面视图、抠成透明底并去掉脚下投影
（610×610 RGBA，551 kB；不透明部分占 536×610，长宽比 0.879），**随下面的 MIT 一起分发**。
参考项目那张 `assets/DSniang1.png` 没有被沿用，理由见
[`PROVENANCE.md`](PROVENANCE.md) 的「美术素材的许可边界」。想换成你自己的形象，二选一：

- 把你的图放成 `src/widget/whale-girl.png`（同样底边对齐、透明底，效果最接近）；
- 或改 `src/widget/skin.js` 的 `CHARACTER_URL` 指向任意图片 URL —— 交互逻辑不依赖这张图。

立绘取不到时（路径写错、素材被删）挂件会把形象层整层藏掉并在 console 警告一次，只留余额卡片，
不会留一个裂图图标 —— 仓库里没有第二张形象图可回落。

- 把你的图放成 `src/widget/whale-girl.png`（同样底边对齐、透明底，效果最接近）；
- 或改 `src/widget/skin.js` 的 `CHARACTER_URL` 指向任意图片 URL —— 交互逻辑不依赖这张图。

立绘取不到时（路径写错、素材被删）挂件会把形象层整层藏掉并在 console 警告一次，只留余额卡片，
不会留一个裂图图标 —— 仓库里没有第二张形象图可回落。

**接真实余额**：把 `.env` 里的 `DEEPSEEK_API_KEY` 填上（在 <https://platform.deepseek.com/api_keys> 申请）后重启。
provider 会自动从 `mock` 切到 `deepseek`，无需改其他配置。

---

## 验证改动

```bash
npm test          # 138 条单元测试（node:test，不起端口，纯 handler 层）
npm run test:e2e  # 39 项端到端检查：真起进程、真发 HTTP、真读落盘文件
npm run check     # 上面两个连着跑
```

最近一次的真实输出贴在 [`docs/verification.md`](docs/verification.md)，包括浏览器实测数据。

---

## 配置（全部走环境变量）

没有硬编码密钥，没有硬编码私有地址。默认监听 `127.0.0.1`，改法见下表的 `DSHW_HOST`。
`.env` 支持 `KEY=VALUE`、`export KEY=VALUE`、`#` 整行注释；不支持行内注释和变量插值（会原样当字面量）。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 空 | 唯一凭据。留空则 provider 退回 `mock` |
| `DSHW_HOST` / `DSHW_PORT` | `127.0.0.1` / `3080` | 监听地址。**改成 `0.0.0.0` 前请看下面「安全边界」** |
| `DSHW_DATA_DIR` | 系统临时目录下 `dshw-proto` | 外观设置与余额账本的落盘位置 |
| `DSHW_PROVIDER` | `auto` | `auto` \| `deepseek` \| `mock` |
| `DSHW_UPSTREAM_BASE_URL` | `https://api.deepseek.com` | 上游地址。**改了它等于决定密钥发往哪里**，只在你清楚自己在做什么时改 |
| `DSHW_UPSTREAM_TIMEOUT_MS` | `8000` | 上游超时，范围 500~60000 |
| `DSHW_INTERVAL_MS` | `60000` | 轮询间隔，范围 1000~3600000 |
| `DSHW_ADMIN_HOSTS` | 空 | 允许远端写配置的地址名单（逗号分隔）。默认只有回环能写 |
| `DSHW_SCALE` | `1` | 挂件初始缩放，0.5~3 |
| `DSHW_SNAP_MODE` / `DSHW_SNAP_VALUE` | `ratio` / `0.08` | 吸附边距：视口比例或像素（`px`） |
| `DSHW_MIRROR_ON_LEFT` | `1` | 贴左缘时是否水平翻转 |
| `DSHW_HIDE_MENU` | `0` | `1` 则不渲染右键菜单入口 |
| `DSHW_MOCK_SCRIPT` | 空 | mock 回放脚本，逗号分隔金额，`!code` 表示这一拍模拟失败。例：`100,99.5,!timeout,98.0` |
| `DSHW_LOG_LEVEL` | `info` | `silent` 关闭全部 stdout |

配置非法（越界、非整数、provider 名拼错）时**启动即抛错并说明是哪个变量**，不会静默用默认值继续跑。

### 作为 DSH 插件时的差异

| 项 | 来源 | 说明 |
| --- | --- | --- |
| 余额来源 | 宿主服务，不看 `.env` | 三级回落：`ctx.deepseekAccount.getBalance()` → `ctx.credentials.resolve('DEEPSEEK_API_KEY')` → 环境变量 `DEEPSEEK_API_KEY`。每拍重新判定，所以不依赖插件与账号服务的加载顺序 |
| `DSH_HOME` | 宿主注入 | 未显式设 `DSHW_DATA_DIR` 时，落盘目录取 `$DSH_HOME/whale-widget`（独立跑时是系统临时目录） |
| `DSH_CLIENT_VERSION` | 桌面宿主注入 | 作为客户端标识 `client.version` 传给账号服务；取不到时如实标 `0.1.0-prototype` |
| `DSHW_CLIENT_LOCALE` | 可选 | 同上，`client.locale`，默认取系统 locale |
| `includeBonus` | profile 的插件 `config` | 默认 `false`：**只显示充值钱包余额**，与官网/官方设置页的「余额」行同口径；赠送钱包单独作为「赠送 ¥x.xx」一行呈现。设成 `true` 才把两者加成一个总数（那一行会改说「含赠送 ¥x.xx」）。多币种时取金额最大的一族并在日志里说明，不折算汇率 |

「今日已用」始终按**充值 + 赠送的总额**差值记账：赠送钱包被扣掉时充值余额可以一点不动，
只按显示值算差值会把这一段消费漏掉。所以 `includeBonus: false` 时，卡片上的余额与今日已用不是同一个基数，这是有意的。

---

## 接口

自己用（`/api/*`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/healthz` | 存活探针，回 `{ok, version, provider}` |
| GET | `/api/state`（别名 `/api/balance`） | 余额、状态、`stale`、今日已用、当前设置 |
| POST | `/api/refresh` | 立刻取一次上游；上游失败回 502 且带上错误分类 |
| POST | `/api/settings` | 改外观（白名单字段 + 范围校验），落盘；未知字段进 `ignored` 回显 |
| POST | `/api/mock/next` | 仅 mock 可用：`{value}` 钉一个余额，`{fail}` 模拟一次失败 |
| GET/HEAD | `/`、`/core/*`、`/widget/*`、`/static/*` | 演示页与无前缀的 ESM 模块 |

DSH 宿主契约（`/dsh-whale/*`，字段名对齐参考项目实测）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-whale/balance.json` | `{ok, totalBalance, bonusBalance, bonusIncluded, todayUsed, currency, status, stale, error, settings}`，金额为字符串。`totalBalance` 默认只含充值钱包，赠送在 `bonusBalance` |
| GET | `/dsh-whale/state.json` | 内部状态原样 |
| POST | `/dsh-whale/refresh.json` / `/dsh-whale/settings.json` | 同上两条，仍吃回环规则 |
| GET | `/dsh-whale/widget.js` | 前端注入入口，单行 `<script type="module">` 即可自挂载 |
| GET | `/dsh-whale/core/*`、`/widget/*`、`/assets/*` | 无前缀映射的模块，浏览器侧解析 ESM 依赖链 |

`/dsh.html` 是模拟宿主的验证页：整页只有一行 script 标签，用来证明「注入即自挂载」这条路径。

---

## 安全边界（有意为之，不是漏实现）

- **凭据只从环境变量读**，不读宿主/其他工具的密钥文件；日志与所有响应只回 `maskSecret()` 掩码。
- **所有写接口默认只允许回环地址**，否则 403。理由：谁能改配置，就等于谁能决定密钥发往哪里。
  远端管理必须显式写 `DSHW_ADMIN_HOSTS`；把 `DSHW_HOST` 改成 `0.0.0.0` 只是让局域网能*看*，写权限不随之放开。
- 上游地址默认锁官方端点；`/api/mock/next` 的 `fail` code 限 `[A-Za-z0-9_-]{1,32}`，避免接口变成任意字符串注入口。
- 静态解析对 `..`、编码穿越、空字节、非法百分号一律 404，不做重定向（不泄露目录结构）。
- **在 DSH 里，宿主不会自动给插件路由做门禁**，所以本插件自己调 `connection.admit(req)` 校验 Host/Origin 围栏与
  浏览器会话。连接服务**缺席时按不放行处理（503）**，且每个请求现取、不缓存缺席。理由是真机实测：引擎端口刚监听后
  的一两百毫秒里连接服务还没注册，那时 fail-open 会让不带会话的本地请求直接拿到真实余额。

---

## 作为 DSH 插件安装

`lib/index.js` 是一个 cordis 插件（`export function apply(ctx, config)` + `inject: ['webServer']`），
契约按本机桌面安装里的**真包**核实，并分别用真 `dsh-host-webserver`（16/16）和真
`cordis-plugin-loader`（9/9）跑通，见 [`docs/verification.md`](docs/verification.md) 第八节。
挂载声明是根目录的 `cordis.patch.yml`（`package.json` 的 `dsh.bundle.patch` 指向它），插件 id 用
`dsh-whale-widget-proto` 而不是上游的 `dsh-whale-widget`，避免和已发布同名包冲突。

> **导出形状是硬约束**：真 Loader 的 `unwrapExports()` 先取 `default`，所以 `export default apply`
> （裸函数）会让 `inject` 整体丢失，插件在客户端里静默激活失败。本仓库用
> `export default { name, inject, apply }`；改这一行前先看 `test/plugin.test.js` 里那条照抄
> `unwrapExports()` 的用例。

```bash
dsh plugin --profile desktop add link:D:\path\to\dsh-whale-widget-proto   # 源目录改动会同步
dsh plugin --profile web     add link:D:\path\to\dsh-whale-widget-proto
```

`link:` 需要 pnpm 能联网重解析该 profile 里**已有**的依赖；机器拉不动外网时（本机就是这种状况）
可手工做等价动作，客户端启动时读的就是这三样东西：

1. `<profile>/node_modules/dsh-whale-widget-proto` → 指向本目录的 junction；
2. `<profile>/package.json` 的 `dependencies` 补 `"dsh-whale-widget-proto": "link:<本目录绝对路径>"`；
3. 同文件 `dsh.profile.bundles` 末尾追加 `dsh-whale-widget-proto`。

改完**必须完全退出并重启客户端**才生效（运行中的实例不会热加载 profile，注入表也只在宿主 `ready` 时收集一次）。
「完全退出」= 托盘图标右键退出，不是点窗口右上角的 ✕ —— 关窗口只是藏起来，进程还在，此时再点图标会被
Electron 的单实例锁吞掉，看起来就像「客户端打不开」。

**重启以后请耐心等**：本机实测完整客户端启动 **75–92 s**，其中约 74 秒是宿主自己在
CPU 密集地装载 profile 里的 188 个模块（从 121 MB 的 `app.asar` 读），并且要 `await` 完 `desktop-office`
才发 `ready`，Electron 的界面必须等这张注入表。挂件在这几十秒里只占 **67 ms**，不是瓶颈 ——
而且做过摘掉插件的 A/B（不带插件 75.7 / 78.6 s，带插件最快一次 74.8 s），**耗时与插件无关**，
「转圈很久」别怀疑到插件头上（八组采样与分段计时见 `docs/verification.md` 第九节）。

### 给 AI 助手的安装说明

> 请把 `dsh-whale-widget-proto` 装进 DSH 的 **desktop**（桌面客户端）或 **web** profile：
> 1. 确认本目录 `package.json` 带 `dsh.bundle.patch: "./cordis.patch.yml"`、`main`/`exports` 指向 `lib/index.js`，
>    且 `lib/index.js` 的 `default` 导出是 `{ name, inject, apply }` 而不是裸函数；
> 2. 先备份 `<profile>/package.json` 与 `pnpm-lock.yaml`，再执行 `dsh plugin --profile desktop add link:<本目录绝对路径>`
>    （路径必须是仓库根，且绝对）；pnpm 因网络失败时按上面「手工等价动作」三条落盘，不要跳过 bundles 那一步；
> 3. 校验组合结果：`dsh --profile desktop --dump-config` 会被拒（desktop profile 归 Electron 应用管），
>    改用客户端同一份库函数：`node -e` 调 `@deepseek-ai/dsh-app-boot` 的 `loadProfileDirectory('dsh', <profile目录>, <dsh 包 package.json>)`，
>    确认本包在 `layers` 里而不在 `skippedBundles` 里，且 `composeEntries` 的结果含 `{id:'dsh-whale-widget-proto'}`；
>    **但这条只证明「会被装载」，不证明「装载得起来」**——第 4 步才是；
> 4. 完全退出客户端再启动，右下角应出现鲸鱼娘。若没有，按顺序查：
>    - 先确认客户端真的重启过：`Get-Process` 看进程 `StartTime`，别把「没退出」当成「打不开」；
>    - `curl http://127.0.0.1:<宿主端口>/dsh-whale/balance.json`：空 body 的 404 = 路由没注册。
>      `503 {"code":"guard-unavailable"}` **不是故障**，是宿主的 `connection` 服务还没注册（启动头两百毫秒内正常现象）；
>      `401 unauthenticated` 才是「路由在、门禁在，但你没有宿主会话」。
>      拿同一个 profile 里**已加载的第三方插件**做对照再下结论（本机 `dsh-purge` 的 `/redteam/api`
>      未登录也回 `405 {"ok":false,"error":"POST only"}`，说明插件路由不需要会话就能命中）；
>    - 路由没注册 → 十有八九是插件激活失败，而激活失败只写进引擎 stderr（Electron 把它收在内存里，
>      不弹界面）。离线复现办法：用真 `cordis-plugin-loader` 走一遍装载（`.dsh-probe/loader-probe.mjs`），
>      它会直接把 `cannot get property "x" without inject` 这类原因打出来；
>    - index.html / `collectIndexInjections()` 里有没有那一行 `import('/dsh-whale/widget.js')`。
>
> 余额来源按三级回落，每次轮询重新判定：已登录的 `ctx.deepseekAccount.getBalance()` →
> 宿主凭据库的 `DEEPSEEK_API_KEY` → 环境变量。都没有时挂件显示「未配置」，不会伪装成 0 元。
> 数据落盘默认跟着宿主走：`$DSH_HOME/whale-widget`（可用 `DSHW_DATA_DIR` 覆盖）。
>
> **真机实测到的一个体验坑（不是 bug，但会吓人）**：冷启动后挂件会有**最多 60 秒**显示
> 「宿主没有可用的余额来源（…）」+ 灰脸，然后自己变成真实余额（卡片这里透传 provider 原文，
> 所以哪一级来源没给数是写在界面上的，不用去翻看不存在的引擎日志）。原因是宿主的 `authenticateWebHost` 排在引擎
> `ready` 之后，而挂件第一拍是立即取数 —— 那一刻确实没有会话。`unconfigured` 属配置类错误，按正常轮询间隔重试。
> **要缩短这段得同时改两处**：引擎侧 `DSHW_INTERVAL_MS`（默认 60000，可调）与前端
> `assets/whale-widget.js` 里写死的 `INTERVAL_MS = 60_000`；只调环境变量不够，因为浏览器那一拍也要 60 秒才再问一次。

---

## 目录结构

```
src/core/      money / layout / ledger / balance / jsonpath —— 纯逻辑，浏览器与 Node 共用
src/widget/    whale / skin / state / audio / dsh-source    —— 渲染与手势，DOM 胶水
               whale-girl.png —— 鲸鱼娘 Q 版立绘（本项目自带素材，随 MIT 分发；仓库里唯一的一张形象图）
src/server/    app / config / static / store / env / start  —— handler 与接线
               providers/{deepseek,mock}、dsh-routes.js
public/        index.html（演示页）、app.css、demo.js、favicon.svg、dsh.html（模拟宿主）
assets/        whale-widget.js —— DSH 注入入口
lib/index.js   DSH 插件入口（cordis：apply + inject，注册 /dsh-whale 前缀路由与 index 注入）
test/          138 条 node:test 单元测试；helpers/tmp.js 统一建临时目录、进程退出时清掉
scripts/       e2e-check.js —— 真进程 + 真 HTTP 的 39 项检查
docs/          architecture / limitations / verification
```

`package.json` 里 `private: true` 是刻意的：这是原型，没发布到 npm。真要发包，去掉它并按需改包名。

---

## 许可与来源

**代码**以 MIT（[`LICENSE`](LICENSE)）发布。参考项目的定位、DSH 契约与几个安全边界来自
[MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)，
逐条对应关系写在 [`PROVENANCE.md`](PROVENANCE.md)；代码为本次独立实现，未逐行照搬。

**美术素材**：`src/widget/whale-girl.png` 由本项目作者用 AI 生成，处理后随本仓库的 MIT 一起分发，
不含第三方素材。参考项目那张 `assets/DSniang1.png` 的上游写明其 `assets/**` 为 AI 生成、出处不可考，
条款是 **「as-is 随插件分发，仅用于运行本插件；不授予再许可，也不声明为原创作品」** —— 本项目只在早期
开发时取过一份做本地对照，**从未提交进仓库、从未随包分发，对照完已从本机删除**（2026-10-12）。
逐条对应关系见 [`PROVENANCE.md`](PROVENANCE.md)。
