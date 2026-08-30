// jest.integration.config.mjs — `npm run test:integration` (sección 7/12.6).
//
// Contraparte de `jest.config.mjs` (test:unit): ahí el `testMatch` EXCLUYE a
// propósito todo lo que esté bajo `infrastructure/` (sección 7 — "Jest sin
// mocks de AWS"); acá es exactamente al revés, el `testMatch` apunta SOLO a
// `infrastructure/**/*.integration.test.ts` — los adaptadores reales
// (Postgres vía RDS Data API) probados contra un recurso real, sin mocks de
// AWS de ningún tipo. No hay overlap de archivos entre los dos configs.
//
// No se corre nunca con `npx jest` a secas: los tests de este config leen
// `AURORA_RESOURCE_ARN`/`AURORA_SECRET_ARN`/`AURORA_DATABASE`/`AWS_REGION`
// de `process.env` (ver `test/integration/aurora-fixture-helpers.ts`), que
// `scripts/test-integration.mjs` resuelve por CloudFormation (mismo
// mecanismo que `db-migrate.mjs`, ver esa nota de cabecera) ANTES de lanzar
// este runner como proceso hijo — es ese script, no este archivo, el punto
// de entrada real (`npm run test:integration -- --grupo <g> --env <e>`).
//
// `maxWorkers: 1` a propósito: estos tests escriben filas reales (sintéticas,
// marcadas y limpiadas en cada archivo — ver aurora-fixture-helpers.ts) contra
// la MISMA base de `dev`/`prod` que otros archivos de este mismo run también
// tocan. Corrida en serie, no en paralelo, para no depender de que cada
// archivo sea perfectamente independiente del estado que dejan los demás.
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: 1,
  testMatch: ['<rootDir>/services/*/src/infrastructure/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@fuelhub/shared-kernel$': '<rootDir>/packages/shared-kernel/src/index.ts',
    '^@fuelhub/test-integration-support$': '<rootDir>/test/integration/aurora-fixture-helpers.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
};
