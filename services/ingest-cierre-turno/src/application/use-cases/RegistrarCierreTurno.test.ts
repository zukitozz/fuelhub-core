// RegistrarCierreTurno.test.ts — `npm run test:unit` (sección 7/12.6, v1.50).
//
// El repositorio se reemplaza por un fake en memoria que implementa el
// puerto (`CierreTurnoIngestaRepository`) — NO un mock de `@aws-sdk/*`, tal
// como pide la sección 7 ("el dominio y los casos de uso se testean con
// Jest sin mocks de AWS, gracias a la separación hexagonal"). Cubre las 2
// decisiones reales de este caso de uso: (1) la validación estructural pura
// corre primero y nunca llega a tocar el repositorio, y (2) la autorización
// por `custom:station_scope` (5.4) se decide ACÁ, antes de delegar.

import type { AuthContext } from '@fuelhub/shared-kernel';
import type { CierreTurnoDetalleDTO } from '@fuelhub/shared-kernel';
import type { CierreTurnoInput } from '../../domain/CierreTurnoInput';
import type { CierreTurnoIngestaRepository, DatosCierreTurnoAInsertar } from '../ports/CierreTurnoIngestaRepository';
import { RegistrarCierreTurno } from './RegistrarCierreTurno';

function fakeRepo(): CierreTurnoIngestaRepository & { llamadas: DatosCierreTurnoAInsertar[] } {
  const llamadas: DatosCierreTurnoAInsertar[] = [];
  return {
    llamadas,
    async registrar(datos) {
      llamadas.push(datos);
      const dto: CierreTurnoDetalleDTO = {
        id: 'fake-id',
        codigoEstacion: datos.codigoEstacion,
        isla: datos.isla ?? null,
        turno: datos.turno as CierreTurnoDetalleDTO['turno'],
        fechaNegocio: datos.fechaNegocio,
        fechaInicio: datos.fechaInicio,
        fecha: datos.fecha,
        total: datos.total,
        estado: 'ACTIVO',
        empleado: datos.empleado,
        recibidoEn: '2026-08-22T14:05:00-05:00',
        cierreDiaId: null,
        facturasEmitidas: datos.facturasEmitidas ?? 0,
        clienteOrigen: datos.clienteOrigen,
        pagos: datos.pagos,
        detalle: datos.detalle.map((linea) => ({
          productoId: linea.productoId ?? null,
          codigoLocal: linea.codigoLocal ?? null,
          producto: linea.producto,
          medida: linea.medida ?? null,
          totalCantidad: linea.totalCantidad,
          totalSoles: linea.totalSoles,
          calibracionCantidad: linea.calibracionCantidad ?? null,
          calibracionSoles: linea.calibracionSoles ?? null,
          despachoCantidad: linea.despachoCantidad ?? null,
          despachoSoles: linea.despachoSoles ?? null,
        })),
      };
      return dto;
    },
  };
}

function inputValido(): CierreTurnoInput {
  return {
    codigoEstacion: 'CHANCAYLLO',
    turno: 'TURNO1',
    fechaNegocio: '2026-08-22',
    fechaInicio: '2026-08-22T06:00:00-05:00',
    fecha: '2026-08-22T14:00:00-05:00',
    total: 500,
    empleado: { codigo: 'OP001', nombre: 'Juan Pérez' },
    pagos: [{ medio: 'EFECTIVO', monto: 500 }],
    detalle: [{ producto: 'Diésel', codigoLocal: 'DSL', totalCantidad: 100, totalSoles: 500 }],
  };
}

function auth(stationScope: string): AuthContext {
  return { clientId: 'client-chancayllo', role: 'SISTEMA_GRIFO', stationScope, scopes: ['fuelhub-api/cierres.write'] };
}

describe('RegistrarCierreTurno', () => {
  it('delega al repositorio con clienteOrigen tomado del token cuando el token tiene acceso a la estación', async () => {
    const repo = fakeRepo();
    const caso = new RegistrarCierreTurno(repo);

    const resultado = await caso.ejecutar(auth('CHANCAYLLO'), inputValido());

    expect(repo.llamadas).toHaveLength(1);
    expect(repo.llamadas[0]?.clienteOrigen).toBe('client-chancayllo');
    expect(repo.llamadas[0]?.codigoEstacion).toBe('CHANCAYLLO');
    expect(resultado.id).toBe('fake-id');
  });

  it('permite el registro cuando el token trae wildcard "*"', async () => {
    const repo = fakeRepo();
    const caso = new RegistrarCierreTurno(repo);
    await expect(caso.ejecutar(auth('*'), inputValido())).resolves.toBeDefined();
  });

  it('rechaza con AccesoDenegadoEstacionError sin llamar al repositorio si el token es de otra estación (sección 5.4)', async () => {
    const repo = fakeRepo();
    const caso = new RegistrarCierreTurno(repo);

    await expect(caso.ejecutar(auth('MALA'), inputValido())).rejects.toMatchObject({
      name: 'AccesoDenegadoEstacionError',
      estacionSolicitada: 'CHANCAYLLO',
    });
    expect(repo.llamadas).toHaveLength(0);
  });

  it('rechaza con ParametrosInvalidosError sin llamar al repositorio si el payload es estructuralmente inválido, incluso con acceso correcto a la estación', async () => {
    const repo = fakeRepo();
    const caso = new RegistrarCierreTurno(repo);

    const payloadInvalido = { ...inputValido(), pagos: [] };

    await expect(caso.ejecutar(auth('CHANCAYLLO'), payloadInvalido)).rejects.toMatchObject({
      name: 'ParametrosInvalidosError',
    });
    expect(repo.llamadas).toHaveLength(0);
  });
});
