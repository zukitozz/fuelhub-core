// handler-periodo.ts -- composicion raiz del Lambda de
// GET /v1/comprobantes/consulta (v1.79).
//
// Lambda separado de handler.ts (mismo criterio que consulta-reportes con
// handler-documento.ts) -- comparte el bucket de comprobantes pero expone
// un caso de uso distinto (periodo/zip en vez de un comprobante puntual).

import type { Context } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { ConsultarComprobantesPeriodo } from './application/use-cases/ConsultarComprobantesPeriodo';
import { S3ComprobantePeriodoLecturaRepository } from './infrastructure/adapters/S3ComprobantePeriodoLecturaRepository';
import { mapearConsultaComprobantePeriodo, type ApiGatewayEventLike } from './infrastructure/http/ApiGatewayRequestMapper';

const s3Client = new S3Client({});
const repo = new S3ComprobantePeriodoLecturaRepository(s3Client, requiredEnv('COMPROBANTES_PDF_BUCKET_NAME'));
const consultarComprobantesPeriodo = new ConsultarComprobantesPeriodo(repo);

export const handler = async (event: ApiGatewayEventLike, _context: Context): Promise<ApiResponse> => {
  try {
    const input = mapearConsultaComprobantePeriodo(event);
    const resultado = await consultarComprobantesPeriodo.ejecutar(input);
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
