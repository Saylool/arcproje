import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /*
     * Depoya girmeyen yerel dizinler.
     *
     * `lint` betiği `eslint`i yol argümanı olmadan çağırdığı için tarama
     * proje kökünden başlar ve buralara da iner. `.claude/worktrees`
     * altındaki git-worktree kopyaları kendi kaynaklarını ve `.next`
     * çıktılarını taşır; yukarıdaki `.next/**` yalnızca kökteki dizine
     * uyduğundan bu kopyalar binlerce sahte bulgu üretir.
     */
    ".claude/**",
    "output/**",
  ]),
]);

export default eslintConfig;
