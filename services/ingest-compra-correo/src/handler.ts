// handler.ts — composición raíz del Lambda `ingest-compra-correo` (v1.81,
// multiempresa real desde v1.82).
//
// A diferencia de todos los demás Lambdas del repo, este NO tiene ruta de
// API Gateway -- lo dispara un `events.Rule` con `schedule` (EventBridge
// Scheduler) por cron, mismo criterio de "Lambda sin HTTP, con su propio
// `events.Rule`" que ya usa `generarReporteDiaDocumento` (api-stack.ts,
// v1.78), aunque ese lo dispara un evento de negocio y este un cron.
//
// v1.82 -- ya NO hay un único buzón de Gmail compartido por todo el grupo.
// Cada corrida consulta qué combinaciones (secreto de Gmail, etiqueta) hay
// que sondear -- eso reemplaza la variable de entorno fija
// `GMAIL_CREDENTIALS_SECRET_ARN` que existía hasta v1.81. Dos o más
// estaciones pueden compartir el mismo secreto (mismo buzón físico) con
// etiquetas distintas -- por eso primero se DEDUPLICA por (nombreSecreto,
// etiqueta) antes de sondear Gmail, así nunca se lee el mismo buzón+etiqueta
// dos veces en la misma corrida.
//
// v1.84 -- esa config YA NO sale de Postgres (hasta v1.83 vivía en la tabla
// `estaciones_correo_proveedores`, vía `repo.listarConfiguracionesCorreoActivas()`).
// Hallazgo real de Jorge: eso obligaba a tocar Aurora INCONDICIONALMENTE en
// cada corrida del cron (cada 30 min en prod), ANTES de siquiera mirar
// Gmail -- con Aurora Serverless v2 en `minCapacity 0`, cada corrida pagaba
// el costo completo de "despertarla" solo para leer 4 filas que casi nunca
// cambian. Ahora se importa directo como código versionado
// (`config/estacionesCorreoProveedores.ts`) -- Aurora recién se toca más
// abajo, dentro de `casoDeUso.ejecutar(...)`, y SOLO si Gmail de verdad
// tiene algún mensaje pendiente que evaluar.
//
// Las credenciales de cada secreto se cachean a nivel de módulo por
// nombre de secreto (sobreviven entre invocaciones "warm" del mismo
// contenedor Lambda, igual que `RDSDataClient`/el repo en el resto de
// handlers) -- si dos estaciones comparten secreto, ese secreto se lee de
// Secrets Manager UNA sola vez por contenedor, no una vez por estación.
//
// Aislamiento de fallas en TRES niveles (v1.83 agrega el tercero): (a) una
// CONFIGURACIÓN que falla (secreto inexistente/revocado, Gmail caído para
// ese buzón) no tumba las demás configuraciones de la misma corrida -- se
// loguea y se sigue con la siguiente; (b) dentro de una configuración, un
// MENSAJE que falla (sin ningún XML adjunto) tampoco tumba los demás
// mensajes de esa misma configuración; (c) v1.83 -- dentro de un mensaje,
// una FACTURA que falla (un mensaje puede traer varias, ver la nota de
// cabecera de FacturaProveedorSourcePort.ts) tampoco tumba las demás
// facturas del mismo correo -- se procesan todas, y el mensaje se marca
// `FuelHub/Error` si alguna falló (aunque otras sí hayan registrado bien).
//
// Sin Powertools/idempotencia de DynamoDB acá (a diferencia de los
// Lambdas de ingesta de cierres) -- la idempotencia real de esta
// capacidad es el índice único de `compras` + el chequeo
// `existeComprobante` (ver nota de cabecera de la migración
// 1788600000000), no una clave de idempotencia por invocación: dos
// corridas del cron perfectamente pueden procesar el mismo mensaje si las
// etiquetas de Gmail se desincronizaran, y eso ya está cubierto.
//
// v1.82.1 -- `etiquetaGmail` puede venir `null` (migración 1788900000000):
// un buzón dedicado exclusivamente a facturas (sin mezclar con otro
// correo) no necesita que Jorge etiquete nada a mano -- se sondea TODO el
// buzón. `GmailFacturaProveedorSource` es quien arma el query distinto
// según el caso; acá solo hace falta que la deduplicación por (secreto,
// etiqueta) trate `null` como un valor de etiqueta más (ver `clave()`).

