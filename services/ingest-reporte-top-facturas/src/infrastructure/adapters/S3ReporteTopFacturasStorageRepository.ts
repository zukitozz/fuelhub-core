// infrastructure/adapters/S3ReporteTopFacturasStorageRepository.ts
//
// Guarda DOS objetos bajo la misma key base (ver construirKeyReporteTopFacturasJson/Excel,
// @fuelhub/shared-kernel): el JSON completo (con el detalle factura-por-
// factura, a diferencia del resumen que lleva el evento -- ver
// EventPublisherPort.ts) y el Excel ya renderizado (v1.89, lo sirve
// GET /reportes/top-facturas/documento en consulta-reportes). Los 2
// PutObject corren en paralelo -- mismo criterio que
// S3ComprobantePdfStorageRepository.ts con PDF/XML/CDR. PutObject a una key
// fija es naturalmente idempotente: reintentar el mismo reporte de la misma
// semana pisa los mismos objetos.

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { construirKeyReporteTopFacturasExcel, construirKeyReporteTopFacturasJson } from '@fuelhub/shared-kernel';
import type { ClienteTopFacturasInput } from '../../domain/ReporteTopFacturasInput';
import type { ReporteTopFacturasStorageRepository } from '../../application/ports/ReporteTopFacturasStorageRepository';

const CONTENT_TYPE_EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export class S3ReporteTopFacturasStorageRepository implements ReporteTopFacturasStorageRepository {
  constructor(private readonly client: S3Client, private readonly bucketName: string) {}

  async guardar(params: {
    codigoEstacion: string;
    semanaInicio: string;
    top: readonly ClienteTopFacturasInput[];
    excelBuffer: Buffer;
  }) {
    const key = construirKeyReporteTopFacturasJson(params.codigoEstacion, params.semanaInicio);
    const keyExcel = construirKeyReporteTopFacturasExcel(params.codigoEstacion, params.semanaInicio);

    await Promise.all([
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: JSON.stringify({ codigoEstacion: params.codigoEstacion, semanaInicio: params.semanaInicio, top: params.top }),
          ContentType: 'application/json',
        })
      ),
      this.client.send(
        new PutObjectCommand({ Bucket: this.bucketName, Key: keyExcel, Body: params.excelBuffer, ContentType: CONTENT_TYPE_EXCEL })
      ),
    ]);

    return { key, keyExcel };
  }
}
