// infrastructure/adapters/S3ComprobantePdfStorageRepository.ts
//
// Calco de S3DocumentoStorage.ts (consulta-reportes), sin getSignedUrl --
// aca no hace falta devolver URL, solo confirmar que se guardo (la lectura
// es un endpoint distinto, consulta-comprobante, agregado en v1.72).
//
// Convencion de key HASTA v1.78: `{ruc}/{numeracion}.pdf` -- v1.69, RUC en
// vez de codigoEstacion (ver domain/ComprobantePdfInput.ts). Deja el terreno
// listo para XML/CDR (pendiente, fuera de alcance de esta entrada, a pedido
// explicito de Jorge de dejarlo pendiente): `{ruc}/{numeracion}.xml` y
// `{ruc}/{numeracion}-cdr.xml` van a caer bajo el mismo prefijo cuando se
// implementen -- consulta-comprobante (v1.72) ya los busca de forma
// oportunista aunque todavia no existan.
//
// v1.72: la metadata opcional (ver ComprobantePdfInput.ts) se adjunta como
// S3 object metadata -- claves en kebab-case (limite de S3: solo ASCII,
// sin mayusculas garantizadas de vuelta en todos los SDKs/consolas).
//
// v1.79: la key pasa a `{ruc}/{numeroDocumentoReceptor}/{yyyy}/{mm}/{dd}/{numeracion}.pdf`
// -- ver la nota de cabecera de ComprobantePdfInput.ts para el porque
// (listado masivo por emisor+receptor+periodo via ListObjectsV2 por
// prefijo, sin tabla Postgres nueva). Comprobantes subidos ANTES de esta
// version quedan bajo la key vieja -- esta clase, desde ahora, solo escribe
// bajo la key nueva; la key vieja sigue siendo LEIDA por
// S3ComprobanteLecturaRepository.ts (consulta-comprobante) sin cambios.
//
// v1.89: si el payload trae xmlBuffer/cdrBuffer (ver ComprobantePdfInput.ts),
// se suben bajo el mismo prefijo que el PDF, mismo nombre base, cambiando
// solo la extension -- `{...}/{numeracion}.xml` y `{...}/{numeracion}-cdr.xml`.
// Los 3 PutObject corren en paralelo (Promise.all): no hay dependencia de
// orden entre ellos, y ya habia precedente de hacerlo asi en
// S3ComprobantePeriodoLecturaRepository.ts (GetObject en paralelo al armar
// el zip). Si uno falla, el `Promise.all` rechaza y el handler responde
// error -- no hay escritura parcial "silenciosa" que deje PDF sin su XML.

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ComprobanteMetadata } from '../../domain/ComprobantePdfInput';
import type { ComprobantePdfStorageRepository } from '../../application/ports/ComprobantePdfStorageRepository';

export class S3ComprobantePdfStorageRepository implements ComprobantePdfStorageRepository {
  constructor(private readonly client: S3Client, private readonly bucketName: string) {}

  async guardar(params: {
    ruc: string;
    numeroDocumentoReceptor: string;
    fechaEmision: string;
    numeracion: string;
    buffer: Buffer;
    metadata: ComprobanteMetadata;
    xmlBuffer?: Buffer;
    cdrBuffer?: Buffer;
  }) {
    const [anio, mes, dia] = params.fechaEmision.split('-');
    const prefijo = `${params.ruc}/${params.numeroDocumentoReceptor}/${anio}/${mes}/${dia}/${params.numeracion}`;
    const key = `${prefijo}.pdf`;
    const keyXml = params.xmlBuffer ? `${prefijo}.xml` : undefined;
    const keyCdr = params.cdrBuffer ? `${prefijo}-cdr.xml` : undefined;

    const s3Metadata: Record<string, string> = {};
    if (params.metadata.fechaEmision !== undefined) s3Metadata['fecha-emision'] = params.metadata.fechaEmision;
    if (params.metadata.importeTotal !== undefined) s3Metadata['importe-total'] = String(params.metadata.importeTotal);
    if (params.metadata.moneda !== undefined) s3Metadata['moneda'] = params.metadata.moneda;
    if (params.metadata.estadoSunat !== undefined) s3Metadata['estado-sunat'] = params.metadata.estadoSunat;

    await Promise.all([
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: params.buffer,
          ContentType: 'application/pdf',
          ...(Object.keys(s3Metadata).length > 0 ? { Metadata: s3Metadata } : {}),
        })
      ),
      keyXml
        ? this.client.send(
            new PutObjectCommand({ Bucket: this.bucketName, Key: keyXml, Body: params.xmlBuffer, ContentType: 'application/xml' })
          )
        : Promise.resolve(),
      keyCdr
        ? this.client.send(
            new PutObjectCommand({ Bucket: this.bucketName, Key: keyCdr, Body: params.cdrBuffer, ContentType: 'application/xml' })
          )
        : Promise.resolve(),
    ]);

    return { key, keyXml, keyCdr };
  }
}
