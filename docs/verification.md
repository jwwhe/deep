# 验证结果

以下都是**实际跑出来的输出**，不是「应该没问题」。未覆盖的部分统一记在
[`limitations.md`](limitations.md)，没有粉饰项。

## 环境

```
Node v22.18.0 · npm 10.9.3 · Windows 11 (10.0.28120) x64 · Git Bash
浏览器：Qoder 内置 Chromium（browser-use 驱动）；余额口径那一轮的界面复验改用本机 Edge 154.0.4258.53
        无头（`--headless=new --screenshot`），因为当时 browser-use 连不上（`list_pages` 报 isDestroyed）
```

## 一、单元测试 143/143

```
$ npm test
# tests 143
# pass 143
# fail 0
# cancelled 0
# skipped 0
```

| 文件 | 覆盖 |
| --- | --- |
| `money.test.js` | 定点解析/格式化、half-up、非法输入、滚动步长单调 |
| `layout.test.js` | 吸附四边与角落、`margin` 内缩、视口小于挂件、非有限数字抛错；`placeControls` 的控件贴位（面板尺寸恒定、四向 clamp、头顶放不下翻脚下、上下都不够贴顶） |
| `ledger.test.js` | baseline/spend/adjustment/rollover、跨天、裁剪 |
| `balance.test.js` | 状态机：stale 沿用旧值、指数退避序列、并发去重、`unconfigured` 视为 permanent |
| `jsonpath.test.js` | `a.b[0].c` 最小路径语法 |
| `config.test.js` | 环境变量校验与越界报错、`maskSecret` |
| `store.test.js` | 原子写、坏存档留档回退 |
| `env.test.js` | `.env` 解析（`export`、引号、整行注释、坏行报行号） |
| `static.test.js` | 前缀映射、目录穿越/空字节/断编码一律 404 |
| `app.test.js` | 路由、回环 403、设置白名单与 `ignored`、mock 接口边界 400 |
| `deepseek.test.js` | 上游失败分类、三种余额字段结构、超时中断 |
| `dsh.test.js` | 宿主契约、ESM 依赖链 URL 解析、`balance.json` 先 idle 后刷新 |
| `plugin.test.js` | 真 cordis 契约：`apply/inject/name` 导出形状、**照抄真 Loader `unwrapExports()` 后 `inject` 仍在**（含裸函数 `default` 的反例）、缺 `webServer` 抛 `TypeError`、prefix 路由与宿主字段名、**余额口径（默认只算充值钱包、赠送单列、`includeBonus:true` 才合并）与「今日已用按总额记账」**、三级余额来源（账号服务 → 宿主凭据 → 环境变量）、`admit` 401/403、**连接服务缺席时一律 503 拒绝而不是放行**（含「缺席不缓存、服务晚到能恢复放行」）、`mergeWallets` 边界（未登录/协议失败/金额坏/只有赠送/多币种）、以及**属性访问会抛错的 strict cordis 语义**下仍能挂载并回余额 |

## 二、端到端 39/39（真进程 + 真 HTTP + 真落盘）

```
$ npm run test:e2e
鲸鱼娘挂件 · 端到端检查（http://127.0.0.1:61286，数据目录 ...\dshw-e2e-Q8kh1H）
  ✓ 进程启动并通过 /healthz
资源与 404：GET / · /favicon.svg · /app.css · /demo.js · /widget/{whale,state,skin,audio}.js
            · /core/{money,layout,balance,ledger}.js 全 200
            · 立绘 /widget/whale-girl.png 与 /dsh-whale/widget/… 全 200 且 image/png（形象图只有这一张）
            · 不存在的路径 404；服务端源码不作为静态资源提供；HEAD / 不返回实体
DSH 宿主契约：/dsh-whale/widget.js · /widget/whale.js · /widget/dsh-source.js · /core/money.js 全 200
            · balance.json 用宿主字段名（totalBalance=128.60）· 带今日已用（todayUsed=0.00）
            · 没有赠送钱包时 bonusBalance 为 null
            · 未知宿主接口 404 · 模拟注入页可访问
接口与记账：/api/state 有余额 · 推进 mock 后余额更新(99.99) · 今日已用按余额差记账(28.61)
            · 非法金额 400 · 坏 JSON 400 · 未支持方法 405
设置持久化：POST /api/settings 接受合法字段 · 未知字段进 ignored(["nope"]) · 已落盘 · 重启前状态可见
优雅关闭：  进程已退出（Windows：只验退出，不验优雅）· 关闭过程无 stderr 输出
全部通过：39/39 项
```

## 三、真 HTTP 采样（独立服务，端口 3799）

```
$ curl -s http://127.0.0.1:3799/healthz
{"ok":true,"version":"0.1.0","provider":"mock"}

$ curl -s http://127.0.0.1:3799/dsh-whale/balance.json
{"ok":true,"totalBalance":"128.60","balanceMicro":"12860000000","bonusBalance":null,"bonusIncluded":null,
 "todayUsed":"0.00","currency":"CNY","status":"ok","stale":false,"updatedAt":1791707295441,"error":null,
 "settings":{"scale":1,"snapEnabled":true,"snapMode":"ratio","snapValue":0.08,"mirrorOnLeft":true,"hideMenu":false}}

$ curl -s -X POST -H 'content-type: application/json' -d '{"value":"abc"}' http://127.0.0.1:3799/api/mock/next
HTTP 400  {"ok":false,"code":"bad-value","message":"金额无法解析：abc"}

$ curl -s --path-as-is http://127.0.0.1:3799/widget/../server/start.js   → HTTP 404
$ curl -s --path-as-is http://127.0.0.1:3799/core/../../package.json     → HTTP 404
$ curl -s http://127.0.0.1:3799/nope.js                                  → HTTP 404
$ curl -s -I http://127.0.0.1:3799/core/money.js → content-type: text/javascript; charset=utf-8
```
`bonusBalance` 回的是 `null` 而不是 `"0.00"`：独立跑（mock / API key 两条来源）没有「赠送钱包」这个概念，
挂件据此**不画那一行**，不会凭空多出一行 0 元。

## 四、真实浏览器实测

### 主半区（演示页 `/`，15 条请求全 200，console 零 error/warn）

```
GET /app.css · /demo.js · /widget/{state,whale,skin,audio}.js · /core/{money,balance,layout}.js
    · /widget/whale-girl.png · /api/state ×2 → 全部 200
```
关键点：`/core/*` 这三条是浏览器按 `whale.js` 里的 `import '../core/*.js'` **自己解析出来的**，
证明无打包步骤的 ESM 依赖链在真实浏览器里成立。
`/widget/whale-girl.png` 同理：URL 由 `skin.js` 里的 `new URL('./whale-girl.png', import.meta.url)` 推出，
不是写死的路径。

### 鲸鱼娘立绘（本轮换形象后补测）

| 检查 | 实测 |
| --- | --- |
| 图片解码 | `naturalWidth=610`、`complete=true`，`currentSrc` 在演示页是 `/widget/whale-girl.png`、在 `/dsh.html` 是 `/dsh-whale/widget/whale-girl.png`（两条前缀都通） |
| 不透明像素包围盒 | `x 45..610 / y 10..609`（画布 610×610）→ 纵向占 98.4%、横向 92.6%，透明边距极小，`object-fit: contain` 不会把人物缩成小点 |
| 卡片是否压脸 | 卡片底边比立绘盒顶高 **4px**（`ib.top - card.bottom = 4`，四档视口一致）；`dshw-float` 的 ±3px 浮动时最小间隙 1px，不遮脸 |
| 贴左镜像 | class `dshw-root at-left mirrored`；`img` 计算样式 `matrix(-1,0,0,1,0,0)`，而 `.dshw-card` 仍是 `translateX(-50%)`、`.dshw-menu-button` 不变 → **只翻立绘，文字不翻**（截图里蝴蝶结/尾鳍换边，菜单与余额照常可读）。**注**：`at-left` 这个类名与「菜单跟着 root 类名换开向」在第十四节那轮已被坐标贴位取代，本行记录的是当时的实测 |
| stale / error 去色 | 加 `stale` → `... saturate(.72) brightness(.96)`；加 `error` → `... grayscale(.6) sepia(.22) hue-rotate(-18deg) saturate(1.3)`；去掉 class 后回到只有 `drop-shadow` |
| 截图留证 | 本机临时目录下的 `girl-final-scale1.png`（正常）、`girl-mirrored.png`（镜像 + 菜单）、`girl-bubble-25x.png`（scale 2.5 看细节）。**没有入库**：截图本身也含上游美术素材，随包分发同样越过许可边界 |

### 响应式四档（同源 iframe 逐档实测，media query 与 fixed 定位都按 iframe 视口算）

| 视口(CSS) | innerWidth | clientWidth | 横向溢出 | 鲸鱼距右/下边 | 完整可见 | 余额渲染 |
| --- | --- | --- | --- | --- | --- | --- |
| 380×700 | 380 | 365（有滚动条） | 0 | 16 / 16 | ✅ | `¥ 126.91` |
| 700×800 | 700 | 685 | 0 | 16 / 16 | ✅ | `¥ 126.91` |
| 1000×800 | 1000 | 1000 | 0 | 16 / 16 | ✅ | `¥ 126.91` |
| 1280×800 | 1280 | 1265 | 0 | 16 / 16 | ✅ | `¥ 126.91` |

