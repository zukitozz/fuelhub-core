// handler-generar-turno-documento.ts -- composición raíz del Lambda que
// genera y sube a S3 el PDF de reporte de turno (v1.85), disparado por el
// evento `CierreTurnoRegistrado` (EventBridge, bus `notificaciones-bus` --
// ver `services/ingest-cierre-turno/src/infrastructure/adapters/
// EventBridgeCierreTurnoPublisher.ts`, que lo publica en modo best effort, y
// la `events.Rule` nueva en `infra/lib/stacks/api-stack.ts` que filtra
// `Source: "FuelHubCloud"` / `DetailType: "CierreTurnoRegistrado"` hacia
// este Lambda).
//
// Calco de handler-generar-documento.ts (día) -- Lambda separado del GET
// (`handler-turno-documento.ts`) por el mismo motivo: trae pdfkit/RDS Data
// API, que el GET ya no necesita.

import type { EventBridgeEvent } from 'aws-lambda';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { S3Client } from '@aws-sdk/client-s3';
import { GenerarReporteTurnoDocumento, type CierreTurnoRegistradoEventLike } from './application/use-cases/GenerarReporteTurnoDocumento';
import { PostgresReporteDiaQueryRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresReporteDiaQueryRepository';
import { PdfKitReporteDiaRenderer } from './infrastructure/adapters/PdfKitReporteDiaRenderer';
import { S3DocumentoStorage } from './infrastructure/adapters/S3DocumentoStorage';

// Forma real del `detail` de `CierreTurnoRegistrado` (ver
// `EventPublisherPort.ts` en ingest-cierre-turno) -- este Lambda solo
// necesita `estacionCodigo`/`fechaNegocio`/`turno`/`cierreTurnoId`;
// `proyectoCodigo`/`estacionId`/`tipo`/`total` son parte del contrato con
// notificaciones-whatsapp y no se usan acá.
interface CierreTurnoRegistradoDetail {
  readonly estacionCodigo: string;
  readonly fechaNegocio: string;
  readonly turno: 'TURNO1' | 'TURNO2' | 'TURNO3';
  readonly cierreTurnoId: string;
}

const config: AuroraDataApiConfig = {
  resourceArn: requiredEnv('AURORA_CLUSTER_ARN'),
  secretArn: requiredEnv('AURORA_SECRET_ARN'),
  database: requiredEnv('AURORA_DATABASE_NAME'),
};

const rdsClient = new RDSDataClient({});
const repo = new PostgresReporteDiaQueryRepository(rdsClient, config);
const renderer = new PdfKitReporteDiaRenderer();
const s3Client = new S3Client({});
const storage = new S3DocumentoStorage(s3Client, requiredEnv('REPORTES_BUCKET_NAME'));
const generarReporteTurnoDocumento = new GenerarReporteTurnoDocumento(repo, renderer, storage);

export const handler = async (event: EventBridgeEvent<'CierreTurnoRegistrado', CierreTurnoRegistradoDetail>): Promise<void> => {
  const evento: CierreTurnoRegistradoEventLike = {
    estacionCodigo: event.detail.estacionCodigo,
    fechaNegocio: event.detail.fechaNegocio,
    turno: event.detail.turno,
    cierreTurnoId: event.detail.cierreTurnoId,
  };
  await generarReporteTurnoDocumento.ejecutar(evento);
};

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  }
  return valor;
}
