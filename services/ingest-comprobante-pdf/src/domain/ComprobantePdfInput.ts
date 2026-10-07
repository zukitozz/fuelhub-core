// domain/ComprobantePdfInput.ts
//
// Sin dependencias de AWS -- validacion puramente estructural del payload de
// PUT /v1/comprobantes/{numeracion}/pdf (spec pegado por Jorge). Valida Y
// decodifica el base64 en un solo paso (evita decodificar dos veces en el
// caso de uso).
//
// v1.69: se agrega ruc al contrato del spec original -- Jorge pidio
// explicitamente poder ubicar comprobantes por el criterio combinado
// "ruc-serie-correlativo" (el identificador estandar SUNAT de un
// comprobante electronico), y el spec pegado no traia ruc en ningun lado
// (solo codigoEstacion, que es un identificador interno de FuelHub, no
// necesariamente 1:1 con el RUC del emisor). Se agrega como campo requerido
// del payload -- fuelhub-facturador ya lo conoce (todo comprobante SUNAT
// lleva el RUC del emisor embebido en su propio XML), asi que no hace falta
// ningun lookup nuevo del lado del daemon. La key de S3 pasa a construirse
// con ruc, no con codigoEstacion (ver S3ComprobantePdfStorageRepository.ts)
// -- codigoEstacion se sigue exigiendo y validando igual, pero solo para la
// autorizacion por estacion (seccion 5.4), nunca para la key de storage.
//
// v1.69: tambien se corrige MAX_PDF_BYTES -- el spec pegado proponia 8 MB
// "bien por debajo" del limite duro de 10 MB de API Gateway REST, pero un
// PDF de 8 MB codificado en base64 pesa 8 * 4/3 ~ 10.67 MB, que YA SUPERA
// ese limite (antes de sumar el overhead del JSON envolvente). Se baja a
// 7 MB decodificados (~9.33 MB en base64, con margen de sobra).
//
// v1.72, a pedido de Jorge (para que el nuevo proyecto fuelhub-comprobantes
// pueda mostrar mas que solo el PDF): se agregan 4 campos -- en ese momento
// TODOS opcionales -- fechaEmision/importeTotal/moneda/estadoSunat.
// `importeTotal`/`moneda`/`estadoSunat` se guardan como S3 object metadata
// (ver S3ComprobantePdfStorageRepository.ts), nunca en Postgres.
//
// v1.79 -- hallazgo real de Jorge (necesidad de descarga masiva de
// comprobantes por RUC emisor + documento del receptor + periodo, sin
// agregar una tabla Postgres nueva que sincronizar con S3): la key de S3
// pasa de `{ruc}/{numeracion}.pdf` a
// `{ruc}/{numeroDocumentoReceptor}/{yyyy}/{mm}/{dd}/{numeracion}.pdf` (ver
// S3ComprobantePdfStorageRepository.ts) -- un listado masivo por
// emisor+receptor+año(+mes) es entonces un simple `ListObjectsV2` por
// prefijo, sin HeadObject por archivo y sin índice aparte. Esto exige dos
// cambios de contrato:
//   - `numeroDocumentoReceptor` pasa a ser un campo REQUERIDO nuevo (antes
//     no existía en el payload en absoluto) -- confirmado con Jorge que
//     `fuelhub-facturador` ya lo puede sacar del XML del comprobante, igual
//     que el RUC emisor.
//   - `fechaEmision` pasa de OPCIONAL a REQUERIDO -- sin ella no se puede
//     construir la key en absoluto (antes solo afectaba qué se mostraba en
//     consulta-comprobante, ahora es estructural).
// Comprobantes subidos ANTES de v1.79 quedan bajo la key vieja
// (`{ruc}/{numeracion}.pdf`, sin receptor ni fecha en la key) -- siguen
// siendo accesibles SOLO por el lookup individual viejo
// (`GET /comprobantes/{numeracion}?ruc=...`, sin cambios), nunca aparecen
// en los listados masivos nuevos. Decisión explícita de Jorge: no se hace
// backfill (no hay forma confiable de recuperar el receptor de un PDF ya
// subido sin volver a leer su XML original, que este repo no guarda).

