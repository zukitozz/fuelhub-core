// PostgresReporteDiaQueryRepository.integration.test.ts (v1.58)
//
// Mismo criterio que los otros dos suites de integración de este Lambda:
// smoke test de que el SQL es válido contra el esquema real, no aserción de
// negocio sobre valores concretos (no hay garantía de qué cierres de día
// existen sembrados en `dev` al momento de correr esto).

import { PostgresReporteDiaQueryRepository } from './PostgresReporteDiaQueryRepository';
import { cliente, config, primeraEstacionSembrada } from '@fuelhub/test-integration-support';

describe('PostgresReporteDiaQueryRepository (integración real, sin mocks)', () => {
  it('devuelve null cuando no hay cierre de día para esa estación/fecha (SQL válido, sin reventar)', async () => {
    const estacion = await primeraEstacionSembrada();
    const repo = new PostgresReporteDiaQueryRepository(cliente(), config());

    // Fecha deliberadamente absurda (año 2000) para no depender de si hay o
    // no un cierre de día real sembrado en `dev` — lo único que este test
    // confirma es que el SQL corre y el "no encontrado" se modela como
    // `null`, no como excepción.
    const resultado = await repo.obtener({ estacionCodigo: estacion.codigo, fechaNegocio: '2000-01-01' });

    expect(resultado).toBeNull();
  }, 30_000);
});
