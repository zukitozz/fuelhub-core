// infrastructure/adapters/S3ComprobantePeriodoLecturaRepository.ts
//
// v1.79 -- lee contra la key nueva {ruc}/{numeroDocumentoReceptor}/{yyyy}/{mm}/{dd}/{numeracion}.pdf
// (ver S3ComprobantePdfStorageRepository.ts en ingest-comprobante-pdf).
//
// Decisiones de esta entrada (discutidas con Jorge, "opcion mas economica"
// -- sin job asincrono/DynamoDB, API Gateway REST tiene un limite DURO de
// 29s de integracion que no se puede subir):
//
//   1. `anio`+`mes` siempre requeridos (ver dominio) -- acota el tamano
//      maximo de cualquier zip a como mucho un mes, nunca un anio completo.
//   2. Ademas de eso, un tope duro (`MAX_COMPROBANTES_ZIP`) sobre la
//      CANTIDAD de objetos que matchean el prefijo del mes -- si lo supera,
//      se rechaza con 400 pidiendo acotar por dia (via el lookup
//      individual) en vez de intentar armar un zip que casi seguro no
//      entra en los 29s. El numero (300) es una ESTIMACION inicial, no un
//      benchmark real contra Lambda -- ajustar con datos reales de
//      CloudWatch (duracion real del Lambda) apenas haya trafico real de
//      un cliente grande.
//   3. El zip se arma 100% en streaming: cada PDF se agrega a `archiver`
//      como el stream que ya devuelve `GetObjectCommand` (nunca se
//      bufferea un PDF completo en memoria), y la subida a S3 usa
//      `@aws-sdk/lib-storage` (`Upload`, multipart) alimentada directo del
//      stream de salida de `archiver` -- tampoco se bufferea el .zip
//      completo en memoria. La memoria del Lambda queda acotada
//      independientemente de cuantos comprobantes tenga el mes (dentro del
//      tope de arriba).
//   4. El .zip generado se sube bajo el prefijo `_zips/` del MISMO bucket
//      de comprobantes (no uno nuevo) -- con una `lifecycleRule` acotada a
//      ese prefijo (ver api-stack.ts) que lo borra solo a los 2 dias: es un
//      archivo generado, no el documento SUNAT original, no hace falta
//      retenerlo indefinidamente como sí RemovalPolicy.RETAIN exige para
//      el resto del bucket.
//   5. Sin cache: cada request arma el zip de nuevo, incluso para el mismo
//      periodo. Para el mes EN CURSO es lo correcto (pueden subirse
//      comprobantes nuevos). Para meses ya cerrados, cachear quedaria bien
//      como optimizacion futura -- no implementado en esta entrada.

import type { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import archiver from 'archiver';
import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import type {
  ComprobanteIndividualResultadoDTO,
  ComprobantePeriodoLecturaRepository,
  ComprobanteZipResultadoDTO,
} from '../../application/ports/ComprobantePeriodoLecturaRepository';

const EXPIRA_EN_SEGUNDOS = 300; // 5 min -- mismo criterio que S3ComprobanteLecturaRepository.ts
const MAX_COMPROBANTES_ZIP = 300; // ver nota de cabecera, punto 2 -- estimacion inicial, no benchmark real

function esNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

export class S3ComprobantePeriodoLecturaRepository implements ComprobantePeriodoLecturaRepository {
  constructor(private readonly client: S3Client, private readonly bucketName: string) {}

  async buscarIndividual(params: {
    rucEmisor: string;
    numeroDocumentoReceptor: string;
    anio: string;
    mes: string;
    dia: string;
    numeracion: string;
  }): Promise<ComprobanteIndividualResultadoDTO | null> {
    const key = this.keyDe(params);

    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
    } catch (err) {
      if (esNotFound(err)) return null;
      throw err;
    }

    const url = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketName, Key: key }), {
      expiresIn: EXPIRA_EN_SEGUNDOS,
    });
    return { url, expiraEnSegundos: EXPIRA_EN_SEGUNDOS };
  }

  async buscarMasivo(params: {
    rucEmisor: string;
    numeroDocumentoReceptor: string;
    anio: string;
    mes: string;
  }): Promise<ComprobanteZipResultadoDTO | null> {
    const prefijo = `${params.rucEmisor}/${params.numeroDocumentoReceptor}/${params.anio}/${params.mes}/`;
    const claves = await this.listarTodasLasClaves(prefijo);

    if (claves.length === 0) return null;

    if (claves.length > MAX_COMPROBANTES_ZIP) {
      throw new ParametrosInvalidosError(
        `El período tiene ${claves.length} comprobantes -- supera el máximo de ${MAX_COMPROBANTES_ZIP} para generar un zip en una sola respuesta.`,
        [{ field: 'mes', issue: 'demasiados comprobantes -- acota la búsqueda por día (dia+serie+correlativo)' }]
      );
    }

    const zipKey = `_zips/${params.rucEmisor}/${params.numeroDocumentoReceptor}/${params.anio}-${params.mes}-${Date.now()}.zip`;
    const cantidad = await this.subirZip(claves, zipKey);

    const url = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketName, Key: zipKey }), {
      expiresIn: EXPIRA_EN_SEGUNDOS,
    });
    return { url, expiraEnSegundos: EXPIRA_EN_SEGUNDOS, cantidad };
  }

  private keyDe(params: { rucEmisor: string; numeroDocumentoReceptor: string; anio: string; mes: string; dia: string; numeracion: string }): string {
    return `${params.rucEmisor}/${params.numeroDocumentoReceptor}/${params.anio}/${params.mes}/${params.dia}/${params.numeracion}.pdf`;
  }

  /** Pagina ListObjectsV2 hasta agotar `ContinuationToken` -- un mes real no debería acercarse a los 1000 objetos por página, pero no se asume. */
  private async listarTodasLasClaves(prefijo: string): Promise<string[]> {
    const claves: string[] = [];
    let continuationToken: string | undefined;

    do {
      const resultado = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucketName, Prefix: prefijo, ContinuationToken: continuationToken })
      );
      for (const obj of resultado.Contents ?? []) {
        if (obj.Key) claves.push(obj.Key);
      }
      continuationToken = resultado.IsTruncated ? resultado.NextContinuationToken : undefined;
    } while (continuationToken);

    return claves;
  }

  /** Arma el .zip 100% en streaming (ver nota de cabecera, punto 3) y lo sube con Upload (multipart). Devuelve cuantos archivos entraron. */
  private async subirZip(claves: readonly string[], zipKey: string): Promise<number> {
    const archivo = archiver('zip', { zlib: { level: 6 } });
    const errorDeArchivo = new Promise<never>((_, reject) => archivo.on('error', reject));

    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucketName, Key: zipKey, Body: archivo, ContentType: 'application/zip' },
    });

    for (const key of claves) {
      const objeto = await this.client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
      const nombreEnZip = key.split('/').pop() ?? key;
      // `Body` de GetObjectCommand en runtime Node.js SIEMPRE es un
      // `Readable` real -- el tipo declarado del SDK es más amplio
      // (`StreamingBlobPayloadOutputTypes`, cubre también Web ReadableStream
      // para runtimes no-Node) porque el mismo paquete se usa en browser.
      // Se agrega directo, nunca se bufferea el PDF completo (ver nota de
      // cabecera).
      archivo.append(objeto.Body as unknown as Readable, { name: nombreEnZip });
    }
    void archivo.finalize();

    await Promise.race([upload.done(), errorDeArchivo]);
    return claves.length;
  }
}
