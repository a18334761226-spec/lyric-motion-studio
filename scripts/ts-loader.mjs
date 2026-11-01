/**
 * Windows 沙箱/受限环境下 tsx 不可用（esbuild 子进程管道被禁）时的替代运行时：
 * 使用 Node 内置类型擦除 + 自定义解析钩子，让 `node --import ./scripts/ts-loader.mjs src/server/index.ts` 可运行。
 */
import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);
