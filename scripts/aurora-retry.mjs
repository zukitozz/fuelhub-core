// scripts/aurora-retry.mjs
//
// Reintento automático para `DatabaseResumingException` de RDS Data API
// (v1.51, descubierto en el primer despliegue real) — no es un error real:
// pasa cuando el cluster de Aurora Serverless v2 (min capacity 0,
// scale-to-zero, sección 2.5/10.2) está "dormido" (recién creado o sin
// tráfico reciente) y la primera llamada de Data API lo despierta, algo que
// toma unos segundos. Es el comportamiento documentado de AWS para esta
// arquitectura — la única señal de que el cluster está resumiendo es
// justamente esta excepción, no hay forma de "esperar a que esté listo" de
// antemano. Usado por `db-migrate.mjs` alrededor de su única llamada de
// Data API fuera de una transacción ya abierta (`BeginTransactionCommand`)
// — una vez adentro de la transacción, el cluster ya está activo y no
// debería volver a pausarse en medio de la corrida.
//
// `test/integration/aurora-fixture-helpers.ts` (TypeScript, corre bajo
// ts-jest, no bajo Node ESM plano) tiene su propia copia pequeña de esta
// misma lógica en vez de importar este archivo — cruzar de un módulo
// TypeScript a un `.mjs` sin tipos requeriría `allowJs`/`checkJs` en
// `tsconfig.json` solo para esto; no vale la pena la complejidad extra por
// ~10 líneas duplicadas.
export async function conReintentoSiResuming(fn, { intentos = 8, esperaMs = 5000, log = console.log } = {}) {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      return await fn();
    } catch (error) {
      const esResuming = error?.name === 'DatabaseResumingException';
      if (!esResuming || intento === intentos) throw error;
      log(
        `Aurora resumiendo de pausa (scale-to-zero, sección 2.5/10.2) — reintento ${intento}/${intentos} en ${esperaMs / 1000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
  }
}
