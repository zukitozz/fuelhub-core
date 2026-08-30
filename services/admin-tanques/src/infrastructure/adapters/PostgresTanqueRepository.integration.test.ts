// PostgresTanqueRepository.integration.test.ts (sección 7/12.6)
//
// Solo lectura — no inserta ni limpia nada. Confirma que `listar`/
// `obtenerPorId` (con su JOIN contra `estaciones`) devuelven los tanques
// realmente sembrados por `1787936588638_seed-tanques.sql`, sobre datos
// reales de `dev`/`prod` (nunca hardcodea nombres de estación — los resuelve
// vía el helper compartido, mismo criterio que el resto de este suite).

import { PostgresTanqueRepository } from './PostgresTanqueRepository';
import { cliente, config, primeraEstacionSembrada, primerTanqueDeEstacion } from '@fuelhub/test-integration-support';

describe('PostgresTanqueRepository (integración real, sin mocks)', () => {
  it('lista los tanques reales de una estación sembrada y los relee uno por uno', async () => {
    const estacion = await primeraEstacionSembrada();
    const tanqueSemilla = await primerTanqueDeEstacion(estacion.codigo);

    const repo = new PostgresTanqueRepository(cliente(), config());

    const listado = await repo.listar(estacion.codigo);
    expect(listado.length).toBeGreaterThan(0);
    expect(listado.every((t) => t.codigoEstacion === estacion.codigo)).toBe(true);

    const encontrado = listado.find((t) => t.id === tanqueSemilla.id);
    expect(encontrado).toBeDefined();
    expect(encontrado?.nombre).toBe(tanqueSemilla.nombre);

    const porId = await repo.obtenerPorId(tanqueSemilla.id);
    expect(porId?.id).toBe(tanqueSemilla.id);
    expect(porId?.codigoEstacion).toBe(estacion.codigo);
  }, 30_000);
});
