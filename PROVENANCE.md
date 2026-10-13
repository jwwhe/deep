# 来源说明（PROVENANCE）

本原型是**独立实现**，不是 fork、不是逐行照搬。这里记录参考了什么、怎么拿到的、哪些地方刻意对齐。

## 参考项目

| 项 | 值 |
| --- | --- |
| 仓库 | <https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget> |
| GitHub repo id | `1337920628`（`R_kgDOT78MdA`） |
| 官方描述 | 「DeepSeek Harness（DSH）一只住在 DSH 界面右下角的小鲸鱼娘，帮你盯着 DeepSeek 账户余额。QQ弹弹，支持拖拽吸附、左吸附翻转、数字滚动动画，随界面自动启用」 |
| 许可 | MIT（GitHub API `license.spdx_id`） |
| 默认分支 / 最近推送 | `main` / 2026-10-07 |
| 采集时间 | 2026-10-11 |

**获取方式**：本机 `github.com` 的 raw 与 443 直连不稳定，因此通过 `api.github.com` 取仓库元数据与
README/`package.json`/`cordis.patch.yml` 内容，副本留在 `.refs/`（仅本地参考材料，已在 `.gitignore` 里，
且不在 `package.json` 的 `files` 白名单中，不随包发布）。

## 从参考项目借用的东西（都是「契约」与「定位」，不是代码）

| 借用的点 | 落到本项目的哪里 |
| --- | --- |
| 产品定位：右下角一只鲸鱼把余额变得一目了然；拖拽吸附、左吸附翻转、数字滚动、随界面自动启用 | 整个功能范围（`src/widget/whale.js`） |
| DSH bundle 契约：根 `package.json` 带 `dsh.bundle.patch`、`main: lib/index.js`、`assets/whale-widget.js` 作注入入口、`dsh plugin --profile web add link:<路径>` 安装 | `package.json`、`cordis.patch.yml`、`assets/whale-widget.js`、`lib/index.js` |
| 宿主接口字段名：`GET /dsh-whale/balance.json` 给 `totalBalance` | `src/server/dsh-routes.js` 的 `toDshBalance()` |
| 安全边界：写配置只允许本机回环，远端要显式放行 | `src/server/app.js` 的 `canWrite()` + `DSHW_ADMIN_HOSTS` |
| 轮询节奏 60 秒 | `DSHW_INTERVAL_MS` 默认值 |
| 上游无 key 时回**纯文本 401 `Authentication Fails (governor)`** | `src/server/providers/deepseek.js` 把 `JSON.parse` 失败当常态路径处理（本项目 2026-10-11 独立复测确认） |
| 「装完右下角什么都没有」这类静默失效是最难查的故障（参考项目 issue 里出现过） | `lib/index.js` 缺 `register` 直接抛 `TypeError`，不静默 |
| **鲸鱼娘形象这个「定位」**（右下角站一个二次元形象，不是小鲸鱼图标） | 本项目自带 `src/widget/whale-girl.png`；上游 `assets/DSniang1.png` **未被沿用**，见下方「美术素材的许可边界」 |

## 本项目自己的东西（不是从参考项目来的）

- **零依赖 + 无构建步骤**的双侧同源解析设计：`src/core` 同一批文件既被 Node `import`，又被浏览器按
  URL 前缀解析（详见 [`docs/architecture.md`](docs/architecture.md) 第二节）。参考项目是打包产物形态。
- **BigInt 定点金额**（1e-8 元）与 JSON 里走字符串，避免浮点漂移。
- **状态机双侧复用**：`createBalanceTracker` 同时驱动服务端轮上游和客户端轮 `/api/state`，
  stale/退避/并发去重只有一份实现。
- **按自然日记账的 ledger**（`baseline / unchanged / spend / adjustment / rollover` 五类观测）。
- 分层与注入式可测性、146 条单元测试、39 项 e2e、浏览器四档宽度与拖拽/吸附/镜像实测。

## 与参考项目的差异（有意为之）

