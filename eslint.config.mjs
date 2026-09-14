import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * ESLint flat config
 *
 * 卡口口径（团队 TS 规范）：
 * - 禁 enum（const 对象 + as const 替代）
 * - 类型导入必须 `import type`（verbatimModuleSyntax 对齐）
 * - 导出声明必须带 JSDoc（@param / @returns 齐全）
 * - 禁未使用变量 / 禁显式 any（宽松：参数隐式 any 允许，交给 vue-tsc）
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '*.vue'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,ts,vue}'],
    plugins: { jsdoc },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // —— TS 规范硬性卡口 ——
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: '禁用 enum，请使用 const 对象 + as const + satisfies 替代',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      // 全角空格仅用于 tooltip 文案排版间隔，字符串/模板内放行
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],

      // —— JSDoc：导出声明必须带文档 ——
      'jsdoc/require-jsdoc': [
        'warn',
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, MethodDefinition: true, ClassDeclaration: false },
          contexts: [
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
            'ExportDefaultDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
          ],
        },
      ],
      'jsdoc/require-param': 'warn',
      'jsdoc/require-returns': 'warn',
      'jsdoc/check-param-names': 'error',

      // —— Vue ——
      'vue/multi-word-component-names': 'off',
      /*
       * 未注册组件卡口：模板里用了但没 import（或没全局注册）的组件，
       * vue-tsc / vite build / 其余 lint 规则**全都查不出来**——运行时只打一条
       * `Failed to resolve component` 的 Vue warn，UI 表现为「点了没反应」。
       * 全局注册的 vue-router 组件用 ignorePattern 放行。
       */
      'vue/no-undef-components': ['error', { ignorePatterns: ['^Router(View|Link)$'] }],
      // v-html 仅用于 MenuIcon 的本地静态 SVG path 白名单，无用户输入
      'vue/no-v-html': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': ['error', 2],
      'vue/attributes-order': 'off',

      // —— 通用 ——
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, sourceType: 'module' },
    },
  },
);
