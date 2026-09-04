// PostgresCierreTurnoQueryRepository.integration.test.ts (v1.60)
//
// Smoke test, no de negocio (mismo criterio que los suites de
// consulta-reportes) — confirma que el SQL es válido contra el esquema real,
// no hace ninguna aserción sobre qué cierres concretos existen en `dev`.
//
// Existe específicamente para atrapar el bug real encontrado en vivo (no en
// CI) el 2026-09-03: GET /cierres-turno con fechaDesde/fechaHasta reales vía
// Postman contra la estación SMOKETEST devolvía
// "DatabaseErrorException: operator does not exist: date >= text" —
// `ct.fecha_negocio >= :fechaDesde` sin CAST (RDS Data API manda el
// parámetro sin tipo explícito). `consulta-cierres` no tenía NINGÚN
// test:integration hasta esta entrada, así que ese camino nunca se había
// ejercitado con un valor real. Mismo hallazgo, mismo día, corregido también
// en PostgresCierreDiaQueryRepository y PostgresReporteMargenQueryRepository.

import { PostgresCierreTurnoQueryRepository } from './PostgresCierreTurnoQueryRepository';
import { cliente, config, primeraEstacionSembrada } from '@fuelhub/test-integration-support';

describe('PostgresCierreTurnoQueryRepository (integración real, sin mocks)', () => {
  it('corre sin filtros de fecha y devuelve un resultado paginado (SQL válido)', async () => {
    const repo = new PostgresCierreTurnoQueryRepository(cliente(), config());

    const resultado = await repo.listar({ estado: 'ACTIVO' }, { page: 1, pageSize: 20 });

    expect(Array.isArray(resultado.data)).toBe(true);
    expect(resultado.pagination.page).toBe(1);
  }, 30_000);

  it('corre con fechaDesde/fechaHasta reales, filtrado por estación (regresión del bug de CAST)', async () => {
    const estacion = await primeraEstacionSembrada();
    const repo = new PostgresCierreTurnoQueryRepository(cliente(), config());

    // Rango deliberadamente amplio (2000-2099): lo único que este test
    // confirma es que el SQL corre con fechaDesde/fechaHasta reales sin
    // reventar — no depende de qué cierres de turno existan sembrados hoy.
    const resultado = await repo.listar(
      { estado: 'ACTIVO', estacionCodigo: estacion.codigo, fechaDesde: '2000-01-01', fechaHasta: '2099-12-31' },
      { page: 1, pageSize: 20 }
    );

    expect(Array.isArray(resultado.data)).toBe(true);
    expect(resultado.data.every((c) => c.codigoEstacion === estacion.codigo)).toBe(true);
  }, 30_000);
});
