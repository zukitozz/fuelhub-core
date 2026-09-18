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
// Cada corrida empieza preguntándole a la base `listarConfiguracionesCorreoActivas()`
// (tabla `estaciones_correo_proveedores`, migración 1788800000000) qué
// combinaciones (secreto de Gmail, etiqueta) hay que sondear -- eso
// reemplaza la variable de entorno fija `GMAIL_CREDENTIALS_SECRET_ARN` que
// existía hasta v1.81. Dos o más estaciones pueden compartir el mismo
// secreto (mismo buzón físico) con etiquetas distintas -- por eso primero
// se DEDUPLICA por (nombreSecreto, etiqueta) antes de sondear Gmail, así
// nunca se lee el mismo buzón+etiqueta dos veces en la misma corrida.
//
// Las credenciales de cada secreto se cachean a nivel de módulo por
// nombre de secreto (sobreviven entre invocaciones "warm" del mismo
// contenedor Lambda, igual que `RDSDataClient`/el repo en el resto de
// handlers) -- si dos estaciones comparten secreto, ese secreto se lee de
// Secrets Manager UNA sola vez por contenedor, no una vez por estación.
//
// Aislamiento de fallas en DOS niveles, no solo uno: (a) una CONFIGURACIÓN
// que falla (secreto inexistente/revocado, Gmail caído para ese buzón) no
// tumba las demás configuraciones de la misma corrida -- se loguea y se
// sigue con la siguiente; (b) dentro de una configuración, un MENSAJE que
// falla (XML corrupto, estación no reconocida) tampoco tumba los demás
// mensajes de esa misma configuración -- mismo criterio que ya existía en
// v1.81, ahora aplicado en dos capas.
//
// Sin Powertools/idempotencia de DynamoDB acá (a diferencia de los
// Lambdas de ingesta de cierres) -- la idempotencia real de esta
// capacidad es el índice único de `compras` + el chequeo
// `existeComprobante` (ver nota de cabecera de la migración
// 1788600000000), no una clave de idempotencia por invocación: dos
// corridas del cron perfectamente pueden procesar el mismo mensaje si las
// etiquetas de Gmail se desincronizaran, y eso ya está cubierto.

import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ProcesarFacturaProveedorCorreo } from './application/use-cases/ProcesarFacturaProveedorCorreo';
import { PostgresCompraCorreoRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresCompraCorreoRepository';
import { GmailFacturaProveedorSource, type CredencialesGmail } from './infrastructure/adapters/GmailFacturaProveedorSource';
import type { ConfiguracionCorreoEstacion } from './application/ports/CompraCorreoRepository';

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

/** Clave de deduplicación -- dos configuraciones con el mismo secreto Y la misma etiqueta son, a efectos de sondeo, la misma cosa. */
function clave(config: Pick<ConfiguracionCorreoEstacion, 'nombreSecretoGmail' | 'etiquetaGmail'>): string {
  return `${config.nombreSecretoGmail}::${config.etiquetaGmail}`;
}

export const handler = async (): Promise<{ procesados: number; pendientesLeidos: number; buzonesSondeados: number }> => {
  const configuraciones = await repo.listarConfiguracionesCorreoActivas();

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
        try {
          const resultado = await casoDeUso.ejecutar(mensaje.xmlContenido);
          await fuente.marcarProcesado(mensaje.mensajeId);
          procesados += 1;
          console.log(
            `[ingest-compra-correo] etiqueta=${config.etiquetaGmail} mensaje=${mensaje.mensajeId} comprobante=${resultado.numeroComprobante} lineas=${JSON.stringify(resultado.lineas)}`
          );
        } catch (err) {
          await fuente.marcarError(mensaje.mensajeId);
          console.error(
            `[ingest-compra-correo] etiqueta=${config.etiquetaGmail} mensaje=${mensaje.mensajeId} error: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    } catch (err) {
      // Una configuración entera que falla (secreto inexistente/revocado,
      // Gmail caído para ESE buzón) no tumba las demás -- ver cabecera.
      console.error(
        `[ingest-compra-correo] fallo sondeando secreto=${config.nombreSecretoGmail} etiqueta=${config.etiquetaGmail}: ${err instanceof Error ? err.message : String(err)}`
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
