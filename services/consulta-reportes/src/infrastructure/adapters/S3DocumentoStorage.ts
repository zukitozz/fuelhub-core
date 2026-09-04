// infrastructure/adapters/S3DocumentoStorage.ts
//
// Implementa DocumentoStoragePort (v1.60) para GET /v1/reportes/dia/documento
// -- sube el PDF ya renderizado a S3 y devuelve una URL PRESIGNADA de solo
// lectura. El bucket NO es público (ver infra/lib/stacks/api-stack.ts,
// BlockPublicAccess.BLOCK_ALL): la URL firmada es exactamente lo que el
// contrato con notificaciones-whatsapp pide ("descargable sin autenticación
// adicional") sin tener que exponer el bucket entero al público.

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { DocumentoStoragePort, DocumentoSubidoDTO } from '../../application/ports/ReporteDiaDocumentoPorts';

export class S3DocumentoStorage implements DocumentoStoragePort {
  constructor(private readonly client: S3Client, private readonly bucketName: string) {}

  async subirYFirmar(params: {
    readonly buffer: Buffer;
    readonly key: string;
    readonly contentType: string;
    readonly expiraEnSegundos: number;
  }): Promise<DocumentoSubidoDTO> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: params.key,
        Body: params.buffer,
        ContentType: params.contentType,
      })
    );

    const url = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketName, Key: params.key }), {
      expiresIn: params.expiraEnSegundos,
    });

    return { url, expiraEn: params.expiraEnSegundos };
  }
}
