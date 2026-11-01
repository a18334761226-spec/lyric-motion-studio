/**
 * 解析钩子：允许 ESM 省略 .ts / .tsx 扩展名（与 bundler 行为一致）。
 */
const EXTS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];
const INDEXES = ['/index.ts', '/index.tsx', '/index.js', '/index.mjs'];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      // 也尝试给包内相对路径补扩展，但不处理裸包
      throw err;
    }
    const candidates = [];
    for (const ext of EXTS) candidates.push(`${specifier}${ext}`);
    for (const idx of INDEXES) candidates.push(`${specifier}${idx}`);
    for (const candidate of candidates) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        /* try next */
      }
    }
    throw err;
  }
}
