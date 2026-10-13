// domain/ReporteTopFacturasKey.ts
//
// Key ESTABLE (no timestamped) de S3 para el JSON del reporte top-facturas --
// misma estrategia que DocumentoReporteKey.ts (consulta-reportes): PUT a una
// key fija derivada de codigoEstacion+semanaInicio, nunca Date.now(), para
// que reintentar el mismo reporte de la misma semana pise el mismo objeto en
// vez de acumular basura. Vive en este servicio (no en consulta-reportes)
// porque quien la construye es quien la ESCRIBE (ingest-reporte-top-facturas),
// no quien la lee -- a diferencia de dia/turno/compras-semanal, hoy no existe
// un Lambda de lectura para este reporte (ver nota en RegistrarReporteTopFacturas.ts).

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';

const PREFIJO = 'top-facturas';
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function construirKeyReporteTopFacturas(codigoEstacion: string, semanaInicio: string): string {
  if (!FORMATO_FECHA.test(semanaInicio)) {
    // Defensivo -- en el unico caller (RegistrarReporteTopFacturas.ts) semanaInicio
    // ya paso por validarReporteTopFacturas antes de llegar aca.
    throw new ParametrosInvalidosError('"semanaInicio" invalido al construir la key del documento.', [
      { field: 'semanaInicio', issue: 'debe tener formato YYYY-MM-DD' },
    ]);
  }
  return `${PREFIJO}/reporte_top_facturas_${codigoEstacion}_${semanaInicio}.json`;
}
