// PostgresReporteMargenQueryRepository.integration.test.ts (sección 7/12.6)
//
// Smoke test, no de negocio: el reporte de margen (3.8.2.b) agrega
// `compras`+`cierres_turno_detalle` con un SQL no trivial (CTEs, LEFT JOIN
// condicional) — lo que este test confirma es que esa consulta es SQL
// válido contra el esquema real y no revienta, con y sin filtro de
// estación. No hace ninguna aserción de negocio sobre los números (no hay
// suficiente data de compras real garantizada en `dev` para que un valor
// concreto tenga sentido) — esa responsabilidad es de un test de dominio
// contra datos controlados, no de este suite.

import { PostgresReporteMargenQueryRepository } from './PostgresReporteMargenQueryRepository';
import { cliente, config, primeraEstacionSembrada } from '@fuelhub/test-integration-support';

describe('PostgresReporteMargenQueryRepository (integración real, sin mocks)', () => {
  it('corre sin filtros y devuelve un array (SQL válido contra el esquema real)', async () => {
    const repo = new PostgresReporteMargenQueryRepository(cliente(), config());
    const resultado = await repo.obtener({});
    expect(Array.isArray(resultado)).toBe(true);
  }, 30_000);

  it('corre filtrado por una estación real sembrada', async () => {
    const estacion = await primeraEstacionSembrada();
    const repo = new PostgresReporteMargenQueryRepository(cliente(), config());
    const resultado = await repo.obtener({ estacionCodigo: estacion.codigo });
    expect(Array.isArray(resultado)).toBe(true);
    expect(resultado.every((r) => r.estacion === estacion.codigo)).toBe(true);
  }, 30_000);
});
