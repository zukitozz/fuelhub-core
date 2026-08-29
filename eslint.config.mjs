// eslint.config.mjs
//
// Config plana de ESLint (sección 12.6, v1.50) — cubre exactamente el mismo
// alcance que `tsconfig.json` (packages/, services/, infra/lib, infra/bin),
// más `scripts/` (los wrappers operativos nuevos de esta versión, p. ej.
// `db-migrate.mjs`). Deliberadamente SIN reglas de estilo (comillas,
// indentación, etc.) — eso es trabajo de un formateador, no de este script;
// acá solo se atrapan errores reales (variables sin usar, `any` implícito,
// promesas sin `await`/`catch`), mismo criterio "sin magia" de la sección
// 6.2: reglas que sirven, no una plantilla genérica copiada de otro lado.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/cdk.out/**', '**/dist/**', 'infra/cdk.out/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'packages/**/*.ts',
      'services/**/*.ts',
      'infra/lib/**/*.ts',
      'infra/bin/**/*.ts',
      'scripts/**/*.mjs',
    ],
    rules: {
      // Un catch que solo re-lanza o un parámetro de evento sin usar son
      // legítimos en varios handlers de este repo — se permite prefijar
      // con `_` en vez de prohibir el patrón entero.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Los scripts .mjs de infraestructura (scripts/) no pasan por `tsc`,
      // así que las reglas que necesitan info de tipos no aplican ahí.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // scripts/ corre directo con `node`, nunca en un handler de Lambda
      // (que no tiene `console`/`process` como globals implícitos de la
      // misma forma) — separado a propósito del resto del glob, que no
      // necesita `globals.node` (los handlers ya tipan sus propios eventos).
      globals: globals.node,
    },
  }
);
