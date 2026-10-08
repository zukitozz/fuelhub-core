// config/estacionesCorreoProveedores.ts
//
// v1.84 -- REEMPLAZA la tabla Postgres `estaciones_correo_proveedores`
// (migración 1788800000000, borrada por 1789000000000). Hallazgo real de
// Jorge: el handler leía esta tabla en Aurora INCONDICIONALMENTE en cada
// corrida del cron (cada 30 min en prod), ANTES de siquiera mirar Gmail --
// como Aurora Serverless v2 está en `minCapacity 0` (se pausa sola sin
// tráfico), cada corrida pagaba el costo completo de "despertarla" (~15-25s
// de reintentos, ver `rds-retry.ts`) solo para leer una tabla de 4 filas
// que casi nunca cambia, tenga o no correo nuevo.
//
// Esta config es candidata perfecta para dejar de vivir en una base de
// datos: es puramente administrativa (la decide y carga Jorge a mano, nunca
// la escribe ningún flujo de negocio -- ver el comentario original de
// 1788800000000, "sin seed acá... no hay un valor por defecto razonable que
// adivinar"), cambia rarísima vez, y nada la consulta salvo este propio
// Lambda. Convertirla en código versionado en git (en vez de una fila que
// Jorge pide por SQL) tiene las mismas garantías operativas (Jorge sigue
// siendo quien decide el contenido) pero sin el costo de Aurora en cada
// tick, y con el beneficio extra de quedar en el historial de git (mismo
// criterio que ya se usaba para seeds vía migración, un paso más simple
// todavía: ni migración hace falta).
//
// Confirmado con el contenido REAL de la tabla antes de borrarla (dev Y
// prod, idéntico en ambos): las 4 estaciones de "nonato" comparten el MISMO
// buzón físico de Gmail (secreto `fuelhubcore/nonato/prod/gmail-proveedores/facturas`
// -- el nombre dice "prod" aunque dev también apunta ahí, ver la nota
// grande de `IngestCompraCorreoSchedule` en api-stack.ts sobre por qué dev
// y prod comparten buzón real), sin filtro de etiqueta (`etiquetaGmail:
// null` -- buzón dedicado, sondea TODO lo no procesado/error).
//
// Para agregar/editar una estación: cambiar este archivo, commit + push --
// el pipeline (`.github/workflows/deploy.yml`) lo despliega solo a dev y
// pide aprobación para prod, igual que cualquier otro cambio de código.

export interface ConfiguracionCorreoEstacion {
  readonly estacionCodigo: string;
  readonly nombreSecretoGmail: string;
  /** `null` = sin filtro de etiqueta, sondear TODO el buzón (ver GmailFacturaProveedorSource.ts). */
  readonly etiquetaGmail: string | null;
  readonly activo: boolean;
}

const BUZON_FACTURAS_NONATO = 'fuelhubcore/nonato/prod/gmail-proveedores/facturas';

export const ESTACIONES_CORREO_PROVEEDORES: readonly ConfiguracionCorreoEstacion[] = [
  { estacionCodigo: 'ANDAHUASI', nombreSecretoGmail: BUZON_FACTURAS_NONATO, etiquetaGmail: null, activo: true },
  { estacionCodigo: 'CHANCAYLLO', nombreSecretoGmail: BUZON_FACTURAS_NONATO, etiquetaGmail: null, activo: true },
  { estacionCodigo: 'MALA', nombreSecretoGmail: BUZON_FACTURAS_NONATO, etiquetaGmail: null, activo: true },
  { estacionCodigo: 'PACHACUTEC', nombreSecretoGmail: BUZON_FACTURAS_NONATO, etiquetaGmail: null, activo: true },
];
