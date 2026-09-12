// PostgresCierreDiaIngestaRepository.integration.test.ts (sección 7/12.6)
//
// Registra un cierre de día sintético con el adaptador REAL de
// ingest-cierre-dia y lo relee con el adaptador REAL de consulta-cierres
// (`PostgresCierreDiaQueryRepository`) — este es el test que hubiera
// atrapado, apenas se corriera una vez contra un esquema real, el bug real
// encontrado al escribir este suite: el `JOIN` de ese adaptador usaba
// `cd.administrador_id` (columna que no existe, DDL 3.3 la llama
// `usuario_id`) y `GET /cierres-dia` fallaba con un error de Postgres en
// cualquier corrida real. Ya corregido — ver el comentario de cabecera de
// `PostgresCierreDiaQueryRepository.ts`. Se deja este test tal cual (sin
// "ablandarlo" para que hubiera pasado con el bug) precisamente para que,
// si algo similar vuelve a colarse ahí, este suite lo note de nuevo.
//
// El publish real a EventBridge (`EventBridgeCierreDiaPublisher`, el mismo
// paso que en producción sigue a este `registrar()`) queda deliberadamente
// FUERA de este suite — ver `scripts/test-integration.mjs` para el porqué
// (el bus es compartido con el sistema de notificaciones de WhatsApp, un
// proyecto aparte; un evento sintético de prueba ahí podría disparar un
// mensaje real a una estación real).

import { PostgresCierreDiaIngestaRepository } from './PostgresCierreDiaIngestaRepository';
import { PostgresCierreDiaQueryRepository } from '../../../../consulta-cierres/src/infrastructure/adapters/PostgresCierreDiaQueryRepository';
import { PostgresCierreTurnoIngestaRepository } from '../../../../ingest-cierre-turno/src/infrastructure/adapters/PostgresCierreTurnoIngestaRepository';
import { cliente, config, ejecutar, primeraEstacionSembrada, MARCADOR_CI } from '@fuelhub/test-integration-support';
import type { DatosCierreDiaAInsertar } from '../../application/ports/CierreDiaIngestaRepository';
import type { DatosCierreTurnoAInsertar } from '../../../../ingest-cierre-turno/src/application/ports/CierreTurnoIngestaRepository';

