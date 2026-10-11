// ==UserScript==
// @name         B站未开播直播间显示大航海榜
// @name:zh-CN   B站未开播直播间显示大航海榜
// @name:en      Bilibili Live Guard Rank for Offline Rooms
// @namespace    https://github.com/PolarBears/bilibili-userscripts
// @version      1.0.10
// @description  没开播、下播、停播或轮播中的B站直播间（含活动页）也能查看官方大航海榜（即舰长榜，含周榜/月榜/陪伴榜），界面为B站官方原生组件。
// @description:zh-CN  没开播、下播、停播或轮播中的B站直播间（含活动页）也能查看官方大航海榜（即舰长榜，含周榜/月榜/陪伴榜），界面为B站官方原生组件。
// @description:en  View the official Guard (captain) rank list on offline Bilibili live rooms (activity pages included), rendered by Bilibili's own UI
// @author       PolarBears
// @license      MIT
// @icon         https://www.bilibili.com/favicon.ico
// @match        https://live.bilibili.com/*
// @grant        none
// @run-at       document-start
// @supportURL   https://github.com/PolarBears/bilibili-userscripts/issues
// @homepageURL  https://github.com/PolarBears/bilibili-userscripts/tree/main/scripts/bilibili-offline-guard-rank
// ==/UserScript==

