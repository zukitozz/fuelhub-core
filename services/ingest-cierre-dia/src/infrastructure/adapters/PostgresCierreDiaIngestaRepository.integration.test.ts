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
import { cliente, config, ejecutar, primeraEstacionSembrada, MARCADOR_CI } from '@fuelhub/test-integration-support';
import type { DatosCierreDiaAInsertar } from '../../application/ports/CierreDiaIngestaRepository';

describe('PostgresCierreDiaIngestaRepository (integración real, sin mocks)', () => {
  let idCreado: string | undefined;

  afterAll(async () => {
    if (idCreado) {
      // CAST(... AS uuid) -- v1.51, descubierto en el primer test:integration
      // real: RDS Data API manda el parámetro sin tipo explícito y Postgres
      // no tiene cast implícito de texto a uuid para "=".
      await ejecutar('DELETE FROM cierres_dia WHERE id = CAST(:id AS uuid)', [{ name: 'id', value: { stringValue: idCreado } }]);
    }
  });

  it('registra un cierre de día real y lo relee igual desde PostgresCierreDiaQueryRepository', async () => {
    const estacion = await primeraEstacionSembrada();

    const ingestaRepo = new PostgresCierreDiaIngestaRepository(cliente(), config());
    const queryRepo = new PostgresCierreDiaQueryRepository(cliente(), config());

    const ahora = new Date();
    const fechaNegocio = ahora.toISOString().slice(0, 10);

    const datos: DatosCierreDiaAInsertar = {
      codigoEstacion: estacion.codigo,
      isla: null,
      fechaNegocio,
      fecha: ahora.toISOString(),
      total: 987.65,
      administrador: { codigo: `${MARCADOR_CI}-admin-dia`, nombre: 'CI Test Integración (administrador)' },
      clienteOrigen: MARCADOR_CI,
    };

    const { dto: registrado, estacionId } = await ingestaRepo.registrar(datos);
    idCreado = registrado.id;

    expect(registrado.codigoEstacion).toBe(estacion.codigo);
    expect(registrado.total).toBe(987.65);
    expect(estacionId).toBe(estacion.id);
    expect(registrado.administrador.codigo).toBe(datos.administrador.codigo);

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
});
