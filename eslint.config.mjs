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
    // Vendored third-party solver (MIT, see public/solver/LICENSE). It is
    // CoffeeScript output served as-is, so linting it only produces noise we
    // must not "fix" — local edits would be lost on the next upstream sync.
    "public/solver/**",
  ]),
]);

export default eslintConfig;
