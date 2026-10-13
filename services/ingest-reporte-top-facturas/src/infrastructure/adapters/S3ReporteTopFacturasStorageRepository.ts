// infrastructure/adapters/S3ReporteTopFacturasStorageRepository.ts
//
// Guarda el JSON completo del reporte (con el detalle factura-por-factura,
// a diferencia del resumen que lleva el evento -- ver EventPublisherPort.ts)
// bajo su key estable (ReporteTopFacturasKey.ts). PutObject a una key fija
// es naturalmente idempotente (mismo criterio que S3ComprobantePdfStorageRepository.ts):
// reintentar el mismo reporte de la misma semana pisa el mismo objeto.

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ClienteTopFacturasInput } from '../../domain/ReporteTopFacturasInput';
import { construirKeyReporteTopFacturas } from '../../domain/ReporteTopFacturasKey';
import type { ReporteTopFacturasStorageRepository } from '../../application/ports/ReporteTopFacturasStorageRepository';

export class S3ReporteTopFacturasStorageRepository implements ReporteTopFacturasStorageRepository {
  constructor(private readonly client: S3Client, private readonly bucketName: string) {}

  async guardar(params: { codigoEstacion: string; semanaInicio: string; top: readonly ClienteTopFacturasInput[] }) {
    const key = construirKeyReporteTopFacturas(params.codigoEstacion, params.semanaInicio);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify({ codigoEstacion: params.codigoEstacion, semanaInicio: params.semanaInicio, top: params.top }),
        ContentType: 'application/json',
      })
    );

    return { key };
  }
}