- 不做用户体系/鉴权/多租户/付费，也不做泡泡点击序列、逐行字体、自定义角色动图音效等非核心边缘功能。
- 包名与插件 id 用 `dsh-whale-widget-proto`，**不与上游 `dsh-whale-widget` 同名**，避免在同一 profile 里冲突。
- `private: true`，未发布到 npm。

## 宿主契约的来源（不是抄来的，也不是假设）

`lib/index.js` 的 cordis 契约（`apply(ctx, config)` + `inject`、`ctx.webServer.register({kind:'prefix'})`、
`webserver/index-inject` 的行形状、`ctx.deepseekAccount.getBalance(client)`、`ctx.connection.admit(req)`）
是从本机桌面安装自带的 `@deepseek-ai/*` 包里**逐个读源码核实**的，并用真 `@deepseek-ai/cordis`
+ 真 `@deepseek-ai/dsh-host-webserver` 跑过探针（`docs/verification.md` 第八节）。
上游仓库只提供了「路径前缀 `/dsh-whale`、字段名 `totalBalance`、bundle 声明形状」这层对外契约。

还有一处契约是**被真机打脸之后才补读源码**的：插件模块的导出形状。
`@deepseek-ai/cordis-plugin-loader/lib/index.js` 的 `unwrapExports()`（读于 2026-10-11）先取
`exports.default ?? exports`，因此 `export default apply` 这种裸函数 default 会把模块上的 `inject`
丢掉，宿主侧表现为「插件激活失败、路由没注册」，且只写进引擎 stderr。同 profile 里能正常工作的
`dsh-purge` 两种形状都规避了这一点（`lib/redteam/ui.js` 不给 default；`lib/redteam/index.js` 给
`export default { name, inject, apply }`），本仓库采用后者。

「余额该显示什么」这一条口径来自宿主自己的设置页源码，不是猜的：
`@deepseek-ai/dsh-client-ui-settings-account/lib/client.js`（读于 2026-10-11）把
`details.balance.value` 渲染成「余额」一行，把 `details.balance.bonusWallets` 过滤出 `> 0` 的项
渲染成**另一行**「赠送余额」（一条都没有时 `showBonusRow` 为假，整行不出现），两者从不相加。
本挂件默认按同一口径显示：只显示充值钱包，赠送为零时那一行不画（`includeBonus: true` 才合并）。

`getBalance()` 在真实登录态下的返回体：结构仍按源码写（`value` / `bonusWallets` 两组 `{currency, balance}`），
但真机已经取到过数 —— 用户客户端里显示出来的数比官网大，正是「充值 + 赠送被加成一个总数」的表现，
这反证了两组钱包都真的在返回体里。结构对不上时仍然报错而不是显示 0（`src/core/wallets.js`）。

## 美术素材的许可边界（重要，别读漏）

上表的「仓库许可 MIT」原本**只覆盖代码**。上游 `PROVENANCE` 里明确写着：`assets/**` 的图片 / 动图 / 音效
是 AI 生成、出处不可考，**不在 MIT 覆盖范围内**，条款是
「as-is 随插件分发，仅用于运行本插件；不授予再许可，也不声明为原创作品」，并且上游设有 takedown 渠道。
所以本仓库的形象是**自己生成的一张**，与上游素材没有像素关系。

| 素材 | 来源 | 分发 |
| --- | --- | --- |
| `src/widget/whale-girl.png`（610×610 RGBA，透明底，551 kB；不透明部分 536×610） | 本项目作者用 AI 生成的**Q 版三视图设定表**（1448×1086）里的正面视图，再经下述三步处理 | 随 MIT 分发，是仓库**唯一**的一张形象图（`public/favicon.svg` 是演示页图标，与形象无关） |
| ~~上游 `assets/DSniang1.png`~~ | 曾经 `api.github.com/repos/MeteorNOX/DeepSeek-Balance-Whale-Widget/git/blobs/f46b232152ede43630407f3a38de29c07a91be91` + `Accept: application/vnd.github.raw` 下载（2026-10-11），当时放在 `src/widget/whale-girl.png` 做本地对照 | **已于 2026-10-12 从本机删除**。从未提交进仓库、从未出现在 `npm pack` 产物里；现在那张 png 与它没有像素关系 |