import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ProcesarFacturaProveedorCorreo } from './application/use-cases/ProcesarFacturaProveedorCorreo';
import { PostgresCompraCorreoRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresCompraCorreoRepository';
import { GmailFacturaProveedorSource, type CredencialesGmail } from './infrastructure/adapters/GmailFacturaProveedorSource';
import { ESTACIONES_CORREO_PROVEEDORES, type ConfiguracionCorreoEstacion } from './config/estacionesCorreoProveedores';

const auroraConfig: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const secretsClient = new SecretsManagerClient({});
const repo = new PostgresCompraCorreoRepository(rdsClient, auroraConfig);
const casoDeUso = new ProcesarFacturaProveedorCorreo(repo);

// Cacheadas a nivel de módulo POR NOMBRE DE SECRETO -- si dos estaciones
// comparten buzón, este Map asegura que el fetch a Secrets Manager (async,
// no resoluble en el top-level síncrono del módulo) se haga una sola vez
// por secreto, no una vez por estación ni una vez por invocación.
const credencialesPorSecreto = new Map<string, Promise<CredencialesGmail>>();

function obtenerCredenciales(nombreSecreto: string): Promise<CredencialesGmail> {
  let promesa = credencialesPorSecreto.get(nombreSecreto);
  if (!promesa) {
    promesa = cargarCredencialesGmail(nombreSecreto);
    credencialesPorSecreto.set(nombreSecreto, promesa);
  }
  return promesa;
}

async function cargarCredencialesGmail(nombreSecreto: string): Promise<CredencialesGmail> {
  // `GetSecretValueCommand` acepta el NOMBRE del secreto directamente como
  // `SecretId` -- no hace falta resolver el ARN completo en ningún lado
  // (ver cabecera de la migración 1788800000000).
  const resultado = await secretsClient.send(new GetSecretValueCommand({ SecretId: nombreSecreto }));
  if (!resultado.SecretString) {
    throw new Error(`El secreto ${nombreSecreto} no tiene SecretString (¿se corrió scripts/gmail-oauth-setup.mjs --buzon ...?).`);
  }
  // Mismo shape que escribe scripts/gmail-oauth-setup.mjs -- ver su
  // comentario de cabecera: { clientId, clientSecret, refreshToken }.
  const datos = JSON.parse(resultado.SecretString) as Partial<CredencialesGmail>;
  if (!datos.clientId || !datos.clientSecret || !datos.refreshToken) {
    throw new Error(`El secreto ${nombreSecreto} no tiene la forma esperada { clientId, clientSecret, refreshToken }.`);
  }
  return { clientId: datos.clientId, clientSecret: datos.clientSecret, refreshToken: datos.refreshToken };
}

/**
 * Clave de deduplicación -- dos configuraciones con el mismo secreto Y la
 * misma etiqueta son, a efectos de sondeo, la misma cosa. `etiquetaGmail`
 * puede ser `null` (migración 1788900000000, "sin filtro de etiqueta") --
 * se normaliza a un literal fijo para la clave en vez de dejar que el
 * template string lo coaccione implícitamente a "null".
 */
function clave(config: Pick<ConfiguracionCorreoEstacion, 'nombreSecretoGmail' | 'etiquetaGmail'>): string {
  return `${config.nombreSecretoGmail}::${config.etiquetaGmail ?? '(sin-etiqueta)'}`;
}

export const handler = async (): Promise<{ procesados: number; pendientesLeidos: number; buzonesSondeados: number }> => {
  const configuraciones = ESTACIONES_CORREO_PROVEEDORES.filter((config) => config.activo);

  const buzonesUnicos = new Map<string, ConfiguracionCorreoEstacion>();
  for (const config of configuraciones) {
    buzonesUnicos.set(clave(config), config);
  }

  let procesados = 0;
  let pendientesLeidos = 0;

  for (const config of buzonesUnicos.values()) {
    try {
      const credenciales = await obtenerCredenciales(config.nombreSecretoGmail);
      const fuente = new GmailFacturaProveedorSource(credenciales, config.etiquetaGmail);
      const mensajes = await fuente.listarMensajesPendientes();
      pendientesLeidos += mensajes.length;

      for (const mensaje of mensajes) {
        // v1.83 -- un mensaje puede traer varias facturas (varios XML
        // adjuntos, ver la nota de cabecera de FacturaProveedorSourcePort.ts).
        // Cada una se procesa por separado (un XML corrupto/de una estación
        // no reconocida no debe tumbar las demás facturas del MISMO correo,
        // mismo criterio de aislamiento que ya existía línea por línea
        // dentro de una sola factura). El mensaje completo solo se marca
        // `FuelHub/Procesado` si TODAS sus facturas procesaron sin
        // excepción -- si alguna falló, se marca `FuelHub/Error` aunque
        // otras hayan registrado bien: las que sí registraron ya quedaron
        // en la base (protegidas por `existeComprobante`/el índice único),
        // así que un reintento futuro de este mensaje no las duplica, solo
        // vuelve a intentar la(s) que fallaron.
        let huboError = false;
        for (const xmlContenido of mensaje.xmlContenidos) {
          try {
            const resultado = await casoDeUso.ejecutar(xmlContenido);
            procesados += 1;
            console.log(
              `[ingest-compra-correo] etiqueta=${config.etiquetaGmail ?? '(sin-etiqueta)'} mensaje=${mensaje.mensajeId} comprobante=${resultado.numeroComprobante} lineas=${JSON.stringify(resultado.lineas)}`
            );
          } catch (err) {
            huboError = true;
            console.error(
              `[ingest-compra-correo] etiqueta=${config.etiquetaGmail ?? '(sin-etiqueta)'} mensaje=${mensaje.mensajeId} error: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        await (huboError ? fuente.marcarError(mensaje.mensajeId) : fuente.marcarProcesado(mensaje.mensajeId));
      }
    } catch (err) {
      // Una configuración entera que falla (secreto inexistente/revocado,
      // Gmail caído para ESE buzón) no tumba las demás -- ver cabecera.
      console.error(
        `[ingest-compra-correo] fallo sondeando secreto=${config.nombreSecretoGmail} etiqueta=${config.etiquetaGmail ?? '(sin-etiqueta)'}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { procesados, pendientesLeidos, buzonesSondeados: buzonesUnicos.size };
};

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  }
  return valor;
}
