// handler.ts -- composicion raiz del Lambda consulta-comprobante.
//
// Sin Powertools/idempotencia (GET, sin efecto secundario) -- mismo
// criterio que ingest-comprobante-pdf. Sin Aurora -- solo S3 (HeadObject +
// URL presignada), igual que ese servicio.

import type { Context } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { ConsultarComprobante } from './application/use-cases/ConsultarComprobante';
import { S3ComprobanteLecturaRepository } from './infrastructure/adapters/S3ComprobanteLecturaRepository';
import { mapearConsultaComprobante, type ApiGatewayEventLike } from './infrastructure/http/ApiGatewayRequestMapper';

const s3Client = new S3Client({});
const repo = new S3ComprobanteLecturaRepository(s3Client, requiredEnv('COMPROBANTES_PDF_BUCKET_NAME'));
const consultarComprobante = new ConsultarComprobante(repo);

export const handler = async (event: ApiGatewayEventLike, _context: Context): Promise<ApiResponse> => {
  try {
    const input = mapearConsultaComprobante(event);
    const resultado = await consultarComprobante.ejecutar(input);
    return jsonResponse(200, resultado);
  } catch (err) {
    return mapErrorToResponse(err);
  }
};

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  return valor;
}
