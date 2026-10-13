// handler-top-facturas-documento.ts -- composición raíz del Lambda de
// GET /v1/reportes/top-facturas/documento (v1.89).
//
// Calco de handler-compras-semanal-documento.ts: solo S3, nada de Postgres.
// El Excel ya se generó del lado de ingest-reporte-top-facturas (otro
// microservicio) -- ver la nota de cabecera de ObtenerReporteTopFacturasDocumento.ts.

import { S3Client } from '@aws-sdk/client-s3';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { ObtenerReporteTopFacturasDocumento } from './application/use-cases/ObtenerReporteTopFacturasDocumento';
import { S3DocumentoStorage } from './infrastructure/adapters/S3DocumentoStorage';

interface ApiGatewayEventLike {
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

const s3Client = new S3Client({});
const storage = new S3DocumentoStorage(s3Client, requiredEnv('REPORTES_BUCKET_NAME'));
const obtenerReporteTopFacturasDocumento = new ObtenerReporteTopFacturasDocumento(storage);

export const handler = async (event: ApiGatewayEventLike): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const qs = event.queryStringParameters ?? {};
    const resultado = await obtenerReporteTopFacturasDocumento.ejecutar(auth, {
      estacionCodigo: qs.estacionCodigo,
      semanaInicio: qs.semanaInicio,
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
