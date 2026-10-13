// packages/shared-kernel/src/reporte-top-facturas-key.ts
//
// Keys ESTABLES (no timestamped) de S3 para el reporte top-facturas (v1.89):
// JSON crudo (detalle completo) + Excel (documento descargable) bajo el
// mismo prefijo, mismo nombre base, derivados de codigoEstacion+semanaInicio.
//
// Viven en shared-kernel (no en un solo servicio) porque quien ESCRIBE
// (ingest-reporte-top-facturas) y quien LEE (consulta-reportes,
// GET /reportes/top-facturas/documento) son microservicios distintos,
// desplegados y bundleados por separado -- a diferencia de dia/turno/
// compras-semanal, donde generación y lectura viven en el mismo servicio
// (consulta-reportes) y la key puede ser un módulo de dominio local. Si esta
// convención de nombres cambia, hay un solo lugar que actualizar para que
// ambos servicios sigan de acuerdo.

import { ParametrosInvalidosError } from './errors';

const PREFIJO = 'top-facturas';
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function validarSemanaInicio(semanaInicio: string): string {
  if (!FORMATO_FECHA.test(semanaInicio)) {
    throw new ParametrosInvalidosError('"semanaInicio" inválido al construir la key del documento.', [
      { field: 'semanaInicio', issue: 'debe tener formato YYYY-MM-DD' },
    ]);
  }
  return semanaInicio;
}

export function construirKeyReporteTopFacturasJson(codigoEstacion: string, semanaInicio: string): string {
  return `${PREFIJO}/reporte_top_facturas_${codigoEstacion}_${validarSemanaInicio(semanaInicio)}.json`;
}

export function construirKeyReporteTopFacturasExcel(codigoEstacion: string, semanaInicio: string): string {
  return `${PREFIJO}/reporte_top_facturas_${codigoEstacion}_${validarSemanaInicio(semanaInicio)}.xlsx`;
}
