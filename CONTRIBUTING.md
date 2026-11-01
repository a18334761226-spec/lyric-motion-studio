# 贡献指南

感谢你对 Lyric Motion Studio 的兴趣！欢迎提 Issue、PR、示例与文档改进。

## 开发环境

- Node.js ≥ 24
- ffmpeg（PATH 中可用，或设置 `FFMPEG_PATH` / `FFPROBE_PATH`）
- Chrome / Edge（用于把 LLM 生成的 SVG 截图成 PNG）
- 可选：DeepSeek API Key（`DEEPSEEK_API_KEY`），不填也能跑本地降级流程

```bash
npm install
cp .env.example .env
npm run typecheck
npm run build
npm start        # http://127.0.0.1:5099
```

开发时 `npm run dev` 会同时启动 API 与前端 watch。

## 提交前自检

```bash
npm run typecheck
npm run build
```

请确保：

- 不提交任何 API Key、`.env`、`data/`、`screenshots/`、构建产物
- 新增依赖前先讨论，保持依赖精简
- 涉及画面 / 字幕 / 时长的改动，请在 Issue 或 PR 里附一帧截图或成片片段说明效果

## 代码风格

- TypeScript 严格模式；服务端与前端都在 `src/` 下
- 中文文案统一使用中文标点；代码注释用中文或英文均可
- 服务端与前端共享类型放在 `src/shared/types.ts`，预设放 `src/shared/presets.ts`

## 提 PR

1. Fork 并新建分支：`feat/your-feature` 或 `fix/your-fix`
2. 描述「改了什么、为什么、怎么验证」
3. 关联相关 Issue
4. 保持单个 PR 聚焦，便于 review

## 报告问题

请附：操作系统、Node 版本、`npm run typecheck` 输出、复现步骤、相关日志（`server.log` 或页面「动态」）。
涉及成片问题时附一帧截图或片段链接。
