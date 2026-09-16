// infrastructure/adapters/S3DocumentoStorage.ts
//
// Implementa DocumentoStoragePort (v1.60, dividido en v1.78 -- ver la nota
// grande en ReporteDiaDocumentoPorts.ts). El bucket NO es público (ver
// infra/lib/stacks/api-stack.ts, BlockPublicAccess.BLOCK_ALL): la URL
// firmada es exactamente lo que el contrato con notificaciones-whatsapp pide
// ("descargable sin autenticación adicional") sin tener que exponer el
// bucket entero al público.
//
// v1.78 -- `getSignedUrl` NO verifica que la key exista (solo firma la
// URL; el 404 real recién aparecería cuando alguien intentara descargarla).
// Como ahora el objeto puede legítimamente no existir todavía (el cierre de
// día llegó pero `GenerarReporteDiaDocumento` no terminó, best effort) o no
// haber existido nunca (cierre de día anterior a este cambio, sin
// backfill), `obtenerUrlFirmada` hace un `HeadObjectCommand` primero para
// poder devolver un 404 real desde nuestra propia API en vez de una URL
// firmada que fallaría después, en manos del cliente.

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DocumentoNoEncontradoError, type DocumentoStoragePort, type DocumentoSubidoDTO } from '../../application/ports/ReporteDiaDocumentoPorts';

function esNotFound(err: unknown): boolean {
  const nombre = (err as { name?: string } | undefined)?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata?.httpStatusCode;
  return nombre === 'NotFound' || nombre === 'NoSuchKey' || status === 404;
}

export class S3DocumentoStorage implements DocumentoStoragePort {
  constructor(private readonly client: S3Client, private readonly bucketName: string) {}

  async subir(params: { readonly buffer: Buffer; readonly key: string; readonly contentType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: params.key,
        Body: params.buffer,
        ContentType: params.contentType,
      })
    );
  }

  async obtenerUrlFirmada(params: { readonly key: string; readonly expiraEnSegundos: number }): Promise<DocumentoSubidoDTO> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: params.key }));
    } catch (err) {
      if (esNotFound(err)) {
        throw new DocumentoNoEncontradoError(params.key);
      }
      throw err;
    }

    const url = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketName, Key: params.key }), {
      expiresIn: params.expiraEnSegundos,
    });

    return { url, expiraEn: params.expiraEnSegundos };
  }
}
