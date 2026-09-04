// PostgresCierreDiaQueryRepository.integration.test.ts (v1.60)
//
// Smoke test, no de negocio — mismo criterio y mismo motivo que
// PostgresCierreTurnoQueryRepository.integration.test.ts (ver esa nota de
// cabecera para el detalle completo del bug real que este suite atrapa):
// `cd.fecha_negocio >= :fechaDesde` / `<= :fechaHasta` sin CAST reventaba
// contra el esquema real apenas se mandaba un valor real, y nada lo probaba
// hasta esta entrada.

import { PostgresCierreDiaQueryRepository } from './PostgresCierreDiaQueryRepository';
import { cliente, config, primeraEstacionSembrada } from '@fuelhub/test-integration-support';

describe('PostgresCierreDiaQueryRepository (integración real, sin mocks)', () => {
  it('corre sin filtros de fecha y devuelve un resultado paginado (SQL válido)', async () => {
    const repo = new PostgresCierreDiaQueryRepository(cliente(), config());

    const resultado = await repo.listar({ estado: 'ACTIVO' }, { page: 1, pageSize: 20 });

    expect(Array.isArray(resultado.data)).toBe(true);
    expect(resultado.pagination.page).toBe(1);
  }, 30_000);

  it('corre con fechaDesde/fechaHasta reales, filtrado por estación (regresión del bug de CAST)', async () => {
    const estacion = await primeraEstacionSembrada();
    const repo = new PostgresCierreDiaQueryRepository(cliente(), config());

    const resultado = await repo.listar(
      { estado: 'ACTIVO', estacionCodigo: estacion.codigo, fechaDesde: '2000-01-01', fechaHasta: '2099-12-31' },
      { page: 1, pageSize: 20 }
    );

    expect(Array.isArray(resultado.data)).toBe(true);
    expect(resultado.data.every((c) => c.codigoEstacion === estacion.codigo)).toBe(true);
  }, 30_000);
});
