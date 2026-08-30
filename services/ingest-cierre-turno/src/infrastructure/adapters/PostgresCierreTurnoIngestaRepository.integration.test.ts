// PostgresCierreTurnoIngestaRepository.integration.test.ts (sección 7/12.6)
//
// Registra un cierre de turno sintético contra la Aurora real de
// `--grupo/--env` (ver `scripts/test-integration.mjs`) usando el adaptador
// REAL (sin mocks de AWS), y lo relee con los adaptadores REALES de consulta
// — `consulta-cierres` y `consulta-cierre-detalle`, dos microservicios
// distintos, ambos contra la misma tabla — confirmando que lo que un
// servicio escribe es exactamente lo que otro servicio, con su propio SQL,
// lee de vuelta. Es justo el tipo de desacople (misma tabla, SQL escrito por
// separado en cada adaptador) que dejó pasar el bug real de
// `PostgresCierreDiaQueryRepository` (`cd.administrador_id` en vez de
// `cd.usuario_id`, encontrado al escribir este mismo suite — ver el test
// hermano de cierres_dia y el comentario de cabecera de ese adaptador).

import { PostgresCierreTurnoIngestaRepository } from './PostgresCierreTurnoIngestaRepository';
import { PostgresCierreTurnoQueryRepository } from '../../../../consulta-cierres/src/infrastructure/adapters/PostgresCierreTurnoQueryRepository';
import { PostgresCierreTurnoDetalleRepository } from '../../../../consulta-cierre-detalle/src/infrastructure/adapters/PostgresCierreTurnoDetalleRepository';
import { cliente, config, ejecutar, primeraEstacionSembrada, primerProductoActivo, MARCADOR_CI } from '@fuelhub/test-integration-support';
import type { DatosCierreTurnoAInsertar } from '../../application/ports/CierreTurnoIngestaRepository';

describe('PostgresCierreTurnoIngestaRepository (integración real, sin mocks)', () => {
  let idCreado: string | undefined;

  afterAll(async () => {
    if (idCreado) {
      // Basta con borrar la cabecera: cierres_turno_pagos/cierres_turno_detalle
      // tienen ON DELETE CASCADE hacia cierres_turno (sección 3.3).
      // CAST(... AS uuid) -- v1.51, mismo bug que el test hermano de
      // cierres_dia (RDS Data API sin tipo explícito, sin cast implícito).
      await ejecutar('DELETE FROM cierres_turno WHERE id = CAST(:id AS uuid)', [{ name: 'id', value: { stringValue: idCreado } }]);
    }
  });

  it('registra un cierre de turno real y lo relee igual desde 2 adaptadores de consulta distintos', async () => {
    const estacion = await primeraEstacionSembrada();
    const producto = await primerProductoActivo();

    const ingestaRepo = new PostgresCierreTurnoIngestaRepository(cliente(), config());
    const queryRepo = new PostgresCierreTurnoQueryRepository(cliente(), config());
    const detalleRepo = new PostgresCierreTurnoDetalleRepository(cliente(), config());

    const ahora = new Date();
    const haceUnaHora = new Date(ahora.getTime() - 60 * 60 * 1000);
    const fechaNegocio = ahora.toISOString().slice(0, 10);

    const datos: DatosCierreTurnoAInsertar = {
      codigoEstacion: estacion.codigo,
      isla: 'CI-ISLA-1',
      turno: 'TURNO1',
      fechaNegocio,
      fechaInicio: haceUnaHora.toISOString(),
      fecha: ahora.toISOString(),
      total: 150.5,
      empleado: { codigo: `${MARCADOR_CI}-empleado-turno`, nombre: 'CI Test Integración (empleado)' },
      clienteOrigen: MARCADOR_CI,
      pagos: [{ medio: 'efectivo', monto: 150.5 }],
      detalle: [
        {
          productoId: producto.id,
          producto: producto.nombre,
          totalCantidad: 40,
          totalSoles: 150.5,
        },
      ],
    };

    const registrado = await ingestaRepo.registrar(datos);
    idCreado = registrado.id;

    expect(registrado.codigoEstacion).toBe(estacion.codigo);
    expect(registrado.total).toBe(150.5);
    expect(registrado.pagos).toHaveLength(1);
    expect(registrado.detalle).toHaveLength(1);

    const detalleReleido = await detalleRepo.obtenerPorId(registrado.id);
    expect(detalleReleido).toBeDefined();
    expect(detalleReleido?.codigoEstacion).toBe(estacion.codigo);
    expect(detalleReleido?.total).toBe(150.5);
    expect(detalleReleido?.empleado.codigo).toBe(datos.empleado.codigo);
    expect(detalleReleido?.pagos).toEqual([{ medio: 'efectivo', monto: 150.5 }]);

    const listado = await queryRepo.listar(
      { estacionCodigo: estacion.codigo, estado: 'ACTIVO' },
      { page: 1, pageSize: 50 }
    );
    const encontrado = listado.data.find((c) => c.id === registrado.id);
    expect(encontrado).toBeDefined();
    expect(encontrado?.total).toBe(150.5);
  }, 30_000);
});