// 原理: 把房间数据的 live_status 改写为直播中, 让B站前端自行渲染开播版排行榜。
// 普通直播间改写页面 SSR 数据; 活动页(lite 模板, 无 SSR)改为改写房间信息接口的响应。
// 注意: 页面会整体呈现开播状态界面; 未开播房间的播放器为官方占位页, 主播开播后自动恢复。
(function () {
    'use strict';

    injectGuardPatch();

    function injectGuardPatch() {
        const script = document.createElement('script');
        script.textContent = `(${guardPatch.toString()})()`;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        // script 注入失败时无任何报错, 这里补一条可见告警
        if (!window.__offlineGuardRankPatched) {
            console.warn('[大航海榜] 脚本注入未生效(可能被 CSP 拦截)');
        }
    }

    // 补丁在页面主世界执行: 必须自包含, 不能引用本文件中的其它变量。
    function guardPatch() {
        // 同一 window 只装一次: 跨文档复用的 window 上钩子仍存活, 重复注入只需跳过
        if (window.__offlineGuardRankPatched) return;
        window.__offlineGuardRankPatched = true;

        const NEPTUNE_KEY    = '__NEPTUNE_IS_MY_WAIFU__';   // B站页面 SSR 数据的全局挂载点
        const ROOM_API_RE    = /getInfoByRoom/;             // 房间信息接口: 活动页 lite 模板经此取数
        const LIVE_STATUS_ON = 1;                             // live_status: 0 未开播 / 1 直播中 / 2 轮播中
        const POLL_MS        = 1;
        const MAX_POLLS      = 20000;                         // ≈20s 超时上限

        let patchApplied = false;
        let polls = 0;

        const markPatched = () => {
            if (!patchApplied) {
                patchApplied = true;
                // 广播给上层 frame: 等不到 SSR 的活动页外壳据此抑制超时告警
                try {
                    if (window.top !== window) window.top.__offlineGuardRankApplied = true;
                } catch (e) { /* 跨域 top 不可访问时忽略 */ }
                console.info('[大航海榜] 已启用开播版排行榜');
            }
        };

        // 单路钩子安装失败只放弃该通道, 不拖垮其它通道
        const safely = (label, install) => {
            try {
                install();
            } catch (e) {
                console.warn(`[大航海榜] ${label}安装失败, 保持原样`, e);
            }
        };

        // 仅在实际写入时返回 true, 调用方据此判断补丁是否生效
        const setLive = (obj) => {
            if (obj && 'live_status' in obj && obj.live_status !== LIVE_STATUS_ON) {
                obj.live_status = LIVE_STATUS_ON;
                markPatched();
                return true;
            }
            return false;
        };

        // 只处理带 room_info 的房间信息响应, 避免误改其它接口数据
        const applyLiveStatus = (data) => {
            if (!data?.room_info) return;
            setLive(data);
            setLive(data.room_info);
        };

        const rewriteBody = (text) => {
            try {
                const json = JSON.parse(text);
                applyLiveStatus(json && json.data);
                return JSON.stringify(json);
            } catch (e) {
                return text;
            }
        };

        // 仅对命中目标接口的请求逐实例改写响应 getter, 原型上的其它请求不受影响。
        // 每次读取都会重写一遍; 该接口每页仅调用一两次, 不做缓存。
        function hookXhrResponse(xhr) {
            const responseDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
            const responseTextDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
            if (!responseDesc || !responseTextDesc) return;   // 原型上的属性描述符被改写/移除时放弃, 避免页面读响应时抛错
            Object.defineProperty(xhr, 'response', {
                configurable: true,
                get() {
                    const v = responseDesc.get.call(xhr);
                    if (typeof v === 'string') return rewriteBody(v);
                    if (v && typeof v === 'object') { applyLiveStatus(v.data); return v; }
                    return v;
                },
            });
            Object.defineProperty(xhr, 'responseText', {
                configurable: true,
                get() { return rewriteBody(responseTextDesc.get.call(xhr)); },
            });
        }

        // 活动页通道 1/2: 拦截 XHR
        function installXhrHook() {
            const proto = XMLHttpRequest.prototype;
            const open = proto.open;
            const send = proto.send;
            proto.open = function (method, url) {
                this.__offlineGuardRankUrl = url;
                return open.apply(this, arguments);
            };
            proto.send = function () {
                if (typeof this.__offlineGuardRankUrl === 'string' && ROOM_API_RE.test(this.__offlineGuardRankUrl)) {
                    hookXhrResponse(this);
                }
                return send.apply(this, arguments);
            };
        }

        // 活动页通道 2/2: 拦截 fetch
        function installFetchHook() {
            if (!window.fetch) return;
            const origFetch = window.fetch;
            // fetch 可能已被定义为访问器属性, 直接赋值会被 setter 静默吞掉
            Object.defineProperty(window, 'fetch', {
                configurable: true,
                writable: true,
                value: async function (input) {
                    const url = typeof input === 'string' ? input : (input && input.url) || '';
                    const p = origFetch.apply(this, arguments);
                    if (!ROOM_API_RE.test(url)) return p;
                    try {
                        const res = await p;
                        const text = await res.clone().text();
                        const headers = new Headers(res.headers);
                        // 响应体已被重写为明文, 旧的编码/长度头已不正确
                        headers.delete('content-encoding');
                        headers.delete('content-length');
                        // new Response 会丢失 res.url/redirected, 该接口无代码读取它们
                        return new Response(rewriteBody(text), {
                            status: res.status, statusText: res.statusText, headers,
                        });
                    } catch (e) {
                        return p;
                    }
                },
            });
        }

        // 普通直播间通道: 短轮询等待 SSR 数据就绪后改写
        function installSsrPoll() {
            const timer = setInterval(() => {
                const data = window[NEPTUNE_KEY];
                const roomInfo = data?.roomInfoRes?.data?.room_info;
                const roomInit = data?.roomInitRes?.data;
                if (!roomInfo && !roomInit) {
                    // 未就绪: 继续轮询, 直到超时放弃
                    if (++polls > MAX_POLLS) {
                        // 仅在直播间路径下告警: 首页/榜单页本就没有房间 SSR; 告警与否不影响补丁本身
                        if (/^\/(blanc\/)?\d+/.test(location.pathname) && !patchApplied && !window.__offlineGuardRankApplied) {
                            console.warn('[大航海榜] 未等到 SSR 数据, 补丁未生效');
                        }
                        clearInterval(timer);
                    }
                    return;
                }
                // roomInfoRes 驱动排行榜组件选择; roomInitRes 驱动头部/播放器状态
                const wrote = setLive(roomInfo);
                const wroteInit = setLive(roomInit);
                if (wrote || wroteInit) markPatched();
                clearInterval(timer);
            }, POLL_MS);
        }

        // 接口响应与 SSR 两条数据源通道同时安装, 各自在数据出现时自然生效。
        // 不按 URL 区分页面类型: 活动页外壳与普通直播间在 document-start 无法区分
        // (区别只是外壳等不到 SSR), 且 URL 规则会随B站的路由改名而失效。
        safely('XHR钩子', installXhrHook);
        safely('fetch钩子', installFetchHook);
        installSsrPoll();
    }
})();
