// domain/value-objects/RangoFechas.ts
//
// Valida el rango opcional `fechaDesde`/`fechaHasta` (sección 11, parámetros
// `FechaDesde`/`FechaHasta` reutilizados también por `/reportes/margen`) —
// formato `date` (YYYY-MM-DD) y, si vienen ambas, que el rango no esté
// invertido. No fija un rango por defecto: si el cliente no manda fechas, el
// reporte de margen se calcula sobre todo el histórico (decisión propia, no
// especificada explícitamente en el contrato — ver changelog de esta
// versión). `/reportes/abastecimiento` no usa este value object: su ventana
// de 30 días está fija en el SQL de la sección 3.8.2.c, no es un parámetro.

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export interface RangoFechas {
  readonly fechaDesde?: string;
  readonly fechaHasta?: string;
}

export function normalizarRangoFechas(fechaDesde?: string, fechaHasta?: string): RangoFechas {
  if (fechaDesde !== undefined && !FORMATO_FECHA.test(fechaDesde)) {
    throw new ParametrosInvalidosError('Parámetro "fechaDesde" inválido.', [
      { field: 'fechaDesde', issue: 'debe tener formato YYYY-MM-DD' },
    ]);
  }
  if (fechaHasta !== undefined && !FORMATO_FECHA.test(fechaHasta)) {
    throw new ParametrosInvalidosError('Parámetro "fechaHasta" inválido.', [
      { field: 'fechaHasta', issue: 'debe tener formato YYYY-MM-DD' },
    ]);
  }
  // Comparación lexicográfica válida porque el formato es YYYY-MM-DD (ISO 8601).
  if (fechaDesde !== undefined && fechaHasta !== undefined && fechaDesde > fechaHasta) {
    throw new ParametrosInvalidosError('Rango de fechas inválido.', [
      { field: 'fechaDesde', issue: '"fechaDesde" no puede ser posterior a "fechaHasta"' },
    ]);
  }
  return { fechaDesde, fechaHasta };
}
