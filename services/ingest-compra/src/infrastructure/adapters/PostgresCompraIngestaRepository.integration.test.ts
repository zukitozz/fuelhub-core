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
//
// v1.66: se agregan casos para `obtenerPorId`/`actualizar` (migración
// 1788300000000_agrega-estado-a-compras.sql) — edición de cabecera, reemplazo
// completo de `destinos[]` (DELETE + INSERT, se confirma releyendo
// `compras_abastecimientos`) y la transición ACTIVO -> ANULADO (la primera de
// todo el repo, sección 3.8.6).

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

  it('obtenerPorId relee una compra ya registrada con sus destinos (v1.66)', async () => {
    const estacion = await primeraEstacionSembrada();
    const tanque = await primerTanqueDeEstacion(estacion.codigo);
    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const registrado = await ingestaRepo.registrar({
      codigoEstacion: estacion.codigo,
      productoId: tanque.productoId,
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 200,
      costoUnitario: 10,
      destinos: [{ tanqueId: tanque.id, cantidad: 200 }],
    });
    idsCreados.push(registrado.id);

    const releido = await ingestaRepo.obtenerPorId(registrado.id);
    expect(releido).toBeDefined();
    expect(releido?.id).toBe(registrado.id);
    expect(releido?.estado).toBe('ACTIVO');
    expect(releido?.destinos).toEqual([{ tanqueId: tanque.id, cantidad: 200 }]);
    expect(releido?.merma).toBeCloseTo(0, 3);
  }, 30_000);

  it('actualizar edita cabecera y reemplaza destinos[] por completo (DELETE + INSERT, v1.66)', async () => {
    const estacion = await primeraEstacionSembrada();
    const tanque = await primerTanqueDeEstacion(estacion.codigo);
    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const registrado = await ingestaRepo.registrar({
      codigoEstacion: estacion.codigo,
      productoId: tanque.productoId,
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 300,
      costoUnitario: 11,
      destinos: [{ tanqueId: tanque.id, cantidad: 300 }],
    });
    idsCreados.push(registrado.id);

    // Reemplaza proveedor, cantidad y destinos en un solo PUT -- confirma que
    // la validación de la suma de destinos usa la cantidad NUEVA (280), no la
    // vieja (300), y que la fila anterior de compras_abastecimientos se borra.
    const actualizado = await ingestaRepo.actualizar(registrado.id, {
      proveedor: `${MARCADOR_CI} (editado)`,
      cantidad: 280,
      destinos: [{ tanqueId: tanque.id, cantidad: 260 }],
    });

    expect(actualizado.proveedor).toBe(`${MARCADOR_CI} (editado)`);
    expect(actualizado.cantidad).toBe(280);
    expect(actualizado.destinos).toEqual([{ tanqueId: tanque.id, cantidad: 260 }]);
    expect(actualizado.merma).toBeCloseTo(20, 3);

    const abastecimientos = await ejecutar('SELECT cantidad FROM compras_abastecimientos WHERE compra_id = CAST(:id AS uuid)', [
      { name: 'id', value: { stringValue: registrado.id } },
    ]);
    expect(abastecimientos).toHaveLength(1);
    expect(Number(abastecimientos[0]?.cantidad)).toBeCloseTo(260, 3);
  }, 30_000);

  it('actualizar anula una compra (ACTIVO -> ANULADO) sin tocar el resto de campos (v1.66)', async () => {
    const estacion = await primeraEstacionSembrada();
    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const registrado = await ingestaRepo.registrar({
      codigoEstacion: estacion.codigo,
      productoNombre: `${MARCADOR_CI} Aceite de motor`,
      categoria: 'NO_COMBUSTIBLE',
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 10,
      costoUnitario: 25,
    });
    idsCreados.push(registrado.id);
    expect(registrado.estado).toBe('ACTIVO');

    const anulado = await ingestaRepo.actualizar(registrado.id, { estado: 'ANULADO' });

    expect(anulado.estado).toBe('ANULADO');
    // El resto de la cabecera no cambia -- este PUT solo tocó `estado`.
    expect(anulado.proveedor).toBe(MARCADOR_CI);
    expect(anulado.cantidad).toBe(10);
    expect(anulado.productoNombre).toBe(`${MARCADOR_CI} Aceite de motor`);
  }, 30_000);
});