`clientWidth < innerWidth` 的两档说明页面有纵向滚动条：挂件按 `clientWidth` 定位，
所以**不会压到滚动条底下**（`gapRight` 仍是 16 而不是 1）。

### 拖拽与吸附（合成 pointer 事件走真实手势处理链）

| 动作 | 结果 |
| --- | --- |
| 拖到左缘 | `x=16`，class `dshw-root at-left mirrored`（镜像 + 菜单改向右开；`at-left` 已被第十四节的坐标贴位取代） |
| 拖到右缘 | `gapRight=16` |
| 拖到上缘 | `gapTop=16` |
| 拖到右下角 | `gapRight=16`、`gapBottom=16` |
| 吸左后触发 `resize` | 仍 `x=16`、镜像保持（**不漂移**） |
| 右下角改 scale 0.6→1 | 始终贴右留 16px，回到 scale 1 时 `x=372` 复原 |

### DSH 半区（`/dsh.html`，整页只有一行 `<script type="module" src="/dsh-whale/widget.js">`）

```
mounted: true · 文本 "¥ 127.28 今日 ¥1.32 ☰ 鲸鱼娘 大小 音量 音效：开 吸附：开 镜像：开 隐藏菜单 立刻刷新 v0.1.0"
立绘 currentSrc = /dsh-whale/widget/whale-girl.png（naturalWidth 610、complete true）
gapRight 16 · gapBottom 16 · 横向溢出 0 · console 零消息 · 卡片比立绘顶高 4px
10 条请求全 200：/dsh-whale/widget.js → widget/{whale,dsh-source,skin,audio}.js → core/{balance,money,layout}.js → balance.json → widget/whale-girl.png
```
即：注入入口自挂载 → 按宿主前缀解析整条 ESM 链 → 读 `balance.json` 的 `totalBalance`/`todayUsed` → 渲染。

## 五、真实上游探测（不带凭据）

```
$ curl -s -o /dev/null -w "%{http_code} %{content_type}" https://api.deepseek.com/user/balance
401  (content-type 为空)
$ curl -s https://api.deepseek.com/user/balance
Authentication Fails (governor)
```
→ 端点存在、无 key 时回**纯文本 401**，所以 provider 里 `JSON.parse` 失败是常态路径，
分类成 `auth-failed`（不可重试）而不是当网络抖动。**带真实 key 的余额读取未验证。**

## 六、发布产物从零验证（`npm pack` → 解包 → 直接启动）

> ⚠️ 本节数字属**第十二轮当时**（立绘还是 322 kB 的那一版）。素材在第十三轮换成了 Q 版，
> 包体与 png 字节数已变，**当前数字见第十三节**；本节其余结论（包内容清单、不含 dev-only 目录、
> 解包能直接起服务）与素材无关，仍然成立。

验收标准「按 README 从零安装后可以启动」是这么验的：把包打包、解到临时目录、在解出来的目录里起服务。

```
$ npm pack --dry-run        # 在工作目录里跑的
total files: 37 · package size 415.6 kB · unpacked 559.4 kB
含 .env.example 2.3 kB、src/widget/whale-girl.png 322.3 kB（形象图只有这一张，也是包里的最大项）
包含 LICENSE / PROVENANCE.md / README.md / cordis.patch.yml / docs/ / lib/ / src/ / public/ / assets/
不含 .refs/、.dsh-probe/、vibe_images/，也不再含已删掉的 whale-girl-placeholder.svg（grep 命中 0 条）
```

**顺带记一条 npm 的脾气**（上一轮实测出来的，本轮换了素材又确认了一次方向）：`.gitignore` 挡不住
`npm pack` —— `files` 白名单收的是 `src` 这个**目录**，npm 不会为目录里的文件去套 gitignore。
上一轮这张立绘「不该进包」，所以打包前必须先把图挪走；本轮它**本来就该进包**，这条脾气不再是风险。
但它仍然说明：以后往 `src/` 下放了不想分发的东西，得靠 `.npmignore` 或把白名单写细，不能指望 gitignore。

```
$ git checkout-index -a -f --prefix=<临时目录>   # 严格按索引落一份，等价于别人 clone 到的内容
53 files · 758 KB        # 上一轮 53 / 750 KB：删了兜底 svg，但本轮又加了 test/helpers/tmp.js（1.2 kB）
$ cd <该目录> && DSHW_PORT=4196 DSHW_DATA_DIR=<临时目录> node src/server/start.js
healthz    HTTP 200 application/json  {"ok":true,"version":"0.1.0","provider":"mock"}
/widget/whale-girl.png            HTTP 200 image/png    322296 B
/dsh-whale/widget/whale-girl.png  HTTP 200 image/png    322296 B
/widget/whale-girl-placeholder.svg HTTP 404 application/json 99 B   # 兜底图确实不在这份产物里
/nope.js   HTTP 404 application/json  {"ok":false,"code":"not-found","message":"没有这个资源：/nope.js"}
/api/state → 余额 128.60 · 今日 0.00 · provider mock
stderr: 空
```
即：`files` 白名单足够跑起来，没有 accidentally 依赖未发布的文件（`test/`、`scripts/` 不在包里，
所以 `npm test` 只在源码目录可用，这点 README 的命令表已按源码目录写）。
`diff -r --strip-trailing-cr` 比对这份 clone 与工作目录：**内容零差异**（`core.autocrlf=true`，
所以字节级不同、行尾一致，比对要带 `--strip-trailing-cr`）。

**渲染跟工作目录逐像素一致**（本轮改用 CDP 量，原因见下面那条坑）。同一时刻在 clone（4196）与工作目录
（4197）各截一张 420×760，用编译成 C# 的逐像素比对（`System.Drawing` + `LockBits`）量：整页只有
**443 个像素**不同（0.14 %）。分区看 —— 演示页上半部 `0` 差异；左下状态面板 275 像素（那里印的就是会漂移的
mock 余额和更新时间）；卡片那块 126 像素（卡片上写的就是金额）；立绘盒 12,288 个像素里只有 42 个不同，
且全挤在卡片右下圆角压到的 `(360,629)-(366,636)` 那一小块。**把卡片阴影能碰到的 y ≤ 639 排除掉，
立绘盒内差异是 0**（`rect(276,640)-(403,723) diffPixels=0`、`rect(276,628)-(353,723) diffPixels=0`）。
也就是说：素材、CSS、几何没有一处依赖仓库外的东西，剩下的像素全是两份进程各自的 mock 数字。

> ⚠️ **测量手法的坑（订正用）**：`--window-size=420,760` 在 `--headless=new` 下会被抬到 **500 px 下限**
> （CDP 读到 `innerWidth = 500`），PNG 却按 420 裁 —— 于是截图里「卡片被切掉一半」纯属假象，
> 挂件其实是贴着 500 宽的视口右缘画的。窄视口必须用 CDP `Emulation.setDeviceMetricsOverride` 才算数。
> 另外 `.dshw-float` 是 3.4 s 无限循环的 ±3 px 浮动，截图前不注入 `animation:none` 的话两次截图必然不同，
> 别把动画相位当成渲染差异。

按 CDP 覆盖视口扫 320 / 360 / 420 / 768 / 1280 五档（在 clone 那份上跑的）：横向溢出全 `0`，
挂件盒始终 `128×128`、`offRight` 与 `offBottom` 恒为 `-16`（四边各留 16 px），卡片始终在形象盒上方。

**没有兜底之后的表现**（本轮在 clone 那份里实测，不是看代码推断）：把 `whale-girl.png` 临时改名 →
`GET /widget/whale-girl.png` 回 `404 application/json`，`--dump-dom` 里变成
`<img class="dshw-body" src="…/widget/whale-girl.png" alt="鲸鱼娘" draggable="false" hidden="">`，
CDP 读到 `bodyHidden = true`；截图里既没有裂图图标也没有鲸鱼，只剩余额卡片与 ☰ 按钮。
**形象层藏掉后挂件盒与边距一点没变**（root 仍 `128×128`、`offRight/offBottom` 仍是 `-16`），
五档视口下 `bodyHidden` 全为 `true`。改回文件名再 dump，`hidden` 消失。

## 七、这一轮实测当场抓出并修掉的缺陷

