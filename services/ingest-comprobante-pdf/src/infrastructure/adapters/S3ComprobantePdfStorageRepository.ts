// infrastructure/adapters/S3ComprobantePdfStorageRepository.ts
//
// Calco de S3DocumentoStorage.ts (consulta-reportes), sin getSignedUrl --
// aca no hace falta devolver URL, solo confirmar que se guardo (la lectura
// es un endpoint distinto, consulta-comprobante, agregado en v1.72).
//
// Convencion de key: `{ruc}/{numeracion}.pdf` -- v1.69, RUC en vez de
// codigoEstacion (ver domain/ComprobantePdfInput.ts): Jorge necesita ubicar
// comprobantes por el criterio combinado ruc-serie-correlativo (el
// identificador estandar SUNAT), y numeracion ya viene como
// "{serie}-{correlativo}" (p. ej. "F001-000123") tal como lo genera
// fuelhub-facturador -- asi que este prefijo por si solo ES ese criterio
// combinado. Deja el terreno listo para XML/CDR (pendiente, fuera de
// alcance de esta entrada, a pedido explicito de Jorge de dejarlo
// pendiente): `{ruc}/{numeracion}.xml` y `{ruc}/{numeracion}-cdr.xml` van a
// caer bajo el mismo prefijo cuando se implementen -- consulta-comprobante
// (v1.72) ya los busca de forma oportunista aunque todavia no existan.
//
// v1.72: la metadata opcional (ver ComprobantePdfInput.ts) se adjunta como
// S3 object metadata -- claves en kebab-case (limite de S3: solo ASCII,
// sin mayusculas garantizadas de vuelta en todos los SDKs/consolas).

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ComprobanteMetadata } from '../../domain/ComprobantePdfInput';
import type { ComprobantePdfStorageRepository } from '../../application/ports/ComprobantePdfStorageRepository';

export class S3ComprobantePdfStorageRepository implements ComprobantePdfStorageRepository {
  constructor(private readonly client: S3Client, private readonly bucketName: string) {}

  async guardar(params: { ruc: string; numeracion: string; buffer: Buffer; metadata: ComprobanteMetadata }) {
    const key = `${params.ruc}/${params.numeracion}.pdf`;

    const s3Metadata: Record<string, string> = {};
    if (params.metadata.fechaEmision !== undefined) s3Metadata['fecha-emision'] = params.metadata.fechaEmision;
    if (params.metadata.importeTotal !== undefined) s3Metadata['importe-total'] = String(params.metadata.importeTotal);
    if (params.metadata.moneda !== undefined) s3Metadata['moneda'] = params.metadata.moneda;
    if (params.metadata.estadoSunat !== undefined) s3Metadata['estado-sunat'] = params.metadata.estadoSunat;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: params.buffer,
        ContentType: 'application/pdf',
        ...(Object.keys(s3Metadata).length > 0 ? { Metadata: s3Metadata } : {}),
      })
    );
    return { key };
  }
}