当前这张 Q 版的处理过程（脚本是临时的，不入库；**源表也没有入库**，只有裁出来的这一张进仓库）：

1. **裁出正面视图**：设定表上排是同一角色的三个视图，按列做「非背景像素计数」找空白列，
   切出三段：正面 `x∈[11,536]`、侧面 `x∈[551,950]`、背面 `x∈[962,1437]`；上排内容与下面的细节特写格
   之间有一条全空行（`y=612..623`），据此把裁切下限定在 `y=615`。取的是**正面**那一段，左右各留几像素，
   让下一步的洪泛能从纯背景边上开始扩散。
2. **抠背景**：从画框四边做连通洪泛，判据是「最亮通道 > 170 且 最亮-最暗 < 40」。
   连通性是这里的关键：白围裙、白蕾丝头饰同样亮且低饱和，但它们被深色描边包住，洪泛从边界进不去。
   **阈值是量出来的，不是拍的**：`(180,50)` 会把**鲸尾自身的浅色暗面**（`#BBB6D0` 一类，最亮通道 208、
   通道差 26）当背景吃掉，尾巴下缘出现硬咬痕；`(225,22)` 尾巴完整但脚下投影整块留着。
   投影是「亮且近中性灰」（`#E3E2EE`、`#CDCCE2`，通道差 10~22），尾巴暗面是「偏蓝」（通道差 55~68），
   两者在「通道差」这一维上分得开 → 取 `(170,40)`，实测尾巴渐变完整、投影整块消失。
   这一步**没有做去水印**：这张表右下角是干净的（逐块看过），而且探测器的取样区
   （右下 1/3 × 底部 15%）正好被鲸尾占住，早先一次没关掉它，直接把尾巴当成墨迹用双线性插值涂掉了
   —— 探测器假设「右下角只可能是平滑背景」，这个假设在带大尾巴的角色图上不成立。
3. **裁切 + contain**：按不透明像素的包围盒（526×599）裁掉空白，等比放进 610×610 画布、底边居中，
   对齐 `.dshw-figure` 的 `object-position: bottom center`。边缘做 3×3 alpha 软化，并在预乘域里
   减掉 `(1-a)×局部背景` 解掉描边上的浅色光晕。

> 上一版形象（同一角色的全身「御姐」比例立绘，610×610 / 322 kB，不透明部分 391×610）已于 2026-10-12
> 被这张 Q 版替换，但仍留在 git 历史的首个提交里。它的做法与上面同构，差别是：源图是 1723×2433 的
> 全身正面单图（不需要裁视图），右下角有一块「豆包AI生成」水印，所以第 1 步之前多做一次
> 「墨迹框 + 四角双线性插值」的抹除（实测框 `(1132,2263)-(1696,2412)`，6975 px），
> 洪泛阈值当时用 `(180,50)` 就够（那张图没有贴着背景的浅色大面积渐变）。

结论：本项目对外以 MIT 授权**自己写的代码 + 自己生成的这张图**。
换形象时把图放成 `src/widget/whale-girl.png` 即可（`skin.js` 的 `CHARACTER_URL` 指向它）；
仓库里不再有任何备用图片，立绘取不到时 `whale.js` 直接把形象层 `hidden` 掉，只留余额卡片。
上游那张图的路径也不再被代码引用。

## 许可声明

**代码与美术素材**（本目录全部文件，含 `src/widget/whale-girl.png` 这张本项目自己生成的立绘）
以 MIT 发布（[`LICENSE`](LICENSE)），其中引用/对齐的上游契约信息以本文件记录的日期为准。
上游参考项目的 `assets/**` 不在本仓库里，也就不在本项目的任何授权范围内。
