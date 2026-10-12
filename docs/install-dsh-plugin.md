# 装进 DSH 客户端：展开版

> 给 [`README.md`](../README.md) 的「装进 DSH 客户端（作为插件）」当补充说明。
> **先照 README 那三步做**，那三步正常情况下够用；这里放的是它省略的细节：
> 命令为什么这么写、跑不动时手工怎么装、没出现怎么查、以及插件契约与 AI 助手清单。

## 名词先对上

| 词 | 意思 |
| --- | --- |
| profile | DSH 按形态分开的插件目录。桌面客户端读 `desktop`，网页版读 `web`。桌面的位置由宿主的 `DSH_HOME` 决定，本机是 `D:\dsh\profiles\desktop` |
| `dsh plugin` | 桌面客户端自带的命令行。它**自己不干安装**，只把参数转发给 pnpm，成功后再把插件名写进该 profile 的 `dsh.profile.bundles` |
| `link:` | 软链接安装：profile 里只记一个指向你磁盘目录的链接，所以**改源码不用重装**；代价是**装完别移动/重命名那个目录**，移动了要重新 `add` 一次 |
| `bundles` | profile 的插件清单。客户端启动时按它装载 —— 这也是「手工安装」要补的第三样东西 |

命令里的路径必须是**仓库根的绝对路径**，也就是包含 `package.json` 的那一层，别多套一层同名目录。

两条命令的区别（`--profile` 后面那个词）：

```powershell
dsh plugin --profile desktop add link:D:\path\to\dsh-whale-widget-proto   # 桌面客户端
dsh plugin --profile web     add link:D:\path\to\dsh-whale-widget-proto   # 网页版
```

上游那条线还有「在客户端会话里直接说一句，让客户端自带的插件管理器装 npm 上的 `dsh-whale-widget`」这条路
（写在它的 README 里，**本机没验过**）。本原型没发到 npm（`package.json` 里 `private: true`），
所以这里只能走 `link:`。

## 命令跑不动时：手工做等价动作

`dsh plugin … add` 要求 **pnpm 能联网** —— 它会顺带重解析该 profile 里**已有**的依赖。
本机就是这种情况：GitHub 拉不动，报 `ERR_PNPM_TARBALL_INTEGRITY` → `UND_ERR_SOCKET`，
加 `--offline` 则 `ERR_PNPM_NO_OFFLINE_TARBALL`（说明那个 tarball 不在本机 store 里）。

这不是插件的问题，**本插件不需要任何第三方依赖**（`dependencies` 是空的），只是 pnpm 顺手要动别人。

客户端启动时读的就是这三样东西，直接把它们补上（先备份 `<profile>/package.json` 与 `pnpm-lock.yaml`）：

1. `<profile>/node_modules/dsh-whale-widget-proto` → 指向本目录的 junction；
2. `<profile>/package.json` 的 `dependencies` 补 `"dsh-whale-widget-proto": "link:<本目录绝对路径>"`；
3. 同文件 `dsh.profile.bundles` 末尾追加 `dsh-whale-widget-proto`。

### 不重启先验一次装配结果

`dsh --profile desktop --dump-config` **会被拒**（`profile "desktop" is managed exclusively by the
Electron application`，desktop profile 归 Electron 应用管），所以改用客户端启动时的同一份库函数：
`node -e` 调 `@deepseek-ai/dsh-app-boot` 的
`loadProfileDirectory('dsh', <profile目录>, <dsh 包 package.json>)`，确认

- 本包在 `layers` 里；
- 没落进 `skippedBundles`；
- `composeEntries` 的结果含 `{id:'dsh-whale-widget-proto'}`。

本机有跑完这整套动作的脚本 `.dsh-probe/verify-install.mjs`，输出长这样（`条目位置 188/188` 是因为
`insert` 追加在末尾）：

```
装载成功的层      @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-purge, dsh-whale-widget-proto
本插件的层        D:\dsh\profiles\desktop\node_modules\dsh-whale-widget-proto
  patch 文件      …\cordis.patch.yml
组合后条目总数    188
本插件条目        {"id":"dsh-whale-widget-proto","name":"dsh-whale-widget-proto"}
profile 组合通过：客户端启动时会加载本插件
```

