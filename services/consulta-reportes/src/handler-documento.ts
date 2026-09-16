// handler-documento.ts -- composición raíz del Lambda de
// GET /v1/reportes/dia/documento (v1.60).
//
// v1.78 -- se simplifica radicalmente: como este caso de uso ya no genera
// el PDF (eso lo hace ahora `handler-generar-documento.ts`, disparado por
// el evento `CierreDiaRegistrado`), este Lambda pierde POR COMPLETO sus
// dependencias de Postgres (`@aws-sdk/client-rds-data`,
// `PostgresReporteDiaQueryRepository`) y de renderizado
// (`pdfkit`/`PdfKitReporteDiaRenderer`, y con ellas el `commandHooks.
// afterBundling` que copiaba los `.afm` de pdfkit al bundle -- ver
// api-stack.ts). Solo le queda S3 (`S3DocumentoStorage`) -- Lambda más
// liviano, arranque más rápido, y ya no necesita tocar Aurora en absoluto
// (se le retira `grantDataApiAccess` en infra).

import { S3Client } from '@aws-sdk/client-s3';
import { parseAuthContext } from '@fuelhub/shared-kernel';
import { jsonResponse, mapErrorToResponse, type ApiResponse } from '@fuelhub/shared-kernel';
import { ObtenerReporteDiaDocumento } from './application/use-cases/ObtenerReporteDiaDocumento';
import { S3DocumentoStorage } from './infrastructure/adapters/S3DocumentoStorage';

interface ApiGatewayEventLike {
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: { authorizer?: { claims?: Record<string, string> } };
}

const s3Client = new S3Client({});
const storage = new S3DocumentoStorage(s3Client, requiredEnv('REPORTES_BUCKET_NAME'));
const obtenerReporteDiaDocumento = new ObtenerReporteDiaDocumento(storage);

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