import { ParametrosInvalidosError, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface ComprobantePdfInput {
  readonly codigoEstacion: string;
  readonly ruc: string;
  /** RUC/DNI/etc. del receptor del comprobante -- requerido desde v1.79, ver nota de cabecera. */
  readonly numeroDocumentoReceptor: string;
  readonly contentBase64: string;
  /** YYYY-MM-DD -- requerido desde v1.79 (antes opcional), ver nota de cabecera. */
  readonly fechaEmision: string;
  readonly importeTotal?: number;
  readonly moneda?: string;
  readonly estadoSunat?: string;
}

/** Metadata opcional del comprobante (solo lo que se adjunta como S3 object metadata, v1.72). */
export interface ComprobanteMetadata {
  readonly fechaEmision: string;
  readonly importeTotal?: number;
  readonly moneda?: string;
  readonly estadoSunat?: string;
}

export interface ComprobantePdfValidado {
  readonly buffer: Buffer;
  /** Campos estructurales de la key de S3 (v1.79) -- ver nota de cabecera. */
  readonly ruc: string;
  readonly numeroDocumentoReceptor: string;
  readonly fechaEmision: string;
  readonly metadata: ComprobanteMetadata;
}

export const MAX_PDF_BYTES = 7 * 1024 * 1024; // 7 MB decodificados -- ver nota de cabecera sobre el limite de API Gateway

const RUC_REGEX = /^\d{11}$/;
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONEDAS_VALIDAS = new Set(['PEN', 'USD']);

/**
 * Valida estructuralmente el input Y decodifica el base64, devolviendo el
 * Buffer ya validado junto con la metadata opcional normalizada (evita
 * decodificar dos veces en el caso de uso). Lanza ParametrosInvalidosError
 * (mismo shape que el resto del proyecto).
 */
export function validarYDecodificarComprobantePdf(
  input: ComprobantePdfInput,
  numeracion: string | undefined
): ComprobantePdfValidado {
  const errores: DetalleValidacion[] = [];

  if (!numeracion?.trim()) {
    errores.push({ field: 'numeracion', issue: 'requerido en el path' });
  }
  if (!input.codigoEstacion?.trim()) {
    errores.push({ field: 'codigoEstacion', issue: 'requerido' });
  }
  if (!input.ruc?.trim()) {
    errores.push({ field: 'ruc', issue: 'requerido' });
  } else if (!RUC_REGEX.test(input.ruc.trim())) {
    errores.push({ field: 'ruc', issue: 'debe tener 11 digitos (RUC SUNAT)' });
  }
  // v1.79: requerido -- estructural para la key de S3, ver nota de cabecera.
  if (!input.numeroDocumentoReceptor?.trim()) {
    errores.push({ field: 'numeroDocumentoReceptor', issue: 'requerido' });
  }
  if (!input.contentBase64?.trim()) {
    errores.push({ field: 'contentBase64', issue: 'requerido' });
  }

  // v1.79: fechaEmision pasa de opcional a requerido -- misma razon
  // (estructural para la key de S3, ver nota de cabecera).
  let fechaEmision: string | undefined;
  if (!input.fechaEmision?.trim()) {
    errores.push({ field: 'fechaEmision', issue: 'requerido' });
  } else {
    const valor = input.fechaEmision.trim();
    if (!FECHA_REGEX.test(valor)) {
      errores.push({ field: 'fechaEmision', issue: 'debe tener formato YYYY-MM-DD' });
    } else {
      fechaEmision = valor;
    }
  }

  let importeTotal: number | undefined;
  if (input.importeTotal !== undefined && input.importeTotal !== null) {
    if (typeof input.importeTotal !== 'number' || !Number.isFinite(input.importeTotal) || input.importeTotal < 0) {
      errores.push({ field: 'importeTotal', issue: 'debe ser un numero >= 0' });
    } else {
      importeTotal = input.importeTotal;
    }
  }

  let moneda: string | undefined;
  if (input.moneda !== undefined && input.moneda !== null) {
    const valor = String(input.moneda).trim().toUpperCase();
    if (!MONEDAS_VALIDAS.has(valor)) {
      errores.push({ field: 'moneda', issue: 'debe ser PEN o USD' });
    } else {
      moneda = valor;
    }
  }

  let estadoSunat: string | undefined;
  if (input.estadoSunat !== undefined && input.estadoSunat !== null) {
    const valor = String(input.estadoSunat).trim();
    if (valor.length === 0) {
      errores.push({ field: 'estadoSunat', issue: 'no puede ser una cadena vacia si se envia' });
    } else {
      estadoSunat = valor;
    }
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El payload no paso la validacion.', errores);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.contentBase64, 'base64');
  } catch {
    throw new ParametrosInvalidosError('contentBase64 no es base64 valido.', [
      { field: 'contentBase64', issue: 'base64 malformado' },
    ]);
  }

  if (buffer.length === 0) {
    throw new ParametrosInvalidosError('El PDF decodificado esta vacio.', [
      { field: 'contentBase64', issue: 'vacio tras decodificar' },
    ]);
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new ParametrosInvalidosError(`El PDF supera el maximo de ${MAX_PDF_BYTES} bytes.`, [
      { field: 'contentBase64', issue: `${buffer.length} bytes, maximo ${MAX_PDF_BYTES}` },
    ]);
  }
  // Firma minima de un PDF valido -- no es un parser completo, solo evita
  // subir basura arbitraria a S3 bajo pretexto de "PDF".
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ParametrosInvalidosError('El contenido no es un PDF valido.', [
      { field: 'contentBase64', issue: 'no empieza con la firma %PDF-' },
    ]);
  }

  return {
    buffer,
    ruc: input.ruc.trim(),
    numeroDocumentoReceptor: input.numeroDocumentoReceptor.trim(),
    fechaEmision: fechaEmision!,
    metadata: { fechaEmision: fechaEmision!, importeTotal, moneda, estadoSunat },
  };
}
