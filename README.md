一款CF部署的导航页
---

## ✨ 核心特性

| 特性 | 说明 |
| :--- | :--- |
| 📱 **响应式设计** | 完美适配桌面、平板和手机等各种设备 |
| 🎨 **高度可定制** | 支持自定义主色调、字体、壁纸、毛玻璃、卡片样式、网格列数等 |
| 🔍 **快速搜索** | 内置站内模糊搜索，支持按名称/URL/描述/分类搜索；可选接入 Google/百度/Bing |
| 📂 **多级分类** | 支持父子分类层级，侧边栏/水平导航两种布局，分类可设为私密 |
| 🔒 **安全后台** | HttpOnly Session Cookie 鉴权，防暴力破解 IP 限流，防时序攻击 |
| 📝 **访客投稿** | 访客可提交书签，经管理员审核后才显示（可通过环境变量关闭） |
| ⚡ **极速加载** | SSR 渲染 + Cloudflare KV 全页 HTML 缓存，数据变更自动失效 |
| 📤 **导入导出** | 支持 JSON 格式及 **Chrome 书签 HTML 格式**一键导入 |
| 🤖 **AI 自动描述** | 支持 Workers AI / OpenAI / Google Gemini 自动批量生成书签描述 |
| 🖼️ **随机壁纸** | 支持 Bing 每日壁纸、Microsoft Spotlight、360 壁纸分类切换 |
| 🔐 **私密书签** | 书签/分类可设为私密，未登录用户不可见 |

---

## 🚀 快速部署

