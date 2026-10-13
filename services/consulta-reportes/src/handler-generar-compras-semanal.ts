// handler-generar-compras-semanal.ts -- composición raíz del Lambda que
// genera y sube a S3 el Excel del reporte semanal de compras (v1.86),
// disparado por `events.Schedule.cron(...)` (EventBridge, cada lunes) --
// NO por un evento de negocio como día/turno, ver la nota de cabecera de
// GenerarReporteComprasSemanalDocumento.ts.
//
// `fechaInicio` (el lunes de la semana a reportar) se calcula acá, no se
// recibe por parámetro -- restando 7 días a "hoy" (que, al dispararse el
// cron un lunes, también es lunes). Si algún día este Lambda se invoca a
// mano fuera del cron real (debugging), igual calcula sobre la semana
// anterior al día real de la invocación.

import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { S3Client } from '@aws-sdk/client-s3';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { GenerarReporteComprasSemanalDocumento } from './application/use-cases/GenerarReporteComprasSemanalDocumento';
import { PostgresReporteComprasSemanalQueryRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresReporteComprasSemanalQueryRepository';
import { ExcelReporteComprasSemanalRenderer } from './infrastructure/adapters/ExcelReporteComprasSemanalRenderer';
import { S3DocumentoStorage } from './infrastructure/adapters/S3DocumentoStorage';
import { EventBridgeReporteComprasSemanalPublisher } from './infrastructure/adapters/EventBridgeReporteComprasSemanalPublisher';
import { sumarDias } from './domain/value-objects/RangoFechas';
import { fuenteEventBridgePara, type Ambiente } from '@fuelhub/shared-kernel';

const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const repo = new PostgresReporteComprasSemanalQueryRepository(rdsClient, config);
const renderer = new ExcelReporteComprasSemanalRenderer();
const s3Client = new S3Client({});
const storage = new S3DocumentoStorage(s3Client, requiredEnv('REPORTES_BUCKET_NAME'));
const eventBridgeClient = new EventBridgeClient({});
const eventos = new EventBridgeReporteComprasSemanalPublisher(
  eventBridgeClient,
  requiredEnv('EVENTBRIDGE_BUS_NAME'),
  fuenteEventBridgePara(requiredEnv('AMBIENTE') as Ambiente)
);
const generarReporteComprasSemanalDocumento = new GenerarReporteComprasSemanalDocumento(repo, renderer, storage, eventos);

export const handler = async (): Promise<void> => {
  const hoy = new Date().toISOString().slice(0, 10);
  const fechaInicio = sumarDias(hoy, -7);
  await generarReporteComprasSemanalDocumento.ejecutar(fechaInicio);
};

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  }
  return valor;
}
