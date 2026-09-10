// infrastructure/adapters/S3ComprobanteLecturaRepository.ts
//
// Contraparte de lectura de S3ComprobantePdfStorageRepository.ts -- misma
// convencion de key ({ruc}/{numeracion}.pdf/.xml/-cdr.xml). El PDF es
// obligatorio (si no existe, no hay comprobante que mostrar); XML/CDR se
// buscan de forma oportunista -- v1.72, pendiente de que
// fuelhub-facturador (fuera de alcance en este repo/sesion) empiece a
// subirlos -- asi el contrato de este endpoint ya queda listo sin tener que
// cambiarlo de nuevo el dia que existan.

import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ComprobanteEncontradoDTO,
  ComprobanteLecturaRepository,
  ComprobanteMetadataDTO,
} from '../../application/ports/ComprobanteLecturaRepository';

const EXPIRA_EN_SEGUNDOS = 300; // 5 min -- alcanza para que el navegador abra/descargue sin dejar la URL firmada viva de mas

function esNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

export class S3ComprobanteLecturaRepository implements ComprobanteLecturaRepository {
  constructor(private readonly client: S3Client, private readonly bucketName: string) {}

  async buscar(params: { ruc: string; numeracion: string }): Promise<ComprobanteEncontradoDTO | null> {
    const keyPdf = `${params.ruc}/${params.numeracion}.pdf`;

    let head;
    try {
      head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: keyPdf }));
    } catch (err) {
      if (esNotFound(err)) return null;
      throw err;
    }

    const metadata = this.leerMetadata(head.Metadata);

    const [urlPdf, urlXml, urlCdr] = await Promise.all([
      getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketName, Key: keyPdf }), {
        expiresIn: EXPIRA_EN_SEGUNDOS,
      }),
      this.firmarSiExiste(`${params.ruc}/${params.numeracion}.xml`),
      this.firmarSiExiste(`${params.ruc}/${params.numeracion}-cdr.xml`),
    ]);

    return { urlPdf, urlXml, urlCdr, expiraEnSegundos: EXPIRA_EN_SEGUNDOS, metadata };
  }

  private leerMetadata(raw: Record<string, string> | undefined): ComprobanteMetadataDTO {
    if (!raw) return {};
    const importeTotalTexto = raw['importe-total'];
    const importeTotal = importeTotalTexto !== undefined ? Number(importeTotalTexto) : undefined;
    return {
      fechaEmision: raw['fecha-emision'],
      importeTotal: importeTotal !== undefined && Number.isFinite(importeTotal) ? importeTotal : undefined,
      moneda: raw['moneda'],
      estadoSunat: raw['estado-sunat'],
    };
  }

  private async firmarSiExiste(key: string): Promise<string | undefined> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
    } catch (err) {
      if (esNotFound(err)) return undefined;
      throw err;
    }
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketName, Key: key }), {
      expiresIn: EXPIRA_EN_SEGUNDOS,
    });
  }
}
