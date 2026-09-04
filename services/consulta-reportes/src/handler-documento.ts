// handler-documento.ts -- composición raíz del Lambda de
// GET /v1/reportes/dia/documento (v1.60).
//
// Lambda SEPARADO del handler.ts de consulta-reportes a propósito (ver la
// nota grande de api-stack.ts): trae dependencias que los otros 3 reportes
// JSON no necesitan (pdfkit para renderizar, @aws-sdk/client-s3 +
// s3-request-presigner para subir/firmar), y un timeout más largo (generar
// PDF + subir a S3 puede tardar más que una sola consulta a Postgres).
// Comparte de todos modos el mismo dominio/aplicación que consulta-reportes
// (mismo ReporteDiaQueryRepository, mismo value object de fecha) -- no se
// duplica esa lógica, solo la capa de infraestructura/composición.

import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { S3Client } from '@aws-sdk/client-s3';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { ObtenerReporteDiaDocumento } from './application/use-cases/ObtenerReporteDiaDocumento';
import { PostgresReporteDiaQueryRepository, type AuroraDataApiConfig } from './infrastructure/adapters/PostgresReporteDiaQueryRepository';
import { PdfKitReporteDiaRenderer } from './infrastructure/adapters/PdfKitReporteDiaRenderer';
import { S3DocumentoStorage } from './infrastructure/adapters/S3DocumentoStorage';

interface ApiGatewayEventLike {
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
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
const obtenerReporteDiaDocumento = new ObtenerReporteDiaDocumento(repo, renderer, storage);

export const handler = async (event: ApiGatewayEventLike): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const qs = event.queryStringParameters ?? {};
    const resultado = await obtenerReporteDiaDocumento.ejecutar(auth, {
      estacionCodigo: qs.estacionCodigo,
      fechaNegocio: qs.fechaNegocio,
    });
    return jsonResponse(200, resultado);
  } catch (err) {
    return mapErrorToResponse(err);
  }
};

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  }
  return valor;
}
