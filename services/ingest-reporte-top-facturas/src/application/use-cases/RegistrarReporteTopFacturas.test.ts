// application/use-cases/RegistrarReporteTopFacturas.test.ts
import { RegistrarReporteTopFacturas } from './RegistrarReporteTopFacturas';
import type { EstacionLookupRepository } from '../ports/EstacionLookupRepository';
import type { ReporteTopFacturasStorageRepository, ReporteTopFacturasGuardadoDTO } from '../ports/ReporteTopFacturasStorageRepository';
import type { ReporteTopFacturasRendererPort } from '../ports/ReporteTopFacturasRendererPort';
import type { EventPublisherPort, ReporteTopFacturasRegistradoEvent } from '../ports/EventPublisherPort';
import { AccesoDenegadoEstacionError, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import type { ClienteTopFacturasInput, ReporteTopFacturasInput } from '../../domain/ReporteTopFacturasInput';

function authDe(stationScope: string): AuthContext {
  return { clientId: 'test-client', role: 'SISTEMA_GRIFO', stationScope, scopes: ['fuelhub-api/cierres.write'] };
}

function clienteValido(overrides: Partial<ClienteTopFacturasInput> = {}): ClienteTopFacturasInput {
  return {
    numeroDocumentoCliente: '20123456789',
    nombreCliente: 'Transportes ABC SAC',
    totalSoles: 700,
    facturas: [
      { numeracion: 'F001-000123', fecha: '2026-10-07', monto: 350, despachadorNombre: 'Juan Perez', despachadorDocumento: '12345678' },
      { numeracion: 'F001-000124', fecha: '2026-10-08', monto: 350, despachadorNombre: 'Juan Perez', despachadorDocumento: '12345678' },
    ],
    ...overrides,
  };
}

function inputValido(overrides: Partial<ReporteTopFacturasInput> = {}): ReporteTopFacturasInput {
  return {
    codigoEstacion: 'CHANCAYLLO',
    semanaInicio: '2026-10-06',
    top: [clienteValido()],
    ...overrides,
  };
}

class EstacionesFake implements EstacionLookupRepository {
  constructor(private readonly idPorCodigo: Record<string, string> = { CHANCAYLLO: 'estacion-uuid-1' }) {}
  async resolverEstacionId(codigoEstacion: string): Promise<string | undefined> {
    return this.idPorCodigo[codigoEstacion];
  }
}

class RendererFake implements ReporteTopFacturasRendererPort {
  readonly llamadas: Array<{ codigoEstacion: string; semanaInicio: string; top: readonly ClienteTopFacturasInput[] }> = [];
  async renderizarExcel(params: { codigoEstacion: string; semanaInicio: string; top: readonly ClienteTopFacturasInput[] }): Promise<Buffer> {
    this.llamadas.push(params);
    return Buffer.from('excel-fake');
  }
}

class RepoFake implements ReporteTopFacturasStorageRepository {
  readonly llamadas: Array<{ codigoEstacion: string; semanaInicio: string; top: readonly ClienteTopFacturasInput[]; excelBuffer: Buffer }> = [];
  async guardar(params: {
    codigoEstacion: string;
    semanaInicio: string;
    top: readonly ClienteTopFacturasInput[];
    excelBuffer: Buffer;
  }): Promise<ReporteTopFacturasGuardadoDTO> {
    this.llamadas.push(params);
    const base = `top-facturas/reporte_top_facturas_${params.codigoEstacion}_${params.semanaInicio}`;
    return { key: `${base}.json`, keyExcel: `${base}.xlsx` };
  }
}

class EventosFake implements EventPublisherPort {
  readonly llamadas: ReporteTopFacturasRegistradoEvent[] = [];
  fallar = false;
  async publicarReporteTopFacturasRegistrado(evento: ReporteTopFacturasRegistradoEvent): Promise<void> {
    if (this.fallar) throw new Error('EventBridge no disponible');
    this.llamadas.push(evento);
  }
}

describe('RegistrarReporteTopFacturas', () => {
  it('lanza AccesoDenegadoEstacionError cuando el token no tiene acceso a la estacion, sin renderizar/guardar/publicar', async () => {
    const estaciones = new EstacionesFake();
    const renderer = new RendererFake();
    const repo = new RepoFake();
    const eventos = new EventosFake();
    const caso = new RegistrarReporteTopFacturas(estaciones, renderer, repo, eventos);

    await expect(caso.ejecutar(authDe('MALA'), inputValido({ codigoEstacion: 'CHANCAYLLO' }))).rejects.toThrow(
      AccesoDenegadoEstacionError
    );
    expect(renderer.llamadas).toHaveLength(0);
    expect(repo.llamadas).toHaveLength(0);
    expect(eventos.llamadas).toHaveLength(0);
  });

  it('lanza RecursoNoEncontradoError cuando la estacion no existe/no esta activa, sin renderizar/guardar/publicar', async () => {
    const estaciones = new EstacionesFake({});
    const renderer = new RendererFake();
    const repo = new RepoFake();
    const eventos = new EventosFake();
    const caso = new RegistrarReporteTopFacturas(estaciones, renderer, repo, eventos);

    await expect(caso.ejecutar(authDe('*'), inputValido())).rejects.toThrow(RecursoNoEncontradoError);
    expect(renderer.llamadas).toHaveLength(0);
    expect(repo.llamadas).toHaveLength(0);
    expect(eventos.llamadas).toHaveLength(0);
  });

  it('con payload valido, renderiza el Excel, guarda en el repo y publica el evento con el resumen por cliente', async () => {
    const estaciones = new EstacionesFake();
    const renderer = new RendererFake();
    const repo = new RepoFake();
    const eventos = new EventosFake();
    const caso = new RegistrarReporteTopFacturas(estaciones, renderer, repo, eventos);

    const resultado = await caso.ejecutar(authDe('*'), inputValido());

    expect(renderer.llamadas).toHaveLength(1);
    expect(renderer.llamadas[0]?.top[0]?.facturas).toHaveLength(2);

    expect(repo.llamadas).toHaveLength(1);
    expect(repo.llamadas[0]?.top[0]?.facturas).toHaveLength(2);
    expect(repo.llamadas[0]?.excelBuffer.toString('utf-8')).toBe('excel-fake');

    expect(eventos.llamadas).toHaveLength(1);
    expect(eventos.llamadas[0]).toEqual({
      proyectoCodigo: 'FUELHUBCLOUD',
      estacionId: 'estacion-uuid-1',
      estacionCodigo: 'CHANCAYLLO',
      semanaInicio: '2026-10-06',
      tipo: 'top facturas',
      reporteTopFacturasId: 'estacion-uuid-1-2026-10-06',
      top: [
        {
          numeroDocumentoCliente: '20123456789',
          nombreCliente: 'Transportes ABC SAC',
          totalSoles: 700,
          cantidadFacturas: 2,
          despachadores: ['Juan Perez'],
        },
      ],
    });

    expect(resultado).toEqual({
      codigoEstacion: 'CHANCAYLLO',
      semanaInicio: '2026-10-06',
      key: 'top-facturas/reporte_top_facturas_CHANCAYLLO_2026-10-06.json',
    });
  });

  it('deduplica despachadores repetidos y cuenta distintos despachadores del mismo cliente', async () => {
    const estaciones = new EstacionesFake();
    const renderer = new RendererFake();
    const repo = new RepoFake();
    const eventos = new EventosFake();
    const caso = new RegistrarReporteTopFacturas(estaciones, renderer, repo, eventos);

    await caso.ejecutar(
      authDe('*'),
      inputValido({
        top: [
          clienteValido({
            facturas: [
              { numeracion: 'F001-1', fecha: '2026-10-07', monto: 100, despachadorNombre: 'Juan Perez', despachadorDocumento: '12345678' },
              { numeracion: 'F001-2', fecha: '2026-10-08', monto: 100, despachadorNombre: 'Maria Lopez', despachadorDocumento: '87654321' },
              { numeracion: 'F001-3', fecha: '2026-10-09', monto: 100, despachadorNombre: 'Juan Perez', despachadorDocumento: '12345678' },
            ],
          }),
        ],
      })
    );

    expect(eventos.llamadas[0]?.top[0]).toEqual(
      expect.objectContaining({ cantidadFacturas: 3, despachadores: ['Juan Perez', 'Maria Lopez'] })
    );
  });

  it('best effort: si falla la publicacion del evento, no propaga el error y el reporte ya quedo guardado', async () => {
    const estaciones = new EstacionesFake();
    const renderer = new RendererFake();
    const repo = new RepoFake();
    const eventos = new EventosFake();
    eventos.fallar = true;
    const caso = new RegistrarReporteTopFacturas(estaciones, renderer, repo, eventos);

    const resultado = await caso.ejecutar(authDe('*'), inputValido());

    expect(repo.llamadas).toHaveLength(1);
    expect(resultado.key).toBe('top-facturas/reporte_top_facturas_CHANCAYLLO_2026-10-06.json');
  });

  it('token con acceso wildcard (*) pasa la autorizacion', async () => {
    const estaciones = new EstacionesFake();
    const renderer = new RendererFake();
    const repo = new RepoFake();
    const eventos = new EventosFake();
    const caso = new RegistrarReporteTopFacturas(estaciones, renderer, repo, eventos);

    await expect(caso.ejecutar(authDe('*'), inputValido())).resolves.toBeDefined();
  });
});
