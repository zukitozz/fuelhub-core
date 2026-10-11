// handler-compras-semanal-documento.ts -- composición raíz del Lambda de
// GET /v1/reportes/compras-semanal/documento (v1.86).
//
// Calco de handler-turno-documento.ts: solo S3, nada de Postgres/exceljs --
// ver la nota de cabecera de ObtenerReporteComprasSemanalDocumento.ts.

import { S3Client } from '@aws-sdk/client-s3';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { ObtenerReporteComprasSemanalDocumento } from './application/use-cases/ObtenerReporteComprasSemanalDocumento';
import { S3DocumentoStorage } from './infrastructure/adapters/S3DocumentoStorage';

interface ApiGatewayEventLike {
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

const s3Client = new S3Client({});
const storage = new S3DocumentoStorage(s3Client, requiredEnv('REPORTES_BUCKET_NAME'));
const obtenerReporteComprasSemanalDocumento = new ObtenerReporteComprasSemanalDocumento(storage);

export const handler = async (event: ApiGatewayEventLike): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const qs = event.queryStringParameters ?? {};
    const resultado = await obtenerReporteComprasSemanalDocumento.ejecutar(auth, {
      estacionCodigo: qs.estacionCodigo,
      fechaInicio: qs.fechaInicio,
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