| 缺陷 | 症状 | 修法 | 钉住它的测试 |
| --- | --- | --- | --- |
| `placeAtRest` 键名传错 | 挂件跑到视口外、无任何报错 | 调用点键名对齐 + `restingPosition` 校验有限数字 | `layout.test.js` |
| 镜像规则翻转了卡片 | 贴左时菜单/卡片文字反了 | 只翻转形象本身（当时是 SVG 的 `body-group`，换立绘后是 `img.dshw-body`），文字层不跟着翻 | 浏览器复验 |
| 菜单贴顶被切 | 吸上缘后菜单开在视口外 | 先 unhide 再量高，必要时向下开 | 浏览器复验 |
| 关镜像后贴左菜单被切 | 菜单仍按 mirrored 判定 | 改按坐标判定 `at-left` | 浏览器复验（`at-left` 现已被第十四节的坐标贴位取代） |
| 缩放/改窗口后浮在屏幕中间 | 只 clamp 不 re-anchor | 新增 `lastEdge` + `resnap()` | 浏览器复验 |
| **静置位被 resize 吸成贴边**（margin 16 落在吸附区内） | 首次 resize 后鲸鱼凭空往里跳 16px、压到视口边缘 | `resolveSnap` 支持 `margin`，静置/吸附/resize 三条路径共用同一内缩规则 | `layout.test.js` 新增 4 条 |
| `queueValue('abc')` 抛穿 500 | mock 接口变成 500 | 边界处 `tryParseAmount` → 400，`fail` code 加白名单 | `app.test.js` + e2e |
| DSH 半区「今日 —」 | 宿主字段 `todayUsed` 与内部 `todaySpend` 不一致 | `whale.js` 两种宿主字段都认 | 浏览器复验 |
| `/dsh-whale/core/*` 404 | 桥接层只对 `/widget/` 走静态 | API 表未命中一律走静态解析 | `dsh.test.js` |
| Windows 上 SIGTERM 断言假失败 | Windows 不投递 SIGTERM，`exit=null` | e2e 按平台分支，只验退出并注明 | e2e |
| 形象不是用户要的那只（自绘几何小鲸鱼） | 用户明确指出要参考仓库的「鲸鱼娘」 | 换成上游立绘 `src/widget/whale-girl.png`，`skin.js` 改用 `<img>` + `import.meta.url` 解析 URL；同时补美术许可豁免 | e2e 新增 2 条素材断言 + 浏览器复验 |
| 换立绘后卡片压住头顶 4px | 卡片底边落在立绘不透明像素里 | `.dshw-card` bottom 92→100、`.dshw-bubble` 126→148 | 浏览器复验（四档视口间隙均为 4px） |
| **宿主里每个请求都 400** | 真 cordis 下读未注册的服务属性是**抛错**（`cannot get property "connection" without inject`），不是返回 `undefined`；`optionalService` 的「退回属性访问」让每个请求被 webserver 兜成 400 | 可选服务一律只走 `ctx.get()`（未注册/未激活都返回 undefined），属性访问只留给非 cordis 宿主；连接服务缺席时告警一次不静默放行 | `plugin.test.js` 的 strict 宿主两条（假宿主用 Proxy 复现「读不到就抛」）+ 探针的 403 用例 |
| 宿主第一次取数前挂件显示灰脸 | 宿主报 `idle`（还没取过数）被客户端当成一次失败 | 状态机加 `pending` 语义：拿到第一个值之前保持等待而不是错误脸 | `balance.test.js` + 两个前端 source 的 pending 分支 |
| **挂件余额与官网对不上** | 用户实测反馈。`mergeWallets` 默认 `includeBonus: true`，把「充值钱包 + 赠送钱包」加成一个总数显示；而官网与官方设置页（`dsh-client-ui-settings-account/lib/client.js` 的「余额」/「赠送余额」两行，赠送还要 `> 0` 才列）从不相加 —— 有赠送的账号显示值必然偏大 | 默认改成**只显示充值钱包**（与官网「余额」行同口径），赠送金额单独经 `bonusBalance`/`bonusIncluded` 出来，挂件多画一行「赠送 ¥x.xx」（合并模式下写「含赠送」）；`includeBonus: true` 保留为可选。**今日已用仍按两类钱包的总额差值记账**，否则赠送被扣掉的那段会漏记 | `plugin.test.js` 三条（默认口径 / `includeBonus:true` / 总额记账）+ `mergeWallets` 边界里的「只有赠送钱包」+ `dsh.test.js` 的 `bonusBalance` 透传 + e2e 的 `bonusBalance=null` |
| **真客户端里右下角什么都没有（`/dsh-whale/*` 全 404）** | `export default apply` 把插件导出成了**裸函数 default**：真 Loader 的 `unwrapExports()` 先取 `default`，模块上的 `inject` 因此整体丢失，读 `ctx.webServer` 变成「没 inject 就读」→ 激活失败 → 路由根本没注册。桌面客户端把引擎 stderr 收进内存，只在启动失败时才给出来，所以现场什么都看不到。**只查命名导出的 133 条单测与 15 条探针全绿**——因为它们都是直接 `apply()`，绕过了 Loader | 默认导出改成 `{ name, inject, apply }` 对象（官方插件 `dsh-purge` 就是这两种形状之一）；并把「过一遍真 Loader」补成探针 | `plugin.test.js` 照抄 `unwrapExports()` 的正反两条 + `.dsh-probe/loader-probe.mjs`（坏形状 fixture 复现出同一句 `cannot get property "webServer" without inject`） |

### 本轮只记录、未修的

| 现象 | 为什么没顺手修 |
| --- | --- |
| scale 调到 3 时气泡顶出视口（实测 `top=-286`，scale 1 时完全在屏内） | 换形象前就存在（气泡底边 108→126→148 只是把它抬高了一点），修法要给气泡也做「放不下就往下翻」，与 `menu-below` 同级（这两个类名现已被第十四节的坐标贴位取代，气泡那条坑仍在）；本轮范围是形象，不扩到手势层。已记进 [`limitations.md`](limitations.md) 小坑清单 |
| 立绘素材的许可风险 | 属于「必须记录」而不是「必须修」：`private: true` 挡住了误发布，`LICENSE`/`PROVENANCE.md`/`README.md` 已写明不在 MIT 内、发布前要换图 |

## 八、DSH 真宿主：cordis 探针 + desktop profile 安装

前面几节验的是「独立服务」这一侧。宿主那一侧用**真包**再验一遍：`@deepseek-ai/cordis` 的上下文与
`@deepseek-ai/dsh-host-webserver` 的 HTTP 服务，账号服务用桩（探针不碰真实凭据）。
注意这一节的 16 条**没有经过 cordis 装载器**（直接 `apply()`），装载器那一侧单独由本节末尾的
`loader-probe.mjs` 覆盖。

依赖来自桌面安装自带的包树，用 junction 借过来（ESM 的裸模块名按导入者所在目录解析，所以探针必须放在
`.dsh-probe/` 里）。**下面及本节其余部分的 `<...>` 都是占位**：`.dsh-probe/` 依赖宿主安装目录、
指向宿主 `node_modules` 的 junction，属 dev-only 且不入库，只有在本机建好同名 junction 才跑得起来；
`<DSH_HOME>` 是 DSH 的数据目录、`<DESK_APP>` 是桌面客户端安装目录、`<REPO>` 是本仓库目录。

```bash
cmd //c mklink //J "<REPO>\\.dsh-probe\\node_modules" "<DESK_APP>\\resources\\app\\dsh\\node_modules"
cd .dsh-probe && node probe.mjs
```

```
cordis 加载与路由：
  ✓ index.html 里出现注入行 — HTTP 200
  ✓ 注入的是 body 位置的 script
  ✓ 挂件入口脚本可取 — text/javascript; charset=utf-8
  ✓ 挂件模块经 /dsh-whale/widget/ 前缀可取 — HTTP 200
  ✓ core 模块经 /dsh-whale/core/ 前缀可取 — HTTP 200
  ✓ 鲸鱼娘立绘可取且不是裂图 — image/png
  ✓ 命名空间外的路径不进挂件桥 — HTTP 200
  ✓ 宿主连接服务拒绝的请求不落数据 — HTTP 403 forbidden-origin
余额（桩账号服务：充值 1234.56 + 赠送 0.44）：
  ✓ POST refresh.json 走宿主契约 — HTTP 200
  ✓ 余额默认只算充值钱包（includeBonus=false） — totalBalance=1234.56（刷新前：1234.56 / ok）
  ✓ 赠送余额单独返回 — bonusBalance=0.44 bonusIncluded=false
  ✓ 币种透传 — CNY
  ✓ 账号服务收到客户端标识 — {"version":"0.1.0-prototype","locale":"zh-CN","timezoneOffsetSeconds":28800}
状态呈现：
  ✓ provider 报告为 host — host
  ✓ 账本记到了今日已用 — todaySpend=0.00
  ✓ 账号服务改判未登录后如实报错 — unconfigured / no-balance-source
探针全部通过：16/16
```

探针有两个环境变量方便复验边界：`DSHW_PROBE_CONFIG`（覆盖插件 config，如 `{"includeBonus":true}`）、
`DSHW_PROBE_BONUS`（改赠送金额，`0` 用来验「没有赠送时不该多一行」）。三种组合都跑过：

| 桩数据 | `totalBalance` | `bonusBalance` / `bonusIncluded` | 探针 |
| --- | --- | --- | --- |
| 充值 1234.56 + 赠送 0.44，默认 | `1234.56` | `0.44` / `false` | 16/16 |
| 同上 + `DSHW_PROBE_CONFIG={"includeBonus":true}` | `1235.00` | `0.44` / `true` | 16/16 |
| 同上 + `DSHW_PROBE_BONUS=0` | `1234.56` | `0.00` / `false` | 16/16 |

