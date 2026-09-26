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
//
// v1.67: se agregan casos para `listar` (GET /compras) — mismo criterio de
// "smoke test contra un rango amplio" que ya usan los suites hermanos de
// `consulta-cierres` para no depender de qué compras existan sembradas hoy
// en `dev`, más 2 casos precisos que sí importan verificar contra Postgres
// real: que la merma calculada por el LEFT JOIN agregado de
// `compras_abastecimientos` (lógica nueva, distinta de la de
// `registrar`/`obtenerPorId`/`actualizar`, que sí tienen cobertura real
// desde v1.65/v1.66) da el mismo resultado que esos otros métodos, tanto
// con destinos parciales (merma > 0) como sin ningún destino (merma null).

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
    expect(registrado.destinos).toEqual([{ tanqueId: tanque.id, descripcionEntrega: null, cantidad: 480 }]);
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

  it('registra una compra con una entrega externa (descripcionEntrega, sin tanqueId) -- v1.70', async () => {
    const estacion = await primeraEstacionSembrada();
    const tanque = await primerTanqueDeEstacion(estacion.codigo);
    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const datos: DatosCompraAInsertar = {
      codigoEstacion: estacion.codigo,
      productoId: tanque.productoId,
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 500,
      costoUnitario: 12,
      // Combina un tanque registrado con una entrega externa (venta al menudeo a granel) --
      // ambas cuentan igual en la suma de destinos[], asi que la merma solo cubre lo no explicado.
      destinos: [
        { tanqueId: tanque.id, cantidad: 350 },
        { descripcionEntrega: `${MARCADOR_CI} venta al menudeo -- camion placa ABC-123`, cantidad: 100 },
      ],
    };

    const registrado = await ingestaRepo.registrar(datos);
    idsCreados.push(registrado.id);

    expect(registrado.destinos).toHaveLength(2);
    expect(registrado.destinos).toContainEqual({ tanqueId: tanque.id, descripcionEntrega: null, cantidad: 350 });
    expect(registrado.destinos).toContainEqual({
      tanqueId: null,
      descripcionEntrega: `${MARCADOR_CI} venta al menudeo -- camion placa ABC-123`,
      cantidad: 100,
    });
    // 500 comprado - (350 tanque + 100 entrega externa) = 50 de merma real (no explicada).
    expect(registrado.merma).toBeCloseTo(50, 3);

    const releido = await ingestaRepo.obtenerPorId(registrado.id);
    expect(releido?.destinos).toHaveLength(2);
    expect(releido?.destinos).toContainEqual({
      tanqueId: null,
      descripcionEntrega: `${MARCADOR_CI} venta al menudeo -- camion placa ABC-123`,
      cantidad: 100,
    });
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
    expect(releido?.destinos).toEqual([{ tanqueId: tanque.id, descripcionEntrega: null, cantidad: 200 }]);
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
    expect(actualizado.destinos).toEqual([{ tanqueId: tanque.id, descripcionEntrega: null, cantidad: 260 }]);
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

  it('listar corre sin filtros de fecha y devuelve un resultado paginado (SQL válido, v1.67)', async () => {
    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const resultado = await ingestaRepo.listar({ estado: 'ACTIVO' }, { page: 1, pageSize: 20 });

    expect(Array.isArray(resultado.data)).toBe(true);
    expect(resultado.pagination.page).toBe(1);
  }, 30_000);

  it('listar sin `estado` no filtra por estado -- devuelve ACTIVO, ANULADO y PENDIENTE_REVISION juntos (v1.82.2)', async () => {
    const estacion = await primeraEstacionSembrada();
    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const activa = await ingestaRepo.registrar({
      codigoEstacion: estacion.codigo,
      productoNombre: `${MARCADOR_CI} v1.82.2 activa`,
      categoria: 'NO_COMBUSTIBLE',
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 1,
      costoUnitario: 1,
    });
    idsCreados.push(activa.id);

    const paraAnular = await ingestaRepo.registrar({
      codigoEstacion: estacion.codigo,
      productoNombre: `${MARCADOR_CI} v1.82.2 anulada`,
      categoria: 'NO_COMBUSTIBLE',
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 1,
      costoUnitario: 1,
    });
    idsCreados.push(paraAnular.id);
    const anulada = await ingestaRepo.actualizar(paraAnular.id, { estado: 'ANULADO' });
    expect(anulada.estado).toBe('ANULADO');

    // Sin `estado` en el filtro -- la firma de FiltrosCompra lo permite
    // opcional desde v1.82.2 (ver puerto CompraIngestaRepository.ts).
    const hoy = new Date().toISOString().slice(0, 10);
    const resultado = await ingestaRepo.listar(
      { estacionCodigo: estacion.codigo, fechaDesde: hoy, fechaHasta: hoy },
      { page: 1, pageSize: 100 }
    );

    const idsListados = resultado.data.map((c) => c.id);
    expect(idsListados).toContain(activa.id);
    expect(idsListados).toContain(anulada.id); // la clave del test -- antes de v1.82.2 esto NO aparecía sin pedirlo explícito
  }, 30_000);

  it('listar corre con fechaDesde/fechaHasta reales, filtrado por estación (regresión del bug de CAST, v1.67)', async () => {
    const estacion = await primeraEstacionSembrada();
    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    // Rango deliberadamente amplio (2000-2099): lo único que este test
    // confirma es que el SQL corre con fechaDesde/fechaHasta reales sin
    // reventar -- no depende de qué compras existan sembradas hoy.
    const resultado = await ingestaRepo.listar(
      { estado: 'ACTIVO', estacionCodigo: estacion.codigo, fechaDesde: '2000-01-01', fechaHasta: '2099-12-31' },
      { page: 1, pageSize: 100 }
    );

    expect(Array.isArray(resultado.data)).toBe(true);
    expect(resultado.data.every((c) => c.codigoEstacion === estacion.codigo)).toBe(true);
  }, 30_000);

  it('listar calcula la merma igual que registrar/obtenerPorId para una compra con destinos parciales (v1.67)', async () => {
    const estacion = await primeraEstacionSembrada();
    const tanque = await primerTanqueDeEstacion(estacion.codigo);
    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const registrado = await ingestaRepo.registrar({
      codigoEstacion: estacion.codigo,
      productoId: tanque.productoId,
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 150,
      costoUnitario: 13,
      destinos: [{ tanqueId: tanque.id, cantidad: 140 }],
    });
    idsCreados.push(registrado.id);

    // Rango de un solo día (hoy) para acotar el listado a lo que este test
    // acaba de crear, sin depender de qué más exista sembrado en `dev`.
    const hoy = new Date().toISOString().slice(0, 10);
    const resultado = await ingestaRepo.listar(
      { estado: 'ACTIVO', estacionCodigo: estacion.codigo, fechaDesde: hoy, fechaHasta: hoy },
      { page: 1, pageSize: 100 }
    );

    const fila = resultado.data.find((c) => c.id === registrado.id);
    expect(fila).toBeDefined();
    expect(fila?.merma).toBeCloseTo(10, 3);
    expect(fila?.estado).toBe('ACTIVO');
  }, 30_000);

  it('listar devuelve merma null para una compra sin ningún destino (v1.67)', async () => {
    const estacion = await primeraEstacionSembrada();
    const ingestaRepo = new PostgresCompraIngestaRepository(cliente(), config());

    const registrado = await ingestaRepo.registrar({
      codigoEstacion: estacion.codigo,
      productoNombre: `${MARCADOR_CI} Filtro de aceite`,
      categoria: 'NO_COMBUSTIBLE',
      proveedor: MARCADOR_CI,
      fecha: new Date().toISOString(),
      cantidad: 6,
      costoUnitario: 18,
    });
    idsCreados.push(registrado.id);

    const hoy = new Date().toISOString().slice(0, 10);
    const resultado = await ingestaRepo.listar(
      { estado: 'ACTIVO', estacionCodigo: estacion.codigo, fechaDesde: hoy, fechaHasta: hoy },
      { page: 1, pageSize: 100 }
    );

    const fila = resultado.data.find((c) => c.id === registrado.id);
    expect(fila).toBeDefined();
    expect(fila?.merma).toBeNull();
  }, 30_000);
});
