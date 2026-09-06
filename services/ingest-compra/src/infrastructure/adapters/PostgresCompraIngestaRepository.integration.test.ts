// PostgresCompraIngestaRepository.integration.test.ts (sección 7/12.6)
//
// No hay adaptador de consulta para `compras` todavía (solo `POST /compras`
// en el contrato, sección 11 — ningún `GET`) — este test relee con un SELECT
// crudo (vía el helper compartido) en vez de un segundo adaptador real, a
// diferencia de los tests hermanos de cierres_turno/cierres_dia. Igual
// confirma lo importante: que el `costo_total` GENERATED ALWAYS (DDL 3.3) se
// calcula bien contra Postgres real, y que `destinos[].tanqueId`/`productoId`
// reales (sembrados, no inventados) pasan la validación del adaptador.
//
// v1.65: `tanqueId` suelto -> `destinos[]` (migración
// 1788200000000_extiende-compras-multiproducto-multitanque.sql) — se agrega
// además un segundo caso con `productoId` ausente (compra de mercadería,
// sin tanque) para cubrir el otro cambio de esta versión.

import { PostgresCompraIngestaRepository } from './PostgresCompraIngestaRepository';
import { cliente, config, ejecutar, primeraEstacionSembrada, primerTanqueDeEstacion, MARCADOR_CI } from '@fuelhub/test-integration-support';
import type { DatosCompraAInsertar } from '../../application/ports/CompraIngestaRepository';

describe('PostgresCompraIngestaRepository (integración real, sin mocks)', () => {
  const idsCreados: string[] = [];

  afterAll(async () => {
    for (const id of idsCreados) {
      // CAST(... AS uuid) -- v1.51, mismo bug que los tests hermanos de
      // cierres_turno/cierres_dia (RDS Data API sin tipo explícito, sin
      // cast implícito de texto a uuid).
      await ejecutar('DELETE FROM compras WHERE id = CAST(:id AS uuid)', [{ name: 'id', value: { stringValue: id } }]);
    }
  });

  it('registra una compra real con destinos/productoId sembrados y calcula costo_total y merma bien', async () => {
    const estacion = await primeraEstacionSembrada();
    const tanque = await primerTanqueDeEstacion(estacion.codigo);

    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const datos: DatosCompraAInsertar = {
      codigoEstacion: estacion.codigo,
      productoId: tanque.productoId,
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 500,
      costoUnitario: 12.345,
      numeroGuia: `${MARCADOR_CI}-guia`,
      // Reparte menos de lo comprado a propósito -- confirma que la merma (v1.65) se calcula bien.
      destinos: [{ tanqueId: tanque.id, cantidad: 480 }],
    };

    const registrado = await ingestaRepo.registrar(datos);
    idsCreados.push(registrado.id);

    expect(registrado.codigoEstacion).toBe(estacion.codigo);
    expect(registrado.productoId).toBe(tanque.productoId);
    expect(registrado.destinos).toEqual([{ tanqueId: tanque.id, cantidad: 480 }]);
    expect(registrado.merma).toBeCloseTo(20, 3);
    // cantidad(500) * costoUnitario(12.345) — columna GENERATED de Postgres, se relee con RETURNING.
    expect(registrado.costoTotal).toBeCloseTo(6172.5, 2);

    const filas = await ejecutar('SELECT costo_total FROM compras WHERE id = CAST(:id AS uuid)', [
      { name: 'id', value: { stringValue: registrado.id } },
    ]);
    expect(Number(filas[0]?.costo_total)).toBeCloseTo(6172.5, 2);

    const abastecimientos = await ejecutar('SELECT tanque_id, cantidad FROM compras_abastecimientos WHERE compra_id = CAST(:id AS uuid)', [
      { name: 'id', value: { stringValue: registrado.id } },
    ]);
    expect(abastecimientos).toHaveLength(1);
    expect(Number(abastecimientos[0]?.cantidad)).toBeCloseTo(480, 3);
  }, 30_000);

  it('registra una compra de mercadería sin productoId ni destinos (v1.65)', async () => {
    const estacion = await primeraEstacionSembrada();
    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const datos: DatosCompraAInsertar = {
      codigoEstacion: estacion.codigo,
      productoNombre: `${MARCADOR_CI} Galletas surtidas`,
      categoria: 'NO_COMBUSTIBLE',
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 24,
      costoUnitario: 3.5,
    };

    const registrado = await ingestaRepo.registrar(datos);
    idsCreados.push(registrado.id);

    expect(registrado.productoId).toBeNull();
    expect(registrado.productoNombre).toBe(datos.productoNombre);
    expect(registrado.categoria).toBe('NO_COMBUSTIBLE');
    expect(registrado.destinos).toEqual([]);
    expect(registrado.merma).toBeNull();
  }, 30_000);
});
