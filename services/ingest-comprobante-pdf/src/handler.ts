// handler.ts -- composición raíz del Lambda ingest-comprobante-pdf.
// Sin Powertools/idempotencia (ver spec sección 2: PUT a una key fija no
// tiene efecto secundario al repetirse -- subir el mismo PDF dos veces pisa
// el mismo objeto).

import type { Context } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { parseAuthContext, jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { GuardarComprobantePdf } from './application/use-cases/GuardarComprobantePdf';
import { S3ComprobantePdfStorageRepository } from './infrastructure/adapters/S3ComprobantePdfStorageRepository';
import {
  extraerNumeracion,
  parsearComprobantePdfInput,
  type ApiGatewayEventLike,
} from './infrastructure/http/ApiGatewayRequestMapper';

const s3Client = new S3Client({});
const repo = new S3ComprobantePdfStorageRepository(s3Client, requiredEnv('COMPROBANTES_PDF_BUCKET_NAME'));
const guardarComprobantePdf = new GuardarComprobantePdf(repo);

export const handler = async (event: ApiGatewayEventLike, _context: Context): Promise<ApiResponse> => {
  try {
    const auth = parseAuthContext(event);
    const numeracion = extraerNumeracion(event);
    const input = parsearComprobantePdfInput(event);
    const resultado = await guardarComprobantePdf.ejecutar(auth, numeracion, input);
    return jsonResponse(201, resultado);
  } catch (err) {
    return mapErrorToResponse(err);
  }
};

function requiredEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Variable de entorno requerida no configurada: ${nombre}`);
  return valor;
}
