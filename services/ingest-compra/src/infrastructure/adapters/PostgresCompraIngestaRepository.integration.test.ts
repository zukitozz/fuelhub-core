// PostgresCompraIngestaRepository.integration.test.ts (sección 7/12.6)
//
// No hay adaptador de consulta para `compras` todavía (solo `POST /compras`
// en el contrato, sección 11 — ningún `GET`) — este test relee con un SELECT
// crudo (vía el helper compartido) en vez de un segundo adaptador real, a
// diferencia de los tests hermanos de cierres_turno/cierres_dia. Igual
// confirma lo importante: que el `costo_total` GENERATED ALWAYS (DDL 3.3) se
// calcula bien contra Postgres real, y que `tanqueId`/`productoId` reales
// (sembrados, no inventados) pasan la validación del adaptador.

import { PostgresCompraIngestaRepository } from './PostgresCompraIngestaRepository';
import { cliente, config, ejecutar, primeraEstacionSembrada, primerTanqueDeEstacion, MARCADOR_CI } from '@fuelhub/test-integration-support';
import type { DatosCompraAInsertar } from '../../application/ports/CompraIngestaRepository';

describe('PostgresCompraIngestaRepository (integración real, sin mocks)', () => {
  let idCreado: string | undefined;

  afterAll(async () => {
    if (idCreado) {
      await ejecutar('DELETE FROM compras WHERE id = :id', [{ name: 'id', value: { stringValue: idCreado } }]);
    }
  });

  it('registra una compra real con tanqueId/productoId sembrados y calcula costo_total bien', async () => {
    const estacion = await primeraEstacionSembrada();
    const tanque = await primerTanqueDeEstacion(estacion.codigo);

    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const datos: DatosCompraAInsertar = {
      codigoEstacion: estacion.codigo,
      tanqueId: tanque.id,
      productoId: tanque.productoId,
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 500,
      costoUnitario: 12.345,
      numeroGuia: `${MARCADOR_CI}-guia`,
    };

    const registrado = await ingestaRepo.registrar(datos);
    idCreado = registrado.id;

    expect(registrado.codigoEstacion).toBe(estacion.codigo);
    expect(registrado.tanqueId).toBe(tanque.id);
    expect(registrado.productoId).toBe(tanque.productoId);
    // cantidad(500) * costoUnitario(12.345) — columna GENERATED de Postgres, se relee con RETURNING.
    expect(registrado.costoTotal).toBeCloseTo(6172.5, 2);

    const filas = await ejecutar('SELECT costo_total FROM compras WHERE id = :id', [
      { name: 'id', value: { stringValue: registrado.id } },
    ]);
    expect(Number(filas[0]?.costo_total)).toBeCloseTo(6172.5, 2);
  }, 30_000);
});