> 这条校验只证明「**会被装载**」，不证明「**装载得起来**」—— 后者要等重启完、看右下角才算数。
>
> `.dsh-probe/` 整体是 **dev-only、不入库**：它靠指向宿主 `node_modules` 的 junction 才跑得起来。
> 在别人新克隆的仓库里没有这个目录，不要把里面的脚本当成通用步骤引用。

## 为什么必须「完全退出」再开

改完不重启不会生效，有两个独立原因：

- 运行中的实例**不会热加载 profile**；
- 注入表只在宿主 `ready` 时收集**一次**（`ctx.webServer.collectIndexInjections()` 经 IPC 交给 Electron）。
  所以晚激活的插件即使路由补上了，页面里也不会有它。

「完全退出」= **托盘图标右键退出**。点窗口右上角的 ✕ 只是把窗口藏起来，进程还在；
此时再点图标会被 Electron 的单实例锁吞掉，看起来就像「客户端打不开」。
要确认是不是同一个实例：`Get-Process` 看 `StartTime`。

## 启动那一分多钟花在哪

本机实测完整客户端启动 **75–92 s**。这几十秒里宿主在 CPU 密集地装载 profile 里的 188 个模块
（从 121 MB 的 `app.asar` 读），并且要 `await` 完 `desktop-office` 才发 `ready`，
而 Electron 的界面必须等这张注入表。

**挂件不是瓶颈**：它在这 74 秒里只占 **67 ms**。做过摘掉插件的 A/B —— 不带插件 75.7 / 78.6 s，
带插件最快一次 74.8 s，**耗时与插件无关**，「转圈很久」别怀疑到插件头上
（八组采样与分段计时见 [`verification.md`](verification.md) 第九节）。

顺带一句：宿主启动**不跑 pnpm**，别怀疑「每次启动都在装依赖」。

## 没出现怎么查

**先确认客户端真的重启过**（`Get-Process` 的 `StartTime`），这一步排掉的是最常见的假故障。
然后朝宿主端口要一次状态。桌面宿主固定监听 `127.0.0.1:19387`（**不是**你手动起服务时的 3080）：

```powershell
curl.exe http://127.0.0.1:19387/dsh-whale/balance.json
```

写 `curl.exe` 而不是 `curl`：PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，
404/401 会变成一屏红色异常，反而看不出状态码。

| 回的是 | 含义 | 接着做什么 |
| --- | --- | --- |
| 空 body 的 **404** | 路由没注册 | 十有八九是插件激活失败，走下面两段 |
| `503 {"code":"guard-unavailable"}` | **不是故障**：宿主的 `connection` 服务还没注册（启动头两百毫秒内是正常现象） | 稍等再试一次 |
| `401 unauthenticated` | 路由在、门禁在，只是你这次请求没带宿主会话 | 说明装上了，回客户端界面里看她 |

下结论之前，拿同一个 profile 里**已加载的第三方插件**做对照（本机 `dsh-purge` 的 `/redteam/api`
未登录也回 `405 {"ok":false,"error":"POST only"}`，说明插件路由不需要会话就能命中）。

激活失败**不会弹界面，也不写日志文件**：原因只进引擎 stderr，而 Electron 把 stderr 收在内存里
（只留最后 64 KB，且只在启动整体失败时展示），所以没有现成的日志可翻。
离线复现办法：用宿主自带的真 `cordis-plugin-loader` 把插件走一遍装载
（`.dsh-probe/loader-probe.mjs`，同上不入库），它会直接把 `cannot get property "x" without inject`
这类原因打出来。最后一处可查的是 `index.html` / `collectIndexInjections()` 里有没有那一行
`import('/dsh-whale/widget.js')`。

## 余额什么时候开始动