> **前置要求**：一个免费的 [Cloudflare](https://dash.cloudflare.com/) 账号即可，无需信用卡。

### 第一步：Fork 仓库

点击右上角 **Fork** 按钮，将本仓库 Fork 到你自己的 GitHub 账号，并顺手点个 ⭐ Star！

[![Fork on GitHub](https://img.shields.io/badge/Fork-GitHub-181717?style=for-the-badge&logo=github)](https://github.com/jy02739244/iori-nav/fork)

---

### 第二步：创建 D1 数据库

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
2. 左侧菜单进入 **存储和数据库** → **D1 SQL 数据库**
3. 点击 **创建数据库**，名称填写 `book`，点击创建

> ⚠️ 数据库名称必须为 `book`，否则后续绑定变量名需手动对应。

创建完成后，记录页面上显示的 **数据库 ID**（格式类似 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`），本地开发时会用到。

**初始化数据表**：进入数据库详情页 → 点击 **控制台** 标签页 → 将以下 SQL 粘贴并执行：

```sql
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  logo TEXT,
  desc TEXT,
  catelog_id INTEGER NOT NULL,
  catelog_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 9999,
  is_private INTEGER DEFAULT 0,
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  logo TEXT,
  desc TEXT,
  catelog_id INTEGER NOT NULL,
  catelog_name TEXT,
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catelog TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 9999,
  parent_id INTEGER DEFAULT 0,
  is_private INTEGER DEFAULT 0,
  create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_sites_catelog_id ON sites(catelog_id);
CREATE INDEX IF NOT EXISTS idx_sites_sort_order ON sites(sort_order);
```

> 💡 也可以直接执行项目根目录的 `schema.sql` 文件。

---

### 第三步：创建 KV 存储

KV 用于存储管理员会话、速率限制计数器、首页 HTML 缓存。

1. 左侧菜单进入 **存储和数据库** → **Worker KV**
2. 点击 **创建命名空间**，名称填写 `NAV_AUTH`，点击创建
3. 创建完成后，点击该命名空间 → **查看**，添加以下两个键值对：

| 键名 | 值 | 说明 |
| :--- | :--- | :--- |
| `admin_username` | 你的用户名（如 `admin`） | 后台登录用户名 |
| `admin_password` | 你的密码 | 后台登录密码，请设置强密码 |

> ⚠️ 这两个键必须存在，否则登录时会提示"系统配置错误"。

---

### 第四步：部署到 Cloudflare Pages

1. 进入 Cloudflare 控制台 → **Workers 和 Pages** → **Pages**
2. 点击 **创建** → **连接到 Git** → 选择 GitHub → 授权后选择你 Fork 的仓库
3. 配置构建设置：

| 配置项 | 值 |
| :--- | :--- |
| 项目名称 | 随意（如 `iori-nav`） |
| 构建命令 | **留空** |
| 构建输出目录 | `public` |

4. 点击 **保存并部署**，等待首次部署完成

---

### 第五步：绑定资源

部署完成后，进入 Pages 项目 → **设置** → **绑定**，添加以下绑定：

#### D1 数据库绑定

| 变量名称 | D1 数据库 |
| :--- | :--- |
| `NAV_DB` | 选择第二步创建的 `book` |

#### KV 命名空间绑定

| 变量名称 | KV 命名空间 |
| :--- | :--- |
| `NAV_AUTH` | 选择第三步创建的 `NAV_AUTH` |

保存绑定后，进入 **部署** 页面，找到最新部署记录，点击右侧 **...** → **重新部署**。

---

### 第六步：（可选）绑定自定义域名

1. 进入 Pages 项目 → **自定义域** → **设置自定义域**
2. 输入你的域名，按提示添加 DNS 记录

> 💡 如果域名托管在 Cloudflare，DNS 记录会自动添加。

---

### 完成！开始使用

- **首页**：`https://你的域名/`
- **后台管理**：`https://你的域名/admin`（使用第三步设置的用户名密码登录）

---

## 🔑 环境变量

在 Pages 项目 → **设置** → **变量和机密** 中配置。

### 必需绑定（Bindings）

| 变量名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `NAV_DB` | D1 数据库 | 主数据库（必需） |
| `NAV_AUTH` | KV 命名空间 | 会话 / 限流 / 缓存存储（必需） |

### 可选环境变量（Variables）

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `ENABLE_PUBLIC_SUBMISSION` | `false` | 是否允许访客提交书签（`true` / `false`） |
| `SITE_NAME` | `灰色轨迹` | 站点名称（数据库设置优先，此处为兜底） |
| `SITE_DESCRIPTION` | _(项目简介)_ | 站点副标题（数据库设置优先） |
| `FOOTER_TEXT` | `曾梦想仗剑走天涯` | 页脚文案 |
| `ICON_API` | `https://faviconsnap.com/api/favicon?url=` | 自动生成书签图标的接口前缀 |
| `AI_REQUEST_DELAY` | `1500` | AI 批量补全描述的请求间隔（毫秒） |

### AI 功能配置（在后台设置页填写）

AI 相关配置在**后台 → 设置 → AI 设置**中填写，无需设置环境变量：

| 配置项 | 说明 |
| :--- | :--- |
| 服务商 | `workers-ai`（需绑定 AI）/ `openai` / `gemini` |
| API Key | 对应服务商的 API Key |
| Base URL | OpenAI 兼容接口的地址（仅 OpenAI 模式需要） |
| 模型 | 模型名称（如 `gemini-2.5-flash-lite`） |

> 💡 使用免费 Gemini API（`gemini-2.5-flash-lite`）时，速率限制约 15 次/分钟，建议将 `AI_REQUEST_DELAY` 设为 `4000` 以上。

---

## ❓ 常见问题

### 登录相关

**问：访问 `/admin` 后一直跳转到登录页，无法登录**

确认以下几点：
1. `NAV_AUTH` KV 命名空间已正确绑定
2. KV 中已添加 `admin_username` 和 `admin_password` 两个键
3. 修改绑定后已**重新部署**项目

---

**问：登录后刷新页面又回到登录页**

检查你的域名是否有正确的 HTTPS，Session Cookie 要求 `Secure` 属性，HTTP 下不生效。  
如本地开发使用 `wrangler pages dev` 则无此问题。

---

### 数据相关

**问：首页 500 错误或显示"暂无书签"**

1. 确认 `NAV_DB` 已正确绑定到 `book` 数据库
2. 确认已在 D1 控制台执行过建表 SQL（或 `schema.sql`）
3. 查看 Pages 的 **实时日志** 获取具体错误信息

---

**问：后台修改数据后，首页内容没更新**

项目使用 KV 缓存首页 HTML。从本次版本起，所有写操作（新增/编辑/删除书签、新增/修改分类、保存设置、导入、审批投稿）均会**自动清除缓存**，正常情况下无需手动操作。  
如遇异常，可在后台 → **缓存管理** 中手动清除。

---

**问：如何导入 Chrome 书签？**

1. 在 Chrome 浏览器中：菜单 → 书签 → 书签管理器 → 右上角菜单 → **导出书签**，获得 `.html` 文件
2. 在 iori-nav 后台：**导入/导出** → 选择该 `.html` 文件 → 点击导入
3. 系统会自动将 Chrome 的书签文件夹转换为分类，书签转换为站点

---

**问：AI 自动补全描述功能如何使用？**

1. 后台 → **设置** → **AI 设置**，选择服务商并填写 API Key
2. 后台 → **书签管理** → 点击 **一键 AI 补全描述** 按钮
3. 系统会自动为所有未填描述的书签逐个请求 AI 生成描述

如使用 Google Gemini 免费版，请在环境变量中适当增大 `AI_REQUEST_DELAY`（建议 `4000` 及以上）避免触发速率限制。

---

**问：如何配置随机壁纸？**

后台 → **设置** → **壁纸设置**，可选择：
- **Bing 每日壁纸**：按国家/地区获取
- **Microsoft Spotlight**：Win11 锁屏同款壁纸
- **360 壁纸**：可选多个壁纸分类

也可以手动填入任意图片 URL 作为固定壁纸，并开启模糊效果。

---

**问：前台看不到"添加书签"按钮**

需要开启访客投稿功能：在 Pages → **变量和机密** 中添加变量 `ENABLE_PUBLIC_SUBMISSION = true`，重新部署后生效。

---

### 样式相关

**问：修改了 `public/css/tailwind.css` 但样式没有变化**

需要先执行构建命令将源文件编译为最终的 `tailwind.min.css`：

```bash
npm run build:css
```

然后将 `public/css/tailwind.min.css` 提交并推送到 GitHub，触发重新部署。

---

## 🔧 技术栈

| 类别 | 技术 |
| :--- | :--- |
| **运行时** | [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)（Edge Workers） |
| **数据库** | [Cloudflare D1](https://developers.cloudflare.com/d1/)（SQLite） |
| **KV 存储** | [Cloudflare KV](https://developers.cloudflare.com/workers/runtime-apis/kv/)（会话 / 缓存） |
| **前端样式** | [TailwindCSS v3](https://tailwindcss.com/) + 原生 CSS |
| **AI 接口** | Workers AI / OpenAI API / Google Gemini API |

---

## 📋 更新日志

