# ADHD Flow Planner / 轻推任务系统

一个适合 ADHD / 启动困难 / 任务过载用户的本地网页工具 MVP。它支持任务倒出、规则模拟 AI 自动分流、P0 / P1 / P2 优先级、流程图推进、完成留痕、停车场和生活适配改造记录。

## 运行方法

```bash
npm install
npm run dev
```

构建生产版本：

```bash
npm run build
npm run preview
```

## 目录结构

```text
adhd-flow-planner/
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
└─ src/
   ├─ App.tsx        # 页面、交互和状态管理
   ├─ main.tsx       # React 入口
   ├─ rules.ts       # 本地规则分流和流程阶段
   ├─ storage.ts     # localStorage 读取与保存
   ├─ types.ts       # TypeScript 数据类型
   └─ styles.css     # 低刺激界面样式
```

## MVP 功能

- Todo 输入页：一行一个任务，快速倒出脑内任务。
- AI 自动整理：第一版使用本地关键词规则模拟，不调用真实 AI API。
- 优先级分流：自动归入 P0 / P1 / P2，并允许手动调整。
- 流程图推进：点击“推进一步”，任务依次进入收进来、下一步、推进中、收尾、完成。
- Done List：任务完成后自动进入完成记录。
- 停车场：随手停放打断当前执行的新想法。
- 生活适配改造：记录环境、习惯、生活安排中需要调整的部分。
- 本地持久化：所有数据自动保存在 localStorage，刷新页面不会丢失。

## 当前不包含

- 登录、云同步、数据库
- 真实 AI API
- API key 或任何外部密钥
- 复杂权限系统