余额来源按三级回落，**每次轮询重新判定**：已登录的 `ctx.deepseekAccount.getBalance()` →
宿主凭据库的 `DEEPSEEK_API_KEY` → 环境变量。三级都没有时挂件显示「未配置」，不会伪装成 0 元。
数据落盘默认跟着宿主走：`$DSH_HOME/whale-widget`（可用 `DSHW_DATA_DIR` 覆盖）。

冷启动后挂件会有**最多 60 秒**显示「宿主没有可用的余额来源（…）」+ 灰脸，然后自己变成真实余额。
**这不是 bug，但很吓人**：原因是宿主的 `authenticateWebHost` 排在引擎 `ready` 之后，
而挂件第一拍是立即取数 —— 那一刻确实没有会话。`unconfigured` 属配置类错误，按正常轮询间隔重试。
（卡片这里透传 provider 原文，所以哪一级来源没给数是直接写在界面上的，不用去翻看不存在的引擎日志。）

**要缩短这段得同时改两处**：引擎侧 `DSHW_INTERVAL_MS`（默认 60000，可调）与前端
`assets/whale-widget.js` 里写死的 `INTERVAL_MS = 60_000`；只调环境变量不够，
因为浏览器那一拍也要 60 秒才再问一次。

## 插件契约细节（装机不用看，改代码前看）

`lib/index.js` 是一个 cordis 插件（`export function apply(ctx, config)` + `inject: ['webServer']`），
契约按本机桌面安装里的**真包**核实，并分别用真 `dsh-host-webserver`（16/16）和真
`cordis-plugin-loader`（9/9）跑通，见 [`verification.md`](verification.md) 第八节。
挂载声明是根目录的 `cordis.patch.yml`（`package.json` 的 `dsh.bundle.patch` 指向它），插件 id 用
`dsh-whale-widget-proto` 而不是上游的 `dsh-whale-widget`，避免和已发布同名包冲突。

> **导出形状是硬约束**：真 Loader 的 `unwrapExports()` 先取 `default`，所以 `export default apply`
> （裸函数）会让 `inject` 整体丢失，插件在客户端里静默激活失败。本仓库用
> `export default { name, inject, apply }`；改这一行前先看 `test/plugin.test.js` 里那条照抄
> `unwrapExports()` 的用例。

## 给 AI 助手：可以照着执行的清单

目标：把 `dsh-whale-widget-proto` 装进 DSH 的 **desktop**（桌面客户端）或 **web** profile。

1. 装前确认三件事：`package.json` 带 `dsh.bundle.patch: "./cordis.patch.yml"`、`main`/`exports`
   指向 `lib/index.js`，且 `lib/index.js` 的 `default` 导出是 `{ name, inject, apply }` 而不是裸函数；
2. 先备份 `<profile>/package.json` 与 `pnpm-lock.yaml`，再执行
   `dsh plugin --profile desktop add link:<本目录绝对路径>`（路径必须是仓库根，且绝对）；
   pnpm 因网络失败时按上面「手工做等价动作」三条落盘，**不要跳过 bundles 那一步**；
3. 校验组合结果：走上面「不重启先验一次装配结果」那条 `loadProfileDirectory` 路径，
   确认本包在 `layers` 里而不在 `skippedBundles` 里。**这条只证明「会被装载」，不证明「装载得起来」**
   —— 第 4 步才是；
4. 完全退出客户端再启动（托盘右键退出，不是 ✕），右下角应出现鲸鱼娘；若没有，按「没出现怎么查」的顺序查：
   `StartTime` → `balance.json` 的状态码对照表 → 真 Loader 探针 → 注入行；
5. 别把冷启动那 60 秒的「宿主没有可用的余额来源」当成激活失败，先等一个轮询间隔再判断。

`dsh.cmd` 不在 Git Bash 的可执行名解析里（`which dsh` 找不到），用全路径
`<客户端安装目录>\resources\runtime\cli\bin\dsh.cmd`。另外 `dsh plugin … --help` 会把 `--help`
**一起转发给 pnpm** 并打出 pnpm 的帮助，不能用它核对 dsh 自己的参数；要看 dsh 侧的行为，
就故意不给动作参数，它会回自己那句话：`error: plugin needs pnpm arguments to forward
(e.g. add <package>)`。
