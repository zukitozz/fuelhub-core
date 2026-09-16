// handler-generar-documento.ts -- composición raíz del Lambda que genera y
// sube a S3 los PDFs de reporte de día (v1.78), disparado por el evento
// `CierreDiaRegistrado` (EventBridge, bus `notificaciones-bus` -- ver
// `services/ingest-cierre-dia/src/infrastructure/adapters/
// EventBridgeCierreDiaPublisher.ts`, que ya lo publica hoy en modo best
// effort, y la `events.Rule` nueva en `infra/lib/stacks/api-stack.ts` que
// filtra `Source: "FuelHubCloud"` / `DetailType: "CierreDiaRegistrado"`
// hacia este Lambda).
//
// Lambda SEPARADO del de GET (`handler-documento.ts`) por el mismo motivo
// que ya separaba ese de los otros 3 reportes JSON antes de v1.78: trae
// dependencias que el GET ya no necesita (pdfkit para renderizar) y un
// timeout más largo (generar 2 PDFs -- individual + consolidado -- y
// subirlos a S3 puede tardar más que servir una URL firmada). SÍ comparte
// con el GET el mismo dominio/aplicación (`ReporteDiaQueryRepository`,
// `DocumentoReporteKey`) -- no se duplica esa lógica, solo la capa de
// infraestructura/composición, mismo criterio de siempre en este repo.
//
// No lleva `Idempotency-Key`/DynamoDB (a diferencia de ingest-cierre-turno/
// ingest-cierre-dia): ver la nota grande en GenerarReporteDiaDocumento.ts
// sobre por qué una entrega duplicada del evento no necesita protección
// especial acá (misma key determinística, PUT sobrescribe).

import type { EventBridgeEvent } from 'aws-lambda';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { S3Client } from '@aws-sdk/client-s3';
import { GenerarReporteDiaDocumento, type CierreDiaRegistradoEventLike } from './application/use-cases/GenerarReporteDiaDocumento';
import { PostgresReporteDiaQueryRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresReporteDiaQueryRepository';
import { PdfKitReporteDiaRenderer } from './infrastructure/adapters/PdfKitReporteDiaRenderer';
import { S3DocumentoStorage } from './infrastructure/adapters/S3DocumentoStorage';

// Forma real del `detail` de `CierreDiaRegistrado` (ver
// `EventPublisherPort.ts` en ingest-cierre-dia) -- este Lambda solo necesita
// `estacionCodigo`/`fechaNegocio`; `proyectoCodigo`/`estacionId`/`total`/
// `cierreDiaId` son parte del contrato con notificaciones-whatsapp y no se
// usan acá.
interface CierreDiaRegistradoDetail {
  readonly estacionCodigo: string;
  readonly fechaNegocio: string;
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
const generarReporteDiaDocumento = new GenerarReporteDiaDocumento(repo, renderer, storage);

export const handler = async (event: EventBridgeEvent<'CierreDiaRegistrado', CierreDiaRegistradoDetail>): Promise<void> => {
  const evento: CierreDiaRegistradoEventLike = {
    estacionCodigo: event.detail.estacionCodigo,
    fechaNegocio: event.detail.fechaNegocio,
  };
  await generarReporteDiaDocumento.ejecutar(evento);
};

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  }
  return valor;
}
