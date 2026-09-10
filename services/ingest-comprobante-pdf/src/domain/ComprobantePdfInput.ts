// domain/ComprobantePdfInput.ts
//
// Sin dependencias de AWS -- validación puramente estructural del payload de
// `PUT /v1/comprobantes/{numeracion}/pdf` (spec pegado por Jorge). Valida Y
// decodifica el base64 en un solo paso (evita decodificar dos veces en el
// caso de uso).
//
// v1.69: se agrega `ruc` al contrato del spec original -- Jorge pidió
// explícitamente poder ubicar comprobantes por el criterio combinado
// "ruc-serie-correlativo" (el identificador estándar SUNAT de un
// comprobante electrónico), y el spec pegado no traía `ruc` en ningún lado
// (solo `codigoEstacion`, que es un identificador interno de FuelHub, no
// necesariamente 1:1 con el RUC del emisor). Se agrega como campo requerido
// del payload -- `fuelhub-facturador` ya lo conoce (todo comprobante SUNAT
// lleva el RUC del emisor embebido en su propio XML), así que no hace falta
// ningún lookup nuevo del lado del daemon. La key de S3 pasa a construirse
// con `ruc`, no con `codigoEstacion` (ver
// S3ComprobantePdfStorageRepository.ts) -- `codigoEstacion` se sigue
// exigiendo y validando igual, pero solo para la autorización por estación
// (sección 5.4), nunca para la key de storage.
//
// v1.69: también se corrige `MAX_PDF_BYTES` -- el spec pegado proponía 8 MB
// "bien por debajo" del límite duro de 10 MB de API Gateway REST, pero un
// PDF de 8 MB codificado en base64 pesa 8 * 4/3 ≈ 10.67 MB, que YA SUPERA
// ese límite (antes de sumar el overhead del JSON envolvente) -- tal cual el
// spec lo planteaba, el request se habría rechazado con 413 apenas alguien
// subiera algo cerca del límite anunciado. Se baja a 7 MB decodificados
// (≈9.33 MB en base64, con margen de sobra para el resto del JSON) --
// de cualquier forma, muy por encima de los <200 KB típicos de un
// comprobante impreso en térmica de 80mm (ver spec, sección 2).

import { ParametrosInvalidosError, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface ComprobantePdfInput {
  readonly codigoEstacion: string;
  readonly ruc: string;
  readonly contentBase64: string;
}

export const MAX_PDF_BYTES = 7 * 1024 * 1024; // 7 MB decodificados -- ver nota de cabecera sobre el límite de API Gateway

const RUC_REGEX = /^\d{11}$/;

/**
 * Valida estructuralmente el input Y decodifica el base64, devolviendo el
 * Buffer ya validado (evita decodificar dos veces en el caso de uso).
 * Lanza ParametrosInvalidosError (mismo shape que el resto del proyecto).
 */
export function validarYDecodificarComprobantePdf(
  input: ComprobantePdfInput,
  numeracion: string | undefined
): Buffer {
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
    errores.push({ field: 'ruc', issue: 'debe tener 11 dígitos (RUC SUNAT)' });
  }
  if (!input.contentBase64?.trim()) {
    errores.push({ field: 'contentBase64', issue: 'requerido' });
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El payload no pasó la validación.', errores);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.contentBase64, 'base64');
  } catch {
    throw new ParametrosInvalidosError('contentBase64 no es base64 válido.', [
      { field: 'contentBase64', issue: 'base64 malformado' },
    ]);
  }

  if (buffer.length === 0) {
    throw new ParametrosInvalidosError('El PDF decodificado está vacío.', [
      { field: 'contentBase64', issue: 'vacío tras decodificar' },
    ]);
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new ParametrosInvalidosError(`El PDF supera el máximo de ${MAX_PDF_BYTES} bytes.`, [
      { field: 'contentBase64', issue: `${buffer.length} bytes, máximo ${MAX_PDF_BYTES}` },
    ]);
  }
  // Firma mínima de un PDF válido -- no es un parser completo, solo evita
  // subir basura arbitraria a S3 bajo pretexto de "PDF".
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ParametrosInvalidosError('El contenido no es un PDF válido.', [
      { field: 'contentBase64', issue: 'no empieza con la firma %PDF-' },
    ]);
  }

  return buffer;
}
