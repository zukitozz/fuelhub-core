// RangoFechas.test.ts (v1.58)
//
// Este Lambda no traía tests de dominio hasta ahora (solo integración contra
// Aurora real, ver los `.integration.test.ts` de `infrastructure/adapters`)
// — se agrega este archivo puntualmente para `normalizarFechaNegocio`
// (nueva, `GET /v1/reportes/dia`) porque a diferencia de
// `normalizarRangoFechas` (fechas siempre opcionales) esta sí tiene una
// rama de error nueva y no trivial: el parámetro es OBLIGATORIO.

import { normalizarFechaNegocio, normalizarRangoFechas } from './RangoFechas';
import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';

describe('normalizarFechaNegocio', () => {
  it('acepta una fecha válida y la devuelve tal cual', () => {
    expect(normalizarFechaNegocio('2026-08-22')).toBe('2026-08-22');
  });

  it('rechaza cuando falta el parámetro', () => {
    expect(() => normalizarFechaNegocio(undefined)).toThrow(ParametrosInvalidosError);
  });

  it('rechaza un formato inválido', () => {
    expect(() => normalizarFechaNegocio('22-08-2026')).toThrow(ParametrosInvalidosError);
  });
});

describe('normalizarRangoFechas (regresión — sin cambios de comportamiento)', () => {
  it('sigue aceptando ambas fechas ausentes', () => {
    expect(normalizarRangoFechas(undefined, undefined)).toEqual({ fechaDesde: undefined, fechaHasta: undefined });
  });

  it('sigue rechazando un rango invertido', () => {
    expect(() => normalizarRangoFechas('2026-08-31', '2026-08-01')).toThrow(ParametrosInvalidosError);
  });
});