顺带抓到一条 cordis 契约细节：探针里包一层 `apply` 时**必须写 `function` 而不是箭头函数**。
cordis 用 `isConstructor()` 分流插件回调（`lib/index.js:1066`），非箭头回调会被 `new` 出来，
返回值只当实例用；箭头函数走普通调用分支，那时 `apply()` 的返回值会拿去当 effect 校验，
我们返回的 `services` 对象就变成 `TypeError: Invalid effect`。官方插件清一色 `export function apply` 也是这个形状。

`node probe.mjs --keep` 挂住后用真实浏览器打开 `http://127.0.0.1:<端口>/`：页面里**没有任何手写脚本**，
挂件由宿主渲染出的那一行注入自挂载，10 个请求全 200、零 404、console 干净。三档渲染各截一张图（本机 Edge 154 无头）：
`¥ 1234.56 / 赠送 ¥0.44 / 今日 ¥0.00`、`¥ 1235.00 / 含赠送 ¥0.44 / 今日 ¥0.00`、`¥ 1234.56 / 今日 ¥0.00`（赠送为 0 时那一行不出现）。
截图同样**不入库**（含上游美术素材），看完即弃。

### 装进桌面 profile

官方路径 `dsh plugin --profile desktop add link:<REPO>` 在这台机器上跑不通，但不是插件的问题：
pnpm 会顺带重解析 profile 里已有的 `dsh-purge` tarball 依赖，而 GitHub 拉不动
（`ERR_PNPM_TARBALL_INTEGRITY` → `UND_ERR_SOCKET`；`--offline` 则 `ERR_PNPM_NO_OFFLINE_TARBALL`，说明该 tarball 不在本机 store 里）。
于是做了与 `link:` 等价的落盘动作（先把 profile 的 `package.json` 备份到 `<DSH_HOME>\whale-widget\install-backup\`）：

1. `<DSH_HOME>\profiles\desktop\node_modules\dsh-whale-widget-proto` → junction 到 `<REPO>`；
2. `package.json` 的 `dependencies` 补 `"dsh-whale-widget-proto": "link:<REPO>"`；
3. `dsh.profile.bundles` 末尾追加同名条目（`reconcile()` 就是这么排的）。

校验不能靠 `dsh --profile desktop --dump-config` —— CLI 明确拒绝（`profile "desktop" is managed
exclusively by the Electron application`），所以直接调客户端启动时用的同一份库函数：

```
$ cd .dsh-probe && node verify-install.mjs
装载成功的层      @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-purge, dsh-whale-widget-proto
本插件的层        <DSH_HOME>\profiles\desktop\node_modules\dsh-whale-widget-proto
  patch 文件      …\cordis.patch.yml
