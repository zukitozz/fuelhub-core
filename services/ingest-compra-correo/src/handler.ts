// handler.ts — composición raíz del Lambda `ingest-compra-correo` (v1.81).
//
// A diferencia de todos los demás Lambdas del repo, este NO tiene ruta de
// API Gateway -- lo dispara un `events.Rule` con `schedule` (EventBridge
// Scheduler) por cron, mismo criterio de "Lambda sin HTTP, con su propio
// `events.Rule`" que ya usa `generarReporteDiaDocumento` (api-stack.ts,
// v1.78), aunque ese lo dispara un evento de negocio y este un cron.
//
// Una corrida: baja las credenciales de Gmail de Secrets Manager UNA vez
// (cacheadas a nivel de módulo -- sobreviven entre invocaciones "warm" del
// mismo contenedor Lambda, igual que `RDSDataClient`/el repo en el resto
// de handlers), lista los mensajes pendientes, y por cada uno corre
// `ProcesarFacturaProveedorCorreo` -- un mensaje que falla (XML corrupto,
// estación no reconocida, o cualquier otro error) se marca con la
// etiqueta de error y NO tumba la corrida completa; los demás mensajes de
// la misma corrida se siguen procesando igual.
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
import type { FacturaProveedorSourcePort } from './application/ports/FacturaProveedorSourcePort';

const auroraConfig: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const secretsClient = new SecretsManagerClient({});
const repo = new PostgresCompraCorreoRepository(rdsClient, auroraConfig);
const casoDeUso = new ProcesarFacturaProveedorCorreo(repo);

// Lazy + cacheada a nivel de módulo -- el fetch a Secrets Manager es
// async, no puede resolverse en el top-level síncrono del módulo como el
// resto de la configuración de arriba, pero solo hace falta UNA vez por
// contenedor Lambda (mismo criterio de "construir una sola vez, reusar
// entre invocaciones warm" que ya aplica el resto del repo a
// RDSDataClient/los repos).
let fuentePromise: Promise<FacturaProveedorSourcePort> | undefined;
function obtenerFuente(): Promise<FacturaProveedorSourcePort> {
  if (!fuentePromise) {
    fuentePromise = cargarCredencialesGmail().then((credenciales) => new GmailFacturaProveedorSource(credenciales));
  }
  return fuentePromise;
}

async function cargarCredencialesGmail(): Promise<CredencialesGmail> {
  const secretArn = requiredEnv('GMAIL_CREDENTIALS_SECRET_ARN');
  const resultado = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!resultado.SecretString) {
    throw new Error(`El secreto ${secretArn} no tiene SecretString (¿se corrió scripts/gmail-oauth-setup.mjs?).`);
  }
  // Mismo shape que escribe scripts/gmail-oauth-setup.mjs -- ver su
  // comentario de cabecera: { clientId, clientSecret, refreshToken }.
  const datos = JSON.parse(resultado.SecretString) as Partial<CredencialesGmail>;
  if (!datos.clientId || !datos.clientSecret || !datos.refreshToken) {
    throw new Error(`El secreto ${secretArn} no tiene la forma esperada { clientId, clientSecret, refreshToken }.`);
  }
  return { clientId: datos.clientId, clientSecret: datos.clientSecret, refreshToken: datos.refreshToken };
}

export const handler = async (): Promise<{ procesados: number; pendientesLeidos: number }> => {
  const fuente = await obtenerFuente();
  const mensajes = await fuente.listarMensajesPendientes();

  let procesados = 0;
  for (const mensaje of mensajes) {
    try {
      const resultado = await casoDeUso.ejecutar(mensaje.xmlContenido);
      await fuente.marcarProcesado(mensaje.mensajeId);
      procesados += 1;
      console.log(
        `[ingest-compra-correo] mensaje=${mensaje.mensajeId} comprobante=${resultado.numeroComprobante} lineas=${JSON.stringify(resultado.lineas)}`
      );
    } catch (err) {
      await fuente.marcarError(mensaje.mensajeId);
      console.error(`[ingest-compra-correo] mensaje=${mensaje.mensajeId} error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { procesados, pendientesLeidos: mensajes.length };
};

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  }
  return valor;
}
