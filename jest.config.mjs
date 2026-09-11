// jest.config.mjs — `npm run test:unit` (sección 7/12.6, v1.50).
//
// Alcance a propósito acotado a `domain/`+`application/` de cada
// microservicio y a `packages/shared-kernel` — exactamente lo que la
// sección 7 promete ("Jest sin mocks de AWS, gracias a la separación
// hexagonal"). Los adaptadores (`infrastructure/`, todo lo que importa
// `@aws-sdk/*`) quedan afuera del glob a propósito: esos se testean con
// integración contra recursos reales/localstack (`test:integration`, un
// script propio y distinto — ver 12.6), no acá. Si algún día un archivo de
// `domain`/`application` empieza a importar `@aws-sdk/*`, es señal de que
// se rompió el límite hexagonal, no que este config esté mal.
//
// v1.72: se agrega una entrada puntual para
// `services/auth-pre-token-generation/src/*.test.ts` -- ese servicio NO
// tiene capas domain/application (es un trigger plano de Cognito, ver su
// propio handler.ts) y no importa nada de `@aws-sdk/*`, así que testearlo
// con Jest sin mocks encaja con el mismo criterio de arriba. A propósito
// puntual a ESE servicio (no `services/*/src/*.test.ts` a secas) para no
// arrastrar sin querer tests de `infrastructure/` de otros microservicios.
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/packages/**/*.test.ts',
    '<rootDir>/services/*/src/domain/**/*.test.ts',
    '<rootDir>/services/*/src/application/**/*.test.ts',
    '<rootDir>/services/auth-pre-token-generation/src/*.test.ts',
  ],
  moduleNameMapper: {
    '^@fuelhub/shared-kernel$': '<rootDir>/packages/shared-kernel/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
};