组合后条目总数    188
本插件条目        {"id":"dsh-whale-widget-proto","name":"dsh-whale-widget-proto"}
profile 组合通过：客户端启动时会加载本插件
```

顺带用同一份组合结果确认了本插件要摸的四个服务键都在 profile 里且未被禁用：
`webserver`（硬依赖）、`connection`、`credentials`、`deepseek-account`。服务键名是从各包源码里读出来的，
不是猜的：`provide("connection"`、`super(ctx, "deepseekAccount")`。

**上面这 16 条有一个共同盲区：它们是直接 `apply(ctx, config)` 的，没有经过 cordis 的装载器。**
真客户端 404 的那个缺陷正好藏在这段差距里（见第七节最后一行），所以补了一个走**真 Loader** 的探针：
用宿主自带的 `@deepseek-ai/cordis` + `@deepseek-ai/cordis-plugin-loader` + `dsh-app-boot` 的
`mountRootInclude()`，把插件行喂进真的 EntryTree，宿主侧只留一个提供 `webServer` 的最小桩
（`.dsh-probe/profile-fixture/ws-stub.js`，它真 `listen` 在随机端口上，探针用 `fetch` 打真实请求）。

```
$ cd .dsh-probe && node loader-probe.mjs
ok   真 Loader 装载后 /dsh-whale 路由已注册 — routes=["prefix:/dsh-whale"]
ok   注册形状是 prefix（要覆盖 widget.js 与 api/*） — kind=prefix
ok   index-inject 表里有自挂载的 script row — rows=["script"]
ok   经真 Loader 装载的 handler 能回余额 — status=unconfigured code=
ok   没有 key 时如实报 unconfigured 而不是编造余额 — status=unconfigured
ok   挂件入口脚本取得到 — http=200 type=text/javascript; charset=utf-8
ok   admit 判拒的请求经真 Loader 也被挡住 — http=401 code=unauthenticated
ok   装载过程没有 warn/error 日志
ok   坏形状（裸函数 default）不会注册成功——探针有牙齿 — routes=[] logs=Error: cannot get property "webServer" without inject

loader-probe: PASS全部通过，临时目录 <TEMP>\dshw-loader-u9EPJr
```

最后一条是这个探针的价值所在：fixture 里另放了一个 `bad-default.js`，形状与修复前的本插件**完全同构**
（命名导出 `apply`/`inject` 都对，只是多一个裸函数 `default`）。它经真 Loader 装载后 `routes=[]`，
日志里就是客户端里那句 `cannot get property "webServer" without inject` —— 也就是说这个探针能当场抓住
上一轮漏掉的那类缺陷，而不是只给「修好了」三个字背书。

「admit 判拒」那条是补冷启动门禁缺陷时一起加的：fixture（`profile-fixture/ws-stub.js`）从此必须
`ctx.provide('connection', …)`，因为真宿主里这个服务确实存在，本插件在它**缺席**时是拒绝而不是放行；
桩里没有它的话，探针测到的就不是真宿主的形状。带 `x-probe-deny` 头的请求经真 Loader 装载的 handler
得到 401，证明门禁这一层在真装载路径上也生效。探针共 9 条，当前 **9/9**。

### 桌面端注入链路（不重启也能核的部分，读源码核的）

桌面渲染层的文档基座是 `dsh-app://app/`，不是 `http://127.0.0.1:19387/`，所以「注入一行 script」在
桌面形态下能不能挂上，取决于两件事，都在客户端自带的包源码里对上了：

| 环节 | 源码位置 | 结论 |
| --- | --- | --- |
| 宿主把注入表交给 Electron | `dsh-desktop-host/lib/index.js:341` `injections: ctx.webServer.collectIndexInjections()` | 只在 `ready` 时收集一次 → 插件必须在启动过程中就激活，晚挂的不管用 |
| Electron 把表交给渲染层 | `resources/app/lib/main.js:11612` `ipcMain.handle(DESKTOP_IPC.boot)` 返回 `{injections, streamBaseUrl}` | 走 IPC，不渲染 HTML |
| 渲染层怎么执行 `kind:'script'` | `dsh-web-frontend/dist/assets/index-5SrrfWpU.js` 的 `hM()`：`case"script": s.textContent=o.text`，按 `placement` 选 head/body | 本插件的 `{kind:'script', placement:'body', text}` 正好被支持（`script-src` 才走 `src`） |
| 脚本里的 `import('/dsh-whale/widget.js')` 打到哪 | `main.js:11595`：`dsh-app://app/` 下除 `/`、`/index.html`、`/assets/*`、favicon/manifest 之外一律 `forwardWebRequest(request, hostUrl, hostCookie)` | 绝对路径转回宿主并带上宿主 cookie → 同一份会话校验能过 |

**已验**：重启之后右下角**确实出现了鲸鱼娘立绘 + 卡片**（桌面截图核对，1920×1080 全幅里右下角，非右下裁切区）。
层叠关系正常，没有把右侧栏或输入框盖掉。

**当时以为是新缺陷，2026-10-12 复查证明是冷启动时间差**：那次截图里卡片是「今日 —」+
「未配置 DEEPSEEK_API_KEY」。今天把同一个客户端（09:25 启动的那次，没重启、只还原窗口）截下来，
卡片是 **`¥ <充值余额> / 赠送 ¥<赠送余额> / 今日 ¥0.00`**（两处金额属本机账户，公开仓库里隐去；
数值本身已在作者机器上核对过是真实取到的）—— 真宿主上 `ctx.deepseekAccount` 是通的，两钱包也按官网分了两行。
原因是宿主的 `authenticateWebHost` 在引擎 `ready` **之后**才跑，而挂件 `start()` 立即取第一拍，
那一拍必然还没会话；`unconfigured` 属配置类错误，`nextDelay()` 按 `intervalMs`（60 s）重试，所以一分钟内自愈。
留下的真实问题只有体验层的：**每次冷启动挂件会红脸最多 60 秒**，详见 `limitations.md` 第 1 条。

## 九、完整客户端启动耗时（真机 8 组计时 + 摘插件 A/B）

用户报「启动时间好慢」，于是量了一遍：从 `spawn` Electron 到窗口内容可见。计时脚本在临时目录里
（`boottime.ps1` / `boottime2.ps1` 记录端口监听与路由状态迁移，`bootcpu.ps1` 采样 CPU/WorkingSet），
不入库；每个被杀的实例都是测量过程中自己 spawn 的。

| 组 | 场景 | 总耗时（spawn → 窗口可见） |
| --- | --- | --- |
| COLD-1 | 完全冷启动（无 OS 文件缓存） | **90.7 s** |
| WARM-3 | 热启动（同 profile，第二次以后） | **80.2 s** |
| TEL-ON | 热启动 + 遥测开启 | **81–83 s** |
| VERIFY-FIX | 冷启动门禁修完再复验 | **79.2 s** |

VERIFY-FIX 那一组的时间线（单位 ms，相对 spawn）：

```
241    | electron 主进程起来
1776   | pid-new（引擎子进程）
78522  | 127.0.0.1:19387 端口开始监听
78650  | /dsh-whale/widget.js  → 503
78707  | /dsh-whale/balance.json → 503
78759  | 连接服务已注册，同一 URL → 401
79188  | 窗口可见 1296×828
```

**结论：慢不在挂件。** 那 78 秒是宿主自己的挂载关键路径，而且是 **CPU 密集**不是等网络——同期 CPU 时间
几乎 1:1 跟着墙钟涨（冷 34.1 s CPU / 32.3 s 忙等；热 80.6 s / 78.6 s）。冷、热只差约 11 秒，
所以也不是一次性的磁盘 IO。关键路径在 `dsh-desktop-host/lib/index.js` 的 `main()`：

```
loadProfileDirectory → runProfile（188 个模块，从 121,348,951 字节的 app.asar 里读）
                     → await ctx.plugin(desktop-office)
                     → 才 process.send({ type:'ready', url, injections })
```

Electron 的 `index.html` 要等这张注入表，`ready` 之后还串着 `authenticateWebHost` →
`connectDesktopWelcome` → `analyticsEnabled()` → `openInitialWindow()`
（`mandatoryPolicy.check('launch')` 与 `updateSchedule.check()` 没被 await，不在这条路上）。
挂件自身在这 80 秒里贡献 **67 ms**：import 62 ms + `apply()` 5 ms，加上每个请求约 4–6 ms，占比千分之一量级。

**顺手测出来的真缺陷（已修）**：WARM-3 的时间线是

```
79671 | /dsh-whale/widget.js  → 200
79728 | /dsh-whale/balance.json → 200（真实金额）
79886 | 之后才 401
```

端口刚监听的头约 160–220 ms 里，提供 `connection` 服务的 bundle（`dsh-client-connection`）还没注册，
而本插件的路由是 **fail-open**——不带会话的本地请求照样拿到了余额。改成 fail-closed：连接服务缺席即
`503 guard-unavailable`（挂件自己会重试，界面只是多等一拍）。修复后 VERIFY-FIX 里同一段是
`503 → 503 → 401`，**全程没有 200**；启动稳定后再 `curl`，balance 与 widget 都是 401（本机无宿主会话，符合预期）。

复验：`npm test` 138/138、`npm run test:e2e` 40/40、真 cordis 探针 16/16、真 Loader 探针 9/9。

### 顺手把「未配置」的真实原因透到卡片上

上面那条真机缺陷（已登录却显示未配置）在没有引擎日志、`curl` 又被 401 挡住的情况下无法下手，而
`src/widget/whale.js` 的 `paintFlag()` 在 `unconfigured` 分支里把 provider 原文**压成了固定文案**
「未配置 DEEPSEEK_API_KEY」——`state.error.message` 其实一路都在（`lib/index.js` 特意拼了
「宿主没有可用的余额来源（…；…）」，就是为了这种情况）。改成透传 `state.error?.message`，
卡片就能直接说出是哪一级来源没给数。

代价是文案变长，而 `.dshw-card` 原本是 `white-space: nowrap` 的：长句会把卡片横向撑出去。
实测（headless Edge + CDP `Emulation.setDeviceMetricsOverride`，量 DOM 包围盒而不是目测）：

| 视口 | 状态 | 卡片尺寸 | 位置偏差 | 是否被视口裁切 |
| --- | --- | --- | --- | --- |
| 1256×708 | ok（`¥ 1234.56`） | 91×56 | 中心漂移 0 px | 否 |
| 1256×708 | unconfigured（42 字诊断句） | 128×124（flag 68 px 高，5 行） | 0 px | 否 |
| 380×700 | 同上两态 | 91×56 / 128×124 | 0 px | 否 |

改法是把卡片从 `left:50% + translateX(-50%)` 换成 `left:0;right:0;width:max-content;margin:0 auto`
（旧写法的可用宽度只有根盒子的一半，等于白白让长句多受一层约束），再给 `.dshw-flag` 单独
`white-space: normal; max-width: 220px`。**说清楚效果有限**：卡片确实从 117 px 宽变成 128 px 宽、
中心漂移 0，但 42 字的诊断句仍然是 5 行 —— 因为立绘本身只有 128 px，`max-width:100%` 就是天花板。
不放到 220 px 是有理由的：吸附在右边时卡片中心离视口右缘只有 64 px，放到 220 px 会溢出 46 px，
宁可多两行也不要一句看不全的话。`.dshw-menu-button` 和 `.dshw-bubble` 各自的 `translateX(-50%)` 没动，
`.dshw-root.mirrored` 只翻立绘，所以这次改动不影响镜像与菜单。DOM 层没有测试框架（当时 138 条单测都不碰 DOM，
现 143 条同样不碰），这几行数字是浏览器里量出来的。

### A/B：把本插件摘掉再各测一次冷启动

上面那些只能证明「挂件自身只占 67 ms」，证明不了「装上前后总耗时没差别」——那 78 秒也可能是别的东西占的。
所以经用户同意，完全退出客户端后连做 4 次重启：

| 组 | 插件 | 总耗时（spawn → 窗口可见） | 端口刚监听时 `/dsh-whale/*` |
| --- | --- | --- | --- |
| A | 带 | **92.2 s** | `503 → 401` |
| B | **摘掉** | **75.7 s** | `404` |
| B2 | **摘掉**（第二次） | **78.6 s** | `404` |
| C | 带（已还原） | **74.8 s** | `503 → 503 → 401` |

**结论：本插件与启动耗时无关。** 摘掉插件两次是 75.7 / 78.6 s，完全落在带插件那几次
（74.8 / 79.2 / 81–83 / 90.7 / 92.2 s）的区间里，而**当天最快的一次就是 C 组（带插件，74.8 s）**。
真正的信息是**噪声尺度约 ±15 s**：上一节拿 90.7 s 和 79.2 s 比出「冷比热慢 11 秒」，那也在噪声里——
能站住的是量级（约 75–92 s）和归因（宿主挂载 188 个条目），不是具体差值。

摘法只改 `<DSH_HOME>\profiles\desktop\package.json`：从 `dependencies` 与 `dsh.profile.bundles` 两处删掉
`dsh-whale-widget-proto`（`node_modules` 里的 junction 没动，测完已还原；`verify-install.mjs` 复验组合后
仍是 188 条、本插件回到第 188 位）。B/B2 那列的 **404 是 A/B 的副产品**：路由确实只由本插件注册，
插件不在宿主里就没有这个路径，反过来证明 C 组的 `503 → 401` 走的是我们自己的 handler。

C 组时间线（ms，相对 spawn）：

```
194    | spawn（pid=13488）
924    | pid-new ×3（Electron 子进程）
1647   | pid-new（引擎）
74191  | 127.0.0.1:19387 开始监听
74336  | /dsh-whale/widget.js    → 503 guard-unavailable
74376  | /dsh-whale/balance.json → 503
74426  | 同一 URL → 401（connection 服务已注册，门禁生效）
74806  | 窗口可见 1296×828
```

端口监听到窗口可见只有 **615 ms**，和历史样本一致 —— **这 74 秒全花在 `ready` 之前**，`ready` 之后的
Electron/渲染侧基本不占时间。

**热点函数仍然没拿到**：`NODE_OPTIONS=--cpu-prof --cpu-prof-dir=…` 对 Electron 子进程无效（三个候选目录
跑完都没有 `.cpuprofile`，这个环境变量被 Electron 剥掉了），C 组因此标了 `-prof` 却没有产物。再往下定位要改
`dsh-desktop-host` 或用 `--inspect-brk` 附加，都超出本原型的范围。

顺带排除一个怀疑对象：**启动时没有在跑 pnpm/网络安装**。`<DSH_HOME>\profiles\desktop\` 下
`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`node_modules\.modules.yaml`、`.pnpm`、
`.pnpm-workspace-state-v1.json` 的 mtime 全停在 `10-10 17:53:37`，当天四次启动一次都没碰过。

## 十、发布前的可分发处理（素材、脱敏、dev-only）

要把仓库推到 GitHub，先解决三件在本地跑没问题、公开出去就有问题的事。

**1. 上游立绘不入库**。`PROVENANCE.md` 早就记着上游条款「as-is 随插件分发，仅用于运行本插件；
不授予再许可」，并由本项目自己写了「要公开发布或分发时，先替换成自己有权分发的形象」。做法：

| 项 | 处理 |
| --- | --- |
| `src/widget/whale-girl.png`（256 kB，上游素材） | 进 `.gitignore`，只留在作者本机；`CHARACTER_URL` 仍指向它，所以本机界面不变 |
| `src/widget/whale-girl-placeholder.svg`（2.3 kB，原创） | 入库、随 MIT 分发，作为默认形象 |
| 素材取不到时 | `whale.js` 给 `.dshw-body` 挂 `error` 监听，换成占位图并 `console.warn` 一次；已换过就不再换（防 error 死循环） |

断言跟着迁移：`test/plugin.test.js` 与 `scripts/e2e-check.js` 原来硬要求 png 返回 200 —— 那样 clone 完就是红的。
现在两条前缀都断言**占位图** 200 + `image/svg+xml`，另加一条「上游立绘必须是干净结果（200 或 404）」，
e2e 从 39 项变 **40 项**。浏览器侧的回落用 headless Edge `--dump-dom` 实证（见第六节末尾），不是看代码推断。

**2. 文档脱敏**。真机记录里带着本机账户与磁盘布局：`¥ 9.90 / 赠送 ¥5.08` 两处金额改成
`¥ <充值余额> / ¥ <赠送余额>` 并写明「数值确实在作者机器上取到了，公开仓库隐去」；
`D:\dsh\…` → `<DSH_HOME>\…`、`D:\dsh-desk-app\…` → `<DESK_APP>\…`、本仓库路径 → `<REPO>`、
`C:\Users\<本机账户>\AppData\Local\Temp\…` → `<TEMP>\…`。**毫秒计时、状态码、条目数、源码行号一个都没动** ——
那些是技术结论，不是隐私。端口 19387 保留（它是桌面宿主的固定值，写进公开文档才有排查价值）。

**3. dev-only 的宿主探针不入库**。`.dsh-probe/` 里有一个指向
`<DESK_APP>\resources\app\dsh\node_modules` 的 junction，还有引用宿主内部结构的探针脚本。
junction 本身恰好被 `node_modules/` 这条规则挡住，但整个目录仍不该公开，所以直接 ignore 掉 `.dsh-probe/`。
代价是文档第八/九节提到的探针产物别人复现不了 —— 已在第八节开头写明「`<...>` 是占位、探针属 dev-only」。

**验证**：干净 clone 目录里 `npm pack` → 37 files / 86.3 kB，产物无上游图；起服务后
`/widget/whale-girl.png` 回 404 JSON、两条占位图前缀回 200、`/api/state` 正常；
`npm test` 138/138、`npm run test:e2e` 40/40。另注意第六节记的那条坑：**`.gitignore` 挡不住 `npm pack`**，
本机工作目录里留着图就会被打进包。

> ⚠️ 本节的第 1 条已经被**第十一节**取代：立绘换成了本项目自己生成的一张，现在正常入库、正常分发。
> 而本节入库的那张兜底占位图 `whale-girl-placeholder.svg`，又在**第十二节**被删掉了。
> 上面两段历史记录保留原样，是为了说清「当时为什么那么做」，别当成现状读。

## 十一、换成本项目自带的立绘（去水印 + 抠图），并把素材口径改回来

上一节的处置是「上游图不入库，仓库只留占位图」。这一轮换成了**自己生成的一张**：
深蓝渐变长发 + 女仆装 + 鲸鳍耳 + 鲸尾的全身立绘，作者是本项目的使用者（用豆包出的图，含一张三视图设定表）。
于是素材口径整体翻转，涉及四处代码/文档与两条断言。

**图片处理**（做法与参数记在 `PROVENANCE.md`，脚本是临时的、不入库）：
去水印 → 边界连通洪泛抠背景 → 按包围盒裁切 → contain 到 610×610、底边居中 → 3×3 alpha 软化 + 预乘域去光晕。
结果 610×610 RGBA / 322 kB，不透明内容 1499×2337 原比例落到 391×610。

| 项 | 改动 |
| --- | --- |
| `src/widget/whale-girl.png` | 换成自备立绘，**入库、随 MIT 分发**（322 kB） |
| 上游 `DSniang1.png` | 移到 `.refs/upstream-DSniang1.png`，只作定位对照，代码不再引用；**同日（2026-10-12）已连同 `vibe_images/` 里两张 AI 出图草稿一起从本机删除** |
| `.gitignore` | 删掉 `src/widget/whale-girl.png` 那行；新增 `vibe_images/`（AI 出图草稿；该目录已删，规则留着挡住以后重新生成的） |
| `whale-girl-placeholder.svg` | 保留，角色从「默认形象」降级为「兜底形象」，回落逻辑不动 |
| `test/plugin.test.js` | 宿主前缀下 png 断言 `200 image/png`，占位图断言 `200 image/svg+xml`，两条都在 |
| `scripts/e2e-check.js` | 素材断言从「2 条占位图 + 1 条 png 可 200 可 404」改成 **4 条硬 200**（png/svg × 两条前缀），e2e 40 → **41 项** |
| README / PROVENANCE / limitations | 「仓库不带立绘」的表述全部改成「仓库自带一张自己生成的立绘，上游那张没进仓库」 |

**实测**（数字都来自本轮跑的输出）：

- `npm test` **138/138**；`npm run test:e2e` **41/41**（见第二节）。
- `git checkout-index -a` 落一份等价于 clone 的目录：**53 files / 750 KB**，起服务后
  两条前缀的 png 都回 `200 image/png 322296 B`，`--dump-dom` 里 `img` 的 src 是 png 不是兜底图，
  同一页截图与工作目录那张 **SHA-256 相同**（`98218cda…`）。细节在第六节。
- 兜底仍然可用：把 clone 里的 png 临时改名 → `GET` 回 `404 application/json`、`img` src 自动换成
  占位 svg；改回来又恢复 png。
- 真浏览器里看过渲染：演示页（深色背景）与 `/dsh.html`（宿主模拟）两张截图都确认立绘完整、
  卡片在她头顶留 4 px 间隙、脚下那片投影已经被抠掉，没有灰边。
- `npm pack --dry-run`：38 files / 411.9 kB / unpacked 551.3 kB，立绘是包里最大一项（322.3 kB）。

**没做的事**：没动 `.dshw-figure` 的 96 px 形象盒（全身像在这个盒子里脸只有十几像素，想更大要连动
卡片/菜单/气泡三个 `bottom` 值，属另一件事，记在 `limitations.md` 第 4 条）；没做无损压缩或降到 512×512；
没重装到 DSH 客户端重拍真机截图 —— 本轮改的只有素材字节与断言，挂载链路与 CSS 一行没动。

> ⚠️ 本节里「保留兜底占位图」「素材断言 4 条硬 200」「截图 SHA-256 相同」这三条都已被**第十二节**取代或订正。

## 十二、删掉兜底占位图，回落改成「隐藏形象层」

决定是仓库里不留第二张形象图，所以这轮是一连串减法。

| 项 | 改动 |
| --- | --- |
| `src/widget/whale-girl-placeholder.svg`（2.3 kB） | **删除**。仓库还没有第一个提交，它此前只是索引里的一个新增文件；删掉后 `git ls-files` 从 53 回到 **52**（本轮末尾补上 `test/helpers/tmp.js`，于是又是 53 —— 与素材无关） |
| `.refs/doubao-front.png`、`.refs/doubao-sheet.png`、`.refs/upstream-DSniang1.png`、`vibe_images/` | **全部从本机删除**（都是本就不入库的参考材料与出图草稿） |
| `src/widget/skin.js` | 去掉 `PLACEHOLDER_URL` 导出；新增 `.dshw-body[hidden] { display: none }` |
| `src/widget/whale.js` | `error` 监听从「换 src 为占位图」改成 `el.body.hidden = true` + 警告一次 |
| `scripts/e2e-check.js` | 素材断言 4 条 → **2 条**（png × 两条前缀），e2e 41 → **39 项** |
| `test/plugin.test.js` | 删掉占位图那条断言；单测总数不变（**138**，素材断言与 png 断言本来就在同一条 test 里） |
| README / PROVENANCE / limitations | 「仓库里唯一的一张图片」是句过头话（`public/favicon.svg` 还在），全部改成「唯一的一张**形象图**」 |

**当场抓到的 CSS 陷阱**：只写 `el.body.hidden = true` 不解决问题 —— 作者样式里 `.dshw-body { display: block }`
压过 UA 的 `[hidden] { display: none }`，元素照样画出来。补上 `.dshw-body[hidden] { display: none }` 才真藏掉；
本仓库早有 `.dshw-bonus[hidden]` / `.dshw-menu[hidden]` 两条先例，是同一个坑。

**实测**：`npm test` **138/138**、`npm run test:e2e` **39/39**（第二节）。第六节那份 clone 里
`GET /widget/whale-girl-placeholder.svg` 已回 `404 application/json`；把 png 改名后 `--dump-dom` 里是
`<img class="dshw-body" … hidden="">`、CDP 读到 `bodyHidden = true`，截图里没有裂图图标、只剩余额卡片与 ☰，
且挂件盒几何一点没变（`128×128`、四边 16 px）。窄视口五档 320/360/420/768/1280 横向溢出全 0。

**这轮订正了两条先前写下的结论**：

1. 上一节的「截图 SHA-256 相同」是拿 `--window-size=420` 截的，而该参数在 `--headless=new` 下被抬到
   **500 px 下限**（CDP 读到 `innerWidth = 500`）—— 两边同样错，SHA 才相同，它并没有证明过 420 档的排版。
   本轮改用 CDP `Emulation.setDeviceMetricsOverride` 覆盖视口、注入 `animation:none` 冻住 `.dshw-float`，
   再逐像素分区比对（结论见第六节）。
2. README 里「本项目没有下载过上游那张图」不属实（早期确实下载过做本地对照），复查时改成实话：
   取过一份对照、从未入库、从未随包分发、已于 2026-10-12 删除。

**顺带修掉一处「自己弄脏别人机器」**：五个测试文件各自 `fs.mkdtemp` 建数据目录却没人删，
`%TEMP%` 下堆了 **1,273 个 `dshw-*` 目录**（约 89 MB，跑一晚就这么多；`env.test.js` 本来就自己删的，
`e2e-check.js` 也一直在 `finally` 里 `rmSync`）。新增 `test/helpers/tmp.js` 统一建目录、
进程退出时统一 `rmSync`（删不掉就跳过 —— 清理逻辑不该把测试跑红），`app` / `dsh` / `plugin` /
`static` / `store` 五个文件改用它。修完两套各连跑一遍：`npm test` **138/138**、`npm run test:e2e`
**39/39**；把历史遗留全清掉再各跑一遍，跑完 `%TEMP%` 下的 `dshw-*` 目录数是 **0**，
`%TEMP%` 总体积从 230 MB 回到 141 MB。

**没做的事**：没重装到 DSH 客户端重拍真机 —— 本轮动的只有素材、`error` 回调和一条 CSS 规则，
注入链路与余额口径一行没碰；`.dshw-figure` 的 96 px 形象盒同样没动。

## 十三、换成立绘的 Q 版（大头）版本：从三视图设定表里裁正面

用户指令「把我自己本地换成一个小的q版的鲸鱼娘」，附一张自己持有的 **Q 版三视图设定表**
（1448×1086，RGB 无 alpha，背景近白 `#FCFCFC`）。这一轮只换素材字节，`skin.js` / `whale.js` / CSS 一行没动。

**1. 先量分界，不目测裁图。** 表里上排是同一角色的三个视图、下排是细节特写格，必须先确认边界：

- 行剖面（每 12 px 统计一次全宽非背景像素）→ `y=612` 与 `y=623` 两行**全为 0**，这就是上排与细节格的分界；
  第一次量时把下限取到 `0.60×h=651`，结果细节格的边框被当成内容，三个视图「连成一片、没有空隙」，
  是个假结论 —— 修正后取 `y=610`。
- 列剖面（在上排带内每 8 px 统计一次）→ 只有 4 段 ≥8 px 的全空列：
  `0..10`、`537..550`、`951..961`、`1438..1447`，据此切出正面 `x∈[11,536]`、侧面 `[551,950]`、背面 `[962,1437]`。
  取正面，四边各留几像素余量（洪泛要从纯背景边开始扩散），裁出 **540×611**。
- 右下角逐块看过：这张表**没有水印**（与上一版素材不同，那次右下角有「豆包AI生成」）。

**2. 抠图阈值是量出来的，四档对照。** 背景、脚下投影、鲸尾自身的浅色暗面三者在颜色上两两接近，
只有「通道差」这一维能把后两者分开（实测取样）：

| 取样 | 颜色 | 最亮通道 | 通道差 |
| --- | --- | --- | --- |
| 背景 | `#FCFCFC` | 253 | 1 |
| 投影（亮部/核心） | `#E3E2EE` / `#CDCCE2` | 238 / 226 | 12 / 22 |
| 鲸尾暗面 | `#868ABE` / `#95A5D8` | 191 / 216 | **56 / 67** |

| 判据（最亮通道 >, 通道差 <） | 洪泛吃掉 | 结果 |
| --- | --- | --- |
| `180, 50` | 134,239 px | 尾巴下缘被啃出**硬咬痕**（`#BBB6D0` 那类浅色通道差只有 26，落进判据里） |
| `225, 22` | 129,436 px | 尾巴完整，但脚下投影**整块留着**（亮部被抠、暗部剩下一片白） |
| `150, 45` | 134,715 px | 尾巴完整、投影干净 |
| **`170, 40`（采用）** | **134,329 px** | 尾巴渐变完整、投影整块消失，且与尾巴暗面之间留了 15 的通道差余量 |

同一档判据用两种实现各跑一遍（编译 C# 的 4 邻域洪泛 vs `scipy.ndimage.label` 的 8 邻域），
洪泛像素数**都是 134,329**，两边对得上才继续。

**3. 一个当场造成的破坏（已回退重做）**：复用了上一版的处理脚本，其中「右下角水印探测」这一步
在这张图上**误把鲸尾当成墨迹**，用四角双线性插值涂掉了 `(344,507)-(515,610)` 里的 **7,970 px**。
发现方式是输出图右下角出现一块与周围对不上的灰斑，回源图放大比对才确认那是尾巴的暗面。
修法是**把这一步禁掉**（这张表本来就没有水印），而不是去调探测器的阈值 —— 那个探测器假设
「右下角只可能是平滑背景」，对带大尾巴的角色图根本不成立。第二遍跑出的报告里 `no-watermark` 一行就是它被禁掉的证据。

**4. 产出与几何**：`src/widget/whale-girl.png` = 610×610 RGBA / **551,277 B**，
不透明包围盒 `(37,0)-(572,609)` → **536×610，长宽比 0.879**（上一版全身是 391×610 → 0.641）。

**5. 浏览器实测**（browser-use 本轮仍不可用：`navigate_page` 照 `isDestroyed` 报错；改用无头 Edge + CDP，
`Emulation.setDeviceMetricsOverride` 造视口，并注入 `animation:none` 冻住 `.dshw-float` 再量）：

| 视口 | 根盒 | 形象盒 `img` | 不透明部分渲染 | 卡片盒 | 横向溢出 |
| --- | --- | --- | --- | --- | --- |
| 1280×800 | 128×128 | 128×96 | **84×96** | 82×42 | 0（`scrollWidth==clientWidth`） |
| 380×700 | 128×128 | 128×96 | 84×96 | 82×42 | 0（365/365） |
| 320×640 | 128×128 | 128×96 | 84×96 | 82×42 | 0（305/305） |

三档数字完全一致，说明这次换图没有把布局推离原来的锚点：卡片底边在 1280 档是 `y=684`，
形象盒顶边 `y=688`，**留 4 px 不重叠**；`imgHidden=false`、`natural=610x610`（素材真的加载到了，不是靠 200 状态码推断）。
横向比上一版宽了 38%，但 84 px 仍小于根盒 128 px，左右各余 22 px。

**6. 回归**：`npm test` **138/138**、`npm run test:e2e` **39/39**（素材断言两条前缀都过：
`/widget/whale-girl.png` 与 `/dsh-whale/widget/whale-girl.png` 均 200 / `image/png` / 551,277 B）。
`npm pack --dry-run` = **37 files / 646.8 kB / unpacked 791.7 kB**，立绘 551.3 kB 是最大的一项
（上一版是 415.6 kB / 立绘 322.3 kB）。

**踩到的工具坑（记一笔，省下次的时间）**：给 CDP 拼 `Runtime.evaluate` 表达式时，我把模板字符串的
`${` 写进了普通字符串拼接（`'JSON.stringify((${' + fn + '})())'`），页面回的是
`SyntaxError: Unexpected token '{'`，`lineNumber: 0, columnNumber: 17`。这个位置看着像 CDP 或浏览器的问题，
实际是我自己多打了一个 `$`；判据是把同一个函数体用正确拼法发到**同一个 target** 上，立刻拿到结果。
顺带：同步表达式不需要 `awaitPromise`。

**没做的事**：没重启桌面客户端复拍真机（本轮只改素材字节）；没做有损压缩（不引入图像依赖，
要瘦身就降画布尺寸，见 `limitations.md` §4）。



## 十四、设置面板与 ☰ 不随 `大小`缩放（控件层拆出缩放层）

用户指令「他的大小设定的菜单栏不应该跟随挂件的大小而改变大小，而是一个固定的让用户能舒服的修改大小音量这些东西」。

### 1. 结论先说：为什么必须换一棵 DOM 树

原来的写法是面板和 ☰ 都在 `.dshw-root` 里面，`root.style.transform = scale(s)` 会把它们一起缩掉：
scale 0.5 时 208 px 的面板变 104 px、12 px 的字变 6 px。

**光改成 `position: fixed` 逃不掉** —— 这是本轮最关键的一条 CSS 事实：`fixed` 只是改变**包含块**，
祖先一旦带 `transform`（或 `filter` / `will-change: transform`），fixed 后代照样会被那个 transform 作用。
所以只有两条路：

| 方案 | 结论 |
| --- | --- |
| 反缩放 `scale(1/s)` 塞回缩放层里 | 否掉。极端档位（scale 3）raster scale 可能取到 3 让文字发虚；clamp 要在「布局空间 ÷ scale」里绕一圈；`transform-origin` 组合易错 |
| **控件移出缩放层，成为 `body` 下 `.dshw-root` 的兄弟节点 `.dshw-controls`** | 采用。尺寸天然恒定价，代价是坐标自己算 |

落点：数值规则照旧进 `core`（`placeControls()` 是 `src/core/layout.js` 里的纯函数，非有限数字一律 `TypeError`），
`whale.js` 只做 DOM 胶水并新增 `paintControls()`；结构与被否掉的方案写在 [`architecture.md`](architecture.md) 第七节。

### 2. 静态实测：三档视口 × 五档 scale（无头 Edge 155.0.4283.45 + CDP，`Emulation.setDeviceMetricsOverride` 造视口）

每档都量 `getBoundingClientRect` 实测值，不看代码推断。**39 组场景（15 组初位 + 24 组贴边）里面板尺寸全是 `208x183`，一行不差**：

| 视口 | scale | 挂件根盒 | 面板实测（尺寸@坐标） | 字号/滑块高 | ☰ | 四向溢出 | 压卡片/本体/按钮 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1280×800 | 0.5 | 64×64 | 208×183 @ (1056,522) | 12px / 16px | 22×22，居中差 0、脚边差 0 | L0 T0 R0 B0 | 0 / 0 / 0 |
| 1280×800 | 3 | 384×384 | 208×183 @ (1056,168) | 12px / 16px | 同上 | 全 0 | 0 / 0 / 0 |
| 420×760 | 0.5 | 64×64 | 208×183 @ (8,482) | 12px / 16px | 同上 | 全 0 | 0 / 0 / 0 |
| 420×760 | 3 | 384×384 | 208×183 @ (192,128) | 12px / 16px | 同上 | 全 0 | 0 / 0 / 0 |
| 320×700 | 0.5 | 64×64 | 208×183 @ (8,422) | 12px / 16px | 同上 | 全 0 | 0 / 0 / 0 |
| 320×700 | 3 | 384×384 | 208×183 @ (104,68) | 12px / 16px | 同上 | 全 0 | 0 / 0 / 0 |

（1 与 1.5、2 档同样恒定价，完整 39 行输出在本轮脚本 stdout。）
scale 0.5 时面板 208 px 比挂件本人 64 px **大三倍多** —— 这是刻意的，写进 [`limitations.md`](limitations.md) §7。
另外每一组都验了「面板中心 `elementFromPoint` 命中面板自身」，即没被别的层盖住。

### 3. 真输入拖拽：贴四边 × scale 0.5/1/3 × 三档视口 = 36 组，全 PASS（本机临时端口：服务 4189、CDP 9334）

拖拽是**必须复验**的部分：贴边改变了挂件坐标，面板要跟着换边贴位。举几组代表数字：

| 场景 | 挂件实测 | 面板实测 | 命中的规则 |
| --- | --- | --- | --- |
| 1280×800，拖到左缘，s=1 | 128×128 @ (16,16) | 208×183 @ (8,**152**) | 头顶要 `16-183-8 < 0` 放不下 → 翻到脚下 `16+128+8` |
| 1280×800，拖到右缘，s=1 | 128×128 @ (1136,16) | 208×183 @ (**1056**,152) | 右对齐挂件右缘 `1136+128-208` |
| 420×760，拖到右缘，s=0.5 | 64×64 @ (340,16) | 208×183 @ (**196**,88) | 挂件在左缘时 `x=8`，在右缘时按 clamp 落在 196 |
| 320×700，拖到底缘，s=3 | 384×384 @ (0,400) | 208×183 @ (104,**68**) | 脚下放不下 → 贴顶 `y=gap`，宁可盖住人也别摸不到控件 |
| 1280×800，拖到上缘，s=3 | 384×384 @ (880,16) | 208×183 @ (1056,**408**) | 翻到脚下 `16+384+8` |

每一组的判定项：面板尺寸恒 208×183、字号 12px、四向溢出 0、不压卡片、不压本体、面板可点、拖拽途中面板跟手。36/36 PASS。

**拖拽手法这一轮换了**（前几轮的方法在这里失效，记下来避免重复踩）：
`dispatchEvent` 合成的 `PointerEvent` **拖不动这个挂件**。根因是手势处理里有 `el.stage.setPointerCapture(pointerId)`，
合成指针的 id 不在浏览器活动指针集合里 → 抛 `NotFoundError`；而监听器内部的异常**不会**从 `dispatchEvent` 传出来，
于是 `gesture` 根本没被赋值，看上去像「代码没响应」而不是「事件不合法」。本轮的静态探针输出里那一列
`拖拽=ok/没移动` 就是这条路的失败证据（挂件留在初位）。改用 CDP `Input.dispatchMouseEvent`
（`mousePressed`/`mouseMoved`/`mouseReleased`）走真输入管线后，36 组全部跑通。

顺带一个取证坑：第一次出截图时按「初位应当贴在右下」算裁剪框，但前面的拖拽已经把挂件留在了左缘，
裁出来是空的。改成**先回报实测矩形、再按那个矩形裁**（`shot.mjs`）才对 —— 复用脚本前先确认它的取样区假设。

### 4. 目视与清晰度

`deviceScaleFactor 2` 截图两份（`full-0.5.png` / `full-3.png` 与按实测矩形裁出的 `crop-0.5.png` / `crop-3.png`，
均在作者本机临时目录，**未入库**）：scale 0.5 那张是「小挂件 + 全尺寸面板」，scale 3 那张面板仍是 208 px 且
**文字边缘锐利** —— 因为它压根没进 raster 缩放，反缩放方案担心的发虚在这里不存在。

### 5. 回归

- `npm test` **143/143**（新增 5 条覆盖 `placeControls`：默认贴位、面板尺寸恒定、四向 clamp、翻脚下、贴顶、非有限数字抛错）。
- `npm run test:e2e` **39/39**，无新增项（控件层是 DOM 结构改动，端口与契约都没碰）。
- 镜像、吸附、拖拽、`隐藏菜单`、音效与余额显示均按原路径复验：`.dshw-controls.menu-hidden` 接管了原来
  `.dshw-root.menu-hidden` 的职责，☰ 的显隐逻辑没变。
- `npm pack --dry-run` = **37 files / 654.9 kB / unpacked 811.2 kB**（文件数与第十三节的 37 一致，只多文档字节）。

### 6. 这一轮没做的

- **气泡 `.dshw-bubble` 仍在缩放层里**，scale 3 会顶出视口上沿（`limitations.md` §7 那条老坑，本轮范围是控件层，没有扩到手势/气泡层）。
- 没重启桌面客户端复拍真机（本轮改的是挂件 DOM 结构，真机那一屏仍属未验，见第十五节）。


## 十五、没做/没验的

见 [`limitations.md`](limitations.md)。本轮之后仍然欠着的：

- **真机那两个金额没有和官网逐项对过**（充值余额与赠送余额两处数字，公开仓库里已隐去）。挂件显示的取自宿主账号服务，与官方设置页同源，
  但「同源」是读源码得出的结论，最终对数得你在官网看一眼。上一轮那个「1235.00 对不上」的教训就是：
  口径看着对不代表数对。
- **冷启动红脸最多 60 秒**（首拍早于宿主登录）没修，属体验取舍，等你决定要不要让 `unconfigured` 也短间隔快探。
- **启动耗时的热点函数没拿到**：本插件的 A/B 已经做完（见第九节，结论是无关），但 `--cpu-prof` 被 Electron
  剥掉，那 74 秒落在宿主的哪个函数上仍只有源码级推断；`dsh-purge` 那一侧也没单独摘下来测过（它是从 GitHub 拉的
  tar.gz 依赖，摘它要动 `node_modules`，风险比测出来的收益大）。
- 带真实密钥的**独立服务**链路仍未跑通（本机没有可用 key；真机那条是走宿主服务，不是走 key）。
- **换立绘之后没有重开桌面客户端复拍真机截图**。安装是 junction（`<profile>/node_modules/dsh-whale-widget-proto`
  → 本目录），新素材已经在客户端能看到的那份目录里；第十二、十三两轮改的都只有素材字节（第十三连代码与 CSS 都没动），
  注入链路与余额口径一行没碰，而真机重启一次要 75–92 秒。形象本身在真浏览器里验过（第六节末、第十一节、
  第十二节、第十三节的三档 CDP 实测），**真机那一屏仍属未验**。
- **第十四轮改了挂件的 DOM 结构**（控件从缩放层里拆成兄弟节点），这一条比换素材更需要在真机上看一眼：
  宿主注入的样式表里如果有针对 `.dshw-root > *` 之类的通配规则，理论上可能碰到新的 `.dshw-controls`。
  本轮只在独立服务的演示页与 `/dsh.html`（模拟注入页，e2e 第 49 行那条）里验过，**宿主界面里那一屏仍未验**。
