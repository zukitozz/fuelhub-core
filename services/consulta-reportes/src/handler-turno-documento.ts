// handler-turno-documento.ts -- composición raíz del Lambda de
// GET /v1/reportes/turno/documento (v1.85).
//
// Calco de handler-documento.ts (día): solo S3, nada de Postgres/pdfkit --
// ver la nota de cabecera de ObtenerReporteTurnoDocumento.ts.

import { S3Client } from '@aws-sdk/client-s3';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { ObtenerReporteTurnoDocumento } from './application/use-cases/ObtenerReporteTurnoDocumento';
import { S3DocumentoStorage } from './infrastructure/adapters/S3DocumentoStorage';

interface ApiGatewayEventLike {
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

const s3Client = new S3Client({});
const storage = new S3DocumentoStorage(s3Client, requiredEnv('REPORTES_BUCKET_NAME'));
const obtenerReporteTurnoDocumento = new ObtenerReporteTurnoDocumento(storage);

export const handler = async (event: ApiGatewayEventLike): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const qs = event.queryStringParameters ?? {};
    const resultado = await obtenerReporteTurnoDocumento.ejecutar(auth, {
      estacionCodigo: qs.estacionCodigo,
      fechaNegocio: qs.fechaNegocio,
      turno: qs.turno,
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
