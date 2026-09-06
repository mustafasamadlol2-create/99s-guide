import js from "@eslint/js";
import ts from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default ts.config(
  {
    ignores: ["dist", "dist/**", "ios/App/App/public", "ios/App/App/public/**", "node_modules", "node_modules/**", "fix.cjs", "test-db.js"]
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: true,
        process: true,
        require: true,
        module: true,
        __dirname: true,
        window: true,
        document: true,
        localStorage: true,
        setTimeout: true,
        clearTimeout: true,
        setInterval: true,
        clearInterval: true,
        self: true,
        caches: true,
        Response: true,
        fetch: true,
        URLSearchParams: true,
        Buffer: true,
        URL: true,
        navigator: true
      }
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-empty": "off",
      "no-useless-assignment": "off",
      "no-case-declarations": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "prefer-const": "warn",
      "@typescript-eslint/no-require-imports": "off"
    },
  }
);
