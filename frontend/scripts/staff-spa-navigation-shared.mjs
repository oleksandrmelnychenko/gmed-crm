/**
 * Strip `//` line comments and `/* *\/` blocks (best-effort).
 * Shared by the CLI guard and the Vitest unit test.
 */
export function stripTsCommentsForScan(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/^\s*\/\/.*$/gm, "");
  return out;
}
