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
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/packages/**/*.test.ts',
    '<rootDir>/services/*/src/domain/**/*.test.ts',
    '<rootDir>/services/*/src/application/**/*.test.ts',
  ],
  moduleNameMapper: {
    '^@fuelhub/shared-kernel$': '<rootDir>/packages/shared-kernel/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
};
