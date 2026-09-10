// infrastructure/adapters/S3ComprobantePdfStorageRepository.ts
//
// Calco de S3DocumentoStorage.ts (consulta-reportes), sin getSignedUrl --
// acá no hace falta devolver URL, solo confirmar que se guardó (la lectura
// es un endpoint distinto, fuera de alcance, ver spec sección 7).
//
// Convención de key: `{ruc}/{numeracion}.pdf` -- v1.69, RUC en vez de
// codigoEstacion (ver domain/ComprobantePdfInput.ts): Jorge necesita ubicar
// comprobantes por el criterio combinado ruc-serie-correlativo (el
// identificador estándar SUNAT), y `numeracion` ya viene como
// "{serie}-{correlativo}" (p. ej. "F001-000123") tal como lo genera
// fuelhub-facturador -- así que este prefijo por sí solo ES ese criterio
// combinado. Deja además el terreno listo para XML/CDR (pendiente, fuera de
// alcance de esta entrada, a pedido explícito de Jorge de dejarlo pendiente):
// `{ruc}/{numeracion}.xml` y `{ruc}/{numeracion}-cdr.xml` van a caer bajo el
// mismo prefijo cuando se implementen, permitiendo un futuro
// `ListObjectsV2` por prefijo `{ruc}/{numeracion}` para traer los 3 archivos
// de un mismo comprobante de una sola vez.

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ComprobantePdfStorageRepository } from '../../application/ports/ComprobantePdfStorageRepository';

export class S3ComprobantePdfStorageRepository implements ComprobantePdfStorageRepository {
  constructor(private readonly client: S3Client, private readonly bucketName: string) {}

  async guardar(params: { ruc: string; numeracion: string; buffer: Buffer }) {
    const key = `${params.ruc}/${params.numeracion}.pdf`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: params.buffer,
        ContentType: 'application/pdf',
      })
    );
    return { key };
  }
}
