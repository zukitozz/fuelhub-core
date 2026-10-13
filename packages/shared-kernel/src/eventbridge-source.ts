// packages/shared-kernel/src/eventbridge-source.ts
//
// v1.88 -- bug real de producción, reportado por notificaciones-whatsapp
// (12 oct 2026): `Source: 'FuelHubCloud'` estaba HARDCODEADO igual en dev y
// en prod en los 3 publicadores de EventBridge (`EventBridgeCierreDiaPublisher`,
// `EventBridgeCierreTurnoPublisher`, `EventBridgeReporteComprasSemanalPublisher`)
// -- como dev y prod comparten el mismo `notificaciones-bus` (recurso
// externo, ver api-stack.ts), cualquier corrida de dev terminaba publicando
// eventos indistinguibles de los de prod del otro lado. Confirmado con
// evidencia real: el cron semanal de compras corrió en dev y prod el mismo
// lunes 8am, cada uno publicando su propio juego de `estacionId` al mismo
// bus -- notificaciones-whatsapp recibió los dos juegos, sin forma de saber
// cuál ignorar.
//
// Fix acordado con ellos: dev usa un `Source` DISTINTO
// (`"FuelHubCloud-dev"`) en vez de "FuelHubCloud" a secas -- sus reglas ya
// filtran por `source: ["FuelHubCloud"]` exacto (EventBridge no normaliza
// casing ni hace matching parcial), así que ese cambio los hace ignorar dev
// automáticamente, SIN que ellos toquen nada de su lado. El valor de PROD
// queda exactamente igual que siempre (`"FuelHubCloud"`, string literal,
// ver confirmación v1.57 en `EventBridgeCierreDiaPublisher.ts`) -- no
// renegociable sin coordinar con ellos, es matching exacto de string.
//
// Vive en shared-kernel (no repetido en cada publicador) para que el valor
// de PROD sea IMPOSIBLE de escribir distinto por accidente en alguno de los
// 3 lugares -- un solo punto de verdad, probado acá una sola vez.

export type Ambiente = 'dev' | 'prod';

/** El valor real y nunca-tocar para producción -- ver nota de cabecera. */
export const SOURCE_FUELHUBCLOUD_PROD = 'FuelHubCloud';

/**
 * `"FuelHubCloud"` en prod (sin cambios, valor histórico); `"FuelHubCloud-dev"`
 * en cualquier otro ambiente -- ver nota de cabecera.
 */
export function fuenteEventBridgePara(ambiente: Ambiente): string {
  return ambiente === 'prod' ? SOURCE_FUELHUBCLOUD_PROD : `${SOURCE_FUELHUBCLOUD_PROD}-${ambiente}`;
}
