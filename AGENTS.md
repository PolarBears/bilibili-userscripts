# AGENTS.md

## 项目概况

- B站(Bilibili) 用户脚本集合：纯 JavaScript，无构建、无打包、无依赖，`.user.js` 文件即发布原件
- Greasy Fork 从各脚本的 raw 链接自动同步发布，因此**文件路径、文件名、`@version` 都具有发布语义**
- 目录：`scripts/<slug>/` 一脚本一文件夹，slug 同时是文件夹名和 `.user.js` 文件名

## 硬性约束（违反会造成发布事故或平台违规）

- 禁止压缩、混淆、打包输出——Greasy Fork 明文规则，代码保持可读原文
- 改了任何代码必须同步 bump 该脚本的 `@version`，否则 GF 不会发布新版、用户收不到更新
- 不要改 `@namespace`——它是脚本在用户脚本管理器中的唯一身份
- GF 发布后不要重命名脚本文件夹或 `.user.js` 文件——会弄断 GF 的同步链接
- 不自绘 UI：脚本的能力来自改写页面数据、让B站官方前端自行渲染，新功能优先沿用此模式
- 用户可见的 console 日志沿用各脚本既有前缀（如 `[大航海榜]`）
- 界面文案与文档用中文；提交信息用英文（feat:/fix:/docs: 前缀）

## 元数据规范（每个脚本的 `.user.js`）

- `@name` / `@name:zh-CN` / `@name:en` 三件套必须齐全，`@name:zh-CN` 与 `@name` 同文本：脚本管理器按 locale 取显示名，缺 zh-CN 时中文环境可能回落显示英文名；Greasy Fork 同步 zh-CN 描述页也强制要求该标签存在
- `@description` / `@description:zh-CN` / `@description:en` 同理三件套
- `@icon` 用目标站 favicon（B站脚本：`https://www.bilibili.com/favicon.ico`）
- `@namespace` 固定为 `https://github.com/PolarBears/bilibili-userscripts`；`@license MIT`；`@supportURL` 指仓库 Issues；`@homepageURL` 指脚本目录
- `@description` 的中文措辞就是 Greasy Fork 的检索词（没开播/轮播/活动页/舰长榜等同义词要写全）

## 改动前的必读材料

| 要改什么 | 先读什么 |
|---|---|
| 任何脚本 | 该脚本目录下的 `README.md`（功能定位与承诺给用户的行为边界） |
| 脚本运行逻辑 | 该脚本目录下的 `TESTING.md`（如有）：实测结构事实、排查方法、回归清单等脚本特有知识 |

## 验证要求

- 提交前 `node --check scripts/<slug>/<slug>.user.js` 必须通过
- 运行逻辑的改动必须写明验证方式与结果；无法脱离浏览器人工验证的行为（如"主播开播后自动恢复"）明确标注"待人工验证"，不得宣称已完成
- 页面行为类故障先定位根因（优先查该脚本 `TESTING.md` 中的已知事实与排查方法），禁止凭猜测直接改代码

## 工作流

验收与发布决策由人工负责；代理负责代码与文档改动。

### 新增脚本

1. 新建 `scripts/<slug>/`，放入 `<slug>.user.js`（元数据按「元数据规范」）和 `README.md`（GF 描述页内容）
2. 在根 README 的脚本列表表格中登记

### Greasy Fork 首发（每个脚本一次，需人工在 GF 网页操作）

1. GF"发布你自己的脚本" → 粘贴 `https://raw.githubusercontent.com/PolarBears/bilibili-userscripts/main/scripts/<slug>/<slug>.user.js`，同步方式选"自动"
2. GF 脚本"管理"页：把描述的同步源设为同目录 `README.md` 的 raw 链接（Markdown 格式）
3. 把 GF 脚本页链接补进根 README 表格

### 日常更新

改代码 → bump `@version` → commit → push。GF"自动"同步约每小时检查一次，`@version` 变高才会发布新版；急发布到 GF"管理"页手动点同步。

## 相关文档

- 根 `README.md`：面向使用者的总目录（保持简洁，操作细节不要搬进去）
- 各脚本 `README.md`：同时是 GF 描述页内容
- 各脚本 `TESTING.md`：领域知识与调试手册（按需存在）
