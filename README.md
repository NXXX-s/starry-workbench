# 星穹机甲 · 创作者工作台 ⚡

一个二次元风格的个人工作台 PWA：**手机 + 电脑浏览器打开同一个网址，数据云端同步**。

模块：🎬 剪辑工作台（素材库/分镜） · 🎨 设计工作台（灵感/配色/组件/需求） · 📡 新闻情报（三角洲行动 + AI，每日 08:00 自动更新） · 📚 书单阅读（企业家书单 + 每日箴言 + 内置阅读器） · ☑ 待办清单 · 😺 可互动 Q 版卡芙卡助手

---

## 技术栈
- 前端：原生 HTML/CSS/JS（无构建步骤，部署即静态站点）+ Supabase JS SDK
- 后端：Supabase（Postgres 数据库 + Auth 邮箱登录 + Storage 素材存储 + RLS 行级安全）
- 新闻定时任务：Vercel Cron（每日 00:00 UTC = 08:00 北京时间）→ Serverless Function 抓取 RSS/Reddit → 写入数据库

## 一、Supabase 配置（约 5 分钟）
1. 打开 [supabase.com](https://supabase.com) → New Project（免费档即可）
2. 左侧 **SQL Editor** → 依次运行：
   - `supabase/schema.sql`（建表 + 行级安全）
   - `supabase/seed.sql`（企业家书单 + 每日箴言种子数据）
3. **Storage** → New bucket → 名称 `assets` → 勾选 **Public**
4. **Authentication → Providers**：确保 Email 开启；如需开放注册保持默认
5. **Project Settings → API**：记下 `Project URL` 和 `anon public key`

## 二、前端配置
```bash
cp js/config.example.js js/config.js
# 编辑 js/config.js，填入上面的 URL 和 anon key
```

## 三、部署到 Vercel（免费）
1. 把 `app/` 目录推到你的 GitHub 仓库
2. [vercel.com](https://vercel.com) → Import 该仓库（框架选 Other，构建命令留空）
3. **Project Settings → Environment Variables** 添加：
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = Project Settings → API → `service_role` key（仅服务端用）
4. Deploy 完成后访问 `https://你的项目.vercel.app` —— 手机电脑都能打开
5. Cron 已由 `vercel.json` 自动注册（每日 08:00 北京时间抓新闻）；可在 Vercel → Cron 页面确认

## 四、手机安装（PWA）
- iPhone Safari：分享 → 添加到主屏幕
- Android Chrome：菜单 → 安装应用
- 之后像原生 App 一样使用，离线也能打开界面

## 五、手机推送（微信 / 飞书，可选但推荐）
登录工作台后点左下角 **⚙ 设置**：
- **微信**：打开 [sct.ftqq.com](https://sct.ftqq.com) 用微信扫码登录 → 复制 SendKey → 粘贴到设置页「微信 SendKey」→ 保存 → 点「测试推送」，微信「方糖」公众号会收到消息
- **飞书**：飞书群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人 → 复制 Webhook → 粘贴到设置页 → 保存 → 测试
- 之后**每天 08:00** 你会自动收到：未完成待办清单 + 今日箴言 + 三角洲/AI 新闻头条（与新闻抓取同一 cron 任务）
- 提醒：`user_settings` 表在 `schema.sql` 第 13 节；若你之前已运行过旧版 schema，只需再运行第 13 节那一段即可

## 六、本地开发
```bash
npm install          # 安装 cron 函数依赖
vercel dev           # 本地启动（需 Vercel CLI）
```

## 常见问题
- **新闻不更新**：检查 Vercel 环境变量 `SUPABASE_SERVICE_ROLE_KEY` 是否正确、Cron 是否注册成功；可手动访问 `/api/news-cron` 触发一次
- **注册收不到确认邮件**：Supabase Auth 默认开启邮件确认；免费档邮件可能进垃圾箱，或到 Authentication → Settings 关闭确认（自用建议开启）
- **素材上传失败**：确认 Storage bucket 名为 `assets` 且为 Public
