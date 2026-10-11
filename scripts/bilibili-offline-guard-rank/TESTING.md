# 调试与回归验证手册

脚本对 B站前端结构有几个核心依赖，B站改版是最主要的失效风险。本手册记录 2026-10 调查得出的结构事实、失效时的定位步骤和回归清单。

## 背景速查（2026-10 实测结论）

- 直播状态 `live_status`（`0` 未开播 / `1` 直播中 / `2` 轮播中）到达页面有三条通道：
  1. **SSR 数据** `window.__NEPTUNE_IS_MY_WAIFU__`（普通直播间内联在 HTML 里）
  2. **`xlive/web-room/v2/index/getRoomPlayInfo`**（播放器初始化接口，响应含 `live_status`）
  3. **弹幕 WebSocket**（推送 LIVE/PREPARING/ROUND 状态变更事件）
- 排行榜组件的形态选择（收起态=只有"房间观众" / 完整态=含"大航海"页签，`rank-list-section` 带 `new` 类）只消费两条输入：普通间读 SSR，活动页读 `getInfoByRoom`。
- 普通直播间**不调用** `getInfoByRoom`（实测 0 次）；活动页/赛事页是"外壳 + `blanc` 轻量 iframe"结构，无 SSR 数据。
- 脚本刻意**不触碰** `getRoomPlayInfo` 与 WebSocket：前者保护轮播播放不被破坏，后者保留主播真实开播时页面自动恢复的能力。
- `window.fetch` 在页面加载完成后可能被定义为访问器属性（直接赋值会被 setter 静默吞掉），钩子必须在 document-start 用 `Object.defineProperty` 安装。
- 活动页的 blanc iframe 经"about:blank → 导航"两段式创建，且 **window 对象跨文档复用**（document-start 装在原型上的钩子会存活到真实文档）。
- 活动页外壳（主 frame）永远等不到 SSR；iframe 钩子命中时会上报 `top.__offlineGuardRankApplied`，外壳的 SSR 轮询超时告警据此抑制——普通间真失效时告警仍会响。
- `POLL_MS=1` 的真实语义：浏览器会把定时器节流到约 4ms，`MAX_POLLS=20000` 实际约 20-80 秒（后台标签页更久），排查超时时刻时按此估算。
- B站房间间导航是整页加载（非 SPA 路由），脚本按"每个文档装一次"设计；若未来改成 SPA 式路由，复用的 window + 已置位的守卫会导致补丁不重装，属已知边界。
- 若 B站未来把 `getInfoByRoom` 挪到加载晚段调用，页面加载后替换 `window.fetch`/XHR 包装的行为可能覆盖我们的钩子——那是第一个要复查的点。
- 完整态组件的页签选择器是 `.tab-item`；收起态是 `.tab`。写探测脚本时两个都要查。

## 症状定位三步法

### 第一步：看页面状态（10 秒，控制台执行）

```js
(() => {
  const n = window.__NEPTUNE_IS_MY_WAIFU__;
  return {
    有SSR: !!n,
    live_status: n?.roomInfoRes?.data?.room_info?.live_status,
    补丁已生效标志: !!window.__offlineGuardRankApplied,
    榜单tab: [...document.querySelectorAll('#rank-list-ctnr-box .tab, #rank-list-ctnr-box .tab-item')].map(t => t.textContent.trim()),
  };
})()
```

| 观察结果 | 含义 |
|---|---|
| `有SSR: true` 且 `live_status: 1`，tab 含"大航海" | 脚本工作正常，问题在别处 |
| `有SSR: true` 但 `live_status: 0/2` | 脚本没运行（未启用/未匹配），查脚本管理器 |
| `有SSR: false` | 活动页/lite 模板，走接口钩子路径，看 iframe |
| 控制台无 `[大航海榜]` 成功日志、有 warn | 看警告内容：未等到 SSR / 钩子安装失败 / 执行异常 |

注意在**正确的 frame** 里执行：活动页的榜单在 `blanc` iframe 里，不是主 frame。

### 第二步：route 层改写实验（验证"数据是不是唯一断链点"）

用 Playwright 的 `page.route` 在**网络层**把目标接口响应里的 `live_status` 改成 1，刷新页面：

```js
await page.route(/getInfoByRoom/, async (route) => {
  const resp = await route.fetch();
  const j = await resp.json();
  const d = j?.data;
  if (d) {
    if ('live_status' in d) d.live_status = 1;
    if (d.room_info && 'live_status' in d.room_info) d.room_info.live_status = 1;
  }
  await route.fulfill({ response: resp, body: JSON.stringify(j), contentType: 'application/json; charset=utf-8' });
});
```

- UI 翻转出"大航海"页签 → 数据链路问题，回第一步查脚本哪一环没改到。
- UI 不翻转 → B站改了组件选择逻辑（不再只看 live_status），需要适配新结构。

### 第三步：document-start 时序实验（验证钩子机制）

用 `page.addInitScript` 注入**完整的 `guardPatch` 函数源码并立即执行**（`(${guardPatch.toString()})()`），刷新页面。

两个坑：

1. **不要加 `/blanc/` 路径守卫**——init 脚本在 about:blank 阶段运行时 `location.pathname` 是 `blank`，加了守卫就永远装不上。
2. fetch 钩子必须用 `defineProperty`（原因见背景速查）。

tab 出现 = 机制没坏，是注入时机/环境问题；不出现 = 钩子代码或接口形状变了，先手动 `fetch` 一次目标接口看响应结构。

## 回归清单（B站改版后过一遍）

- [ ] 普通未开播间：出现"大航海(N)"页签，点击能出榜
- [ ] 普通轮播间（live_status=2）：同上，且轮播视频继续播放
- [ ] 活动页（样本：`live.bilibili.com/27627985`）：榜单在 blanc iframe 内出现并可用
- [ ] 活动页且轮播中的组合场景：榜单出现 + 轮播正常
- [ ] 真实开播间：无副作用，页签是原生实时数据
- [ ] 主播从未开播转开播：页面自动恢复正常直播画面
- [ ] 非房间页（live.bilibili.com 首页/榜单页）：控制台无本脚本的误报告警
- [ ] 控制台无脚本报错/意外 warn

fetch 通道单独验证：临时在 `installXhrHook` 的 `safely(...)` 调用处传入空函数使其不安装，仅留 fetch 钩子后按上述清单过一遍（用于确认两条活动页子通道都能独立工作）。