describe('PostgresCierreDiaIngestaRepository (integración real, sin mocks)', () => {
  let idCreado: string | undefined;
  let idTurnoCreado: string | undefined;

  afterAll(async () => {
    if (idCreado) {
      // CAST(... AS uuid) -- v1.51, descubierto en el primer test:integration
      // real: RDS Data API manda el parámetro sin tipo explícito y Postgres
      // no tiene cast implícito de texto a uuid para "=".
      await ejecutar('DELETE FROM cierres_dia WHERE id = CAST(:id AS uuid)', [{ name: 'id', value: { stringValue: idCreado } }]);
    }
    if (idTurnoCreado) {
      await ejecutar('DELETE FROM cierres_turno WHERE id = CAST(:id AS uuid)', [{ name: 'id', value: { stringValue: idTurnoCreado } }]);
    }
  });

  it('registra un cierre de día real, vincula sus cierresTurnoIds (v1.76) y lo relee igual desde PostgresCierreDiaQueryRepository', async () => {
    const estacion = await primeraEstacionSembrada();

    const ingestaRepo = new PostgresCierreDiaIngestaRepository(cliente(), config());
    const queryRepo = new PostgresCierreDiaQueryRepository(cliente(), config());
    const turnoRepo = new PostgresCierreTurnoIngestaRepository(cliente(), config());

    const ahora = new Date();
    const haceUnaHora = new Date(ahora.getTime() - 60 * 60 * 1000);
    const fechaNegocio = ahora.toISOString().slice(0, 10);

    // Se registra un cierre de turno real primero -- v1.76 exige que
    // `cierresTurnoIds` referencie turnos que existan de verdad (ver
    // `vincularCierresTurno`, rechaza el cierre de día completo si no).
    const datosTurno: DatosCierreTurnoAInsertar = {
      codigoEstacion: estacion.codigo,
      isla: 'CI-ISLA-1',
      turno: 'TURNO1',
      fechaNegocio,
      fechaInicio: haceUnaHora.toISOString(),
      fecha: ahora.toISOString(),
      total: 150.5,
      empleado: { codigo: `${MARCADOR_CI}-empleado-dia`, nombre: 'CI Test Integración (empleado)' },
      clienteOrigen: MARCADOR_CI,
      pagos: [{ medio: 'efectivo', monto: 150.5 }],
      detalle: [],
    };
    const turnoRegistrado = await turnoRepo.registrar(datosTurno);
    idTurnoCreado = turnoRegistrado.id;

    const datos: DatosCierreDiaAInsertar = {
      codigoEstacion: estacion.codigo,
      isla: null,
      fechaNegocio,
      fecha: ahora.toISOString(),
      total: 987.65,
      administrador: { codigo: `${MARCADOR_CI}-admin-dia`, nombre: 'CI Test Integración (administrador)' },
      cierresTurnoIds: [turnoRegistrado.id],
      clienteOrigen: MARCADOR_CI,
    };

    const { dto: registrado, estacionId } = await ingestaRepo.registrar(datos);
    idCreado = registrado.id;

    expect(registrado.codigoEstacion).toBe(estacion.codigo);
    expect(registrado.total).toBe(987.65);
    expect(estacionId).toBe(estacion.id);
    expect(registrado.administrador.codigo).toBe(datos.administrador.codigo);

    // Confirma que vincularCierresTurno de verdad hizo el UPDATE -- este es
    // el hallazgo real (Jorge, reporte del 2026-09-10): antes de v1.76,
    // cierre_dia_id se quedaba NULL para siempre.
    const [turnoReleido] = await ejecutar('SELECT cierre_dia_id FROM cierres_turno WHERE id = CAST(:id AS uuid)', [
      { name: 'id', value: { stringValue: turnoRegistrado.id } },
    ]);
    expect(turnoReleido?.cierre_dia_id).toBe(registrado.id);

    // Esta es la llamada que fallaba con "column cd.administrador_id does
    // not exist" antes de la corrección — si vuelve a romperse, revienta acá.
    const listado = await queryRepo.listar(
      { estacionCodigo: estacion.codigo, estado: 'ACTIVO' },
      { page: 1, pageSize: 50 }
    );
    const encontrado = listado.data.find((c) => c.id === registrado.id);
    expect(encontrado).toBeDefined();
    expect(encontrado?.total).toBe(987.65);
    expect(encontrado?.administrador.codigo).toBe(datos.administrador.codigo);
    expect(encontrado?.administrador.nombre).toBe(datos.administrador.nombre);
  }, 30_000);

  it('rechaza el cierre de día completo si algún cierresTurnoIds no matchea (no existe)', async () => {
    const estacion = await primeraEstacionSembrada();
    const ingestaRepo = new PostgresCierreDiaIngestaRepository(cliente(), config());

    const ahora = new Date();
    const fechaNegocio = ahora.toISOString().slice(0, 10);
    const idInexistente = '00000000-0000-0000-0000-000000000000';

    const datos: DatosCierreDiaAInsertar = {
      codigoEstacion: estacion.codigo,
      isla: null,
      fechaNegocio,
      fecha: ahora.toISOString(),
      total: 1,
      administrador: { codigo: `${MARCADOR_CI}-admin-dia-rechazo`, nombre: 'CI Test Integración (administrador)' },
      cierresTurnoIds: [idInexistente],
      clienteOrigen: MARCADOR_CI,
    };

    await expect(ingestaRepo.registrar(datos)).rejects.toThrow();

    // El ROLLBACK debe haber revertido también el INSERT de la cabecera --
    // no debe quedar ningún cierre de día "huérfano" de esta corrida.
    const filas = await ejecutar(
      `SELECT cd.id FROM cierres_dia cd
       JOIN estaciones e ON e.id = cd.estacion_id
       WHERE e.codigo = :codigo AND cd.fecha_negocio = CAST(:fechaNegocio AS date) AND cd.total = 1`,
      [
        { name: 'codigo', value: { stringValue: estacion.codigo } },
        { name: 'fechaNegocio', value: { stringValue: fechaNegocio } },
      ]
    );
    expect(filas).toHaveLength(0);
  }, 30_000);
});
