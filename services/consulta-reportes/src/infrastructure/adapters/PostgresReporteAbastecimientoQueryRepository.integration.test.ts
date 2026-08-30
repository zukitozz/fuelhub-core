// PostgresReporteAbastecimientoQueryRepository.integration.test.ts
// (sección 7/12.6) — mismo criterio que el smoke test hermano de
// PostgresReporteMargenQueryRepository: confirma que el SQL (3.8.2.c, con el
// cálculo de `enRiesgo` y el filtro `t.activo = true` documentados en la
// cabecera del propio adaptador) es válido contra el esquema real, no una
// aserción de negocio sobre los números.

import { PostgresReporteAbastecimientoQueryRepository } from './PostgresReporteAbastecimientoQueryRepository';
import { cliente, config, primeraEstacionSembrada } from '@fuelhub/test-integration-support';

describe('PostgresReporteAbastecimientoQueryRepository (integración real, sin mocks)', () => {
  it('corre sin filtros y devuelve un array (SQL válido contra el esquema real)', async () => {
    const repo = new PostgresReporteAbastecimientoQueryRepository(cliente(), config());
    const resultado = await repo.obtener({});
    expect(Array.isArray(resultado)).toBe(true);
  }, 30_000);

  it('corre filtrado por una estación real sembrada y solo trae tanques de esa estación', async () => {
    const estacion = await primeraEstacionSembrada();
    const repo = new PostgresReporteAbastecimientoQueryRepository(cliente(), config());
    const resultado = await repo.obtener({ estacionCodigo: estacion.codigo });
    expect(Array.isArray(resultado)).toBe(true);
    expect(resultado.every((r) => r.estacion === estacion.codigo)).toBe(true);
  }, 30_000);
});
