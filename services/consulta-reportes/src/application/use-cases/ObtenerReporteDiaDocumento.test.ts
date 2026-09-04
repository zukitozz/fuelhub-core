// ObtenerReporteDiaDocumento.test.ts (v1.62)
//
// Cubre dos cosas: (1) la rama que no tiene ObtenerReporteDia -- cuando no
// se manda estacionCodigo y el token no resuelve a una única estación, en
// vez de un 400 se arma el reporte CONSOLIDADO (todas las estaciones del
// token); y (2) desde v1.62, que el PDF (individual y consolidado) siempre
// se arma con el desglose por turno (`listarTurnos`) además del reporte del
// día -- a pedido de Jorge ("apóyate de los cierres de turno que
// corresponden al cierre de día"). Se prueba sin AWS real: repo/renderer/
// storage son fakes en memoria -- mismo criterio que ObtenerReporteDia.test.ts.

import { AccesoDenegadoEstacionError, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ObtenerReporteDiaDocumento } from './ObtenerReporteDiaDocumento';
import type { FiltrosReporteDia, ReporteDiaDTO, ReporteDiaQueryRepository, ReporteDiaTurnoDTO } from '../ports/ReporteDiaQueryRepository';
import type {
  DocumentoStoragePort,
  ReporteDiaDocumentoDatos,
  ReporteDiaEstacionDocumentoDTO,
  ReporteDiaRendererPort,
} from '../ports/ReporteDiaDocumentoPorts';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return { clientId: 'test-client', role: 'SISTEMA_GRIFO', stationScope: 'CHANCAYLLO', scopes: [], ...overrides };
}

function reporteDe(estacionCodigo: string): ReporteDiaDTO {
  return {
    estacionCodigo,
    fechaNegocio: '2026-08-22',
    cierreDiaId: 'a1b2c3d4-0000-0000-0000-000000000000',
    total: 1000,
    totalCombustible: 900,
    totalNoCombustible: 100,
    totalSinClasificar: 0,
    productos: [],
  };
}

function turnosDe(estacionCodigo: string): ReporteDiaTurnoDTO[] {
  return [
    {
      cierreTurnoId: `${estacionCodigo}-t1`,
      turno: 'TURNO1',
      empleado: 'Juan Pérez',
      fechaInicio: '2026-08-22T06:00:00.000Z',
      fecha: '2026-08-22T14:00:00.000Z',
      total: 400,
      productos: [],
    },
  ];
}

function estacionDe(estacionCodigo: string): ReporteDiaEstacionDocumentoDTO {
  return { reporte: reporteDe(estacionCodigo), turnos: turnosDe(estacionCodigo) };
}

class RepoFake implements ReporteDiaQueryRepository {
  public llamadasObtener: unknown[] = [];
  public llamadasListarTurnos: FiltrosReporteDia[] = [];
  public llamoListarActivas = false;
  constructor(
    private readonly reportesPorEstacion: Record<string, ReporteDiaDTO | null>,
    private readonly codigosActivos: string[] = [],
    private readonly turnosPorEstacion: Record<string, ReporteDiaTurnoDTO[]> = {}
  ) {}

  async obtener(filtros: FiltrosReporteDia): Promise<ReporteDiaDTO | null> {
    this.llamadasObtener.push(filtros);
    return this.reportesPorEstacion[filtros.estacionCodigo] ?? null;
  }

  async listarCodigosEstacionesActivas(): Promise<string[]> {
    this.llamoListarActivas = true;
    return this.codigosActivos;
  }

  async listarTurnos(filtros: FiltrosReporteDia): Promise<ReporteDiaTurnoDTO[]> {
    this.llamadasListarTurnos.push(filtros);
    return this.turnosPorEstacion[filtros.estacionCodigo] ?? turnosDe(filtros.estacionCodigo);
  }
}

class RendererFake implements ReporteDiaRendererPort {
  public ultimosDatos: ReporteDiaDocumentoDatos | undefined;
  async renderizarPdf(datos: ReporteDiaDocumentoDatos): Promise<Buffer> {
    this.ultimosDatos = datos;
    return Buffer.from('pdf-fake');
  }
}

class StorageFake implements DocumentoStoragePort {
  public ultimoKey: string | undefined;
  async subirYFirmar(params: { buffer: Buffer; key: string; contentType: string; expiraEnSegundos: number }) {
    this.ultimoKey = params.key;
    return { url: `https://s3.fake/${params.key}`, expiraEn: params.expiraEnSegundos };
  }
}

describe('ObtenerReporteDiaDocumento', () => {
  it('individual: usa estacionCodigo explícito, arma el PDF de una sola estación con su desglose por turno', async () => {
    const repo = new RepoFake({ CHANCAYLLO: reporteDe('CHANCAYLLO') });
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const caso = new ObtenerReporteDiaDocumento(repo, renderer, storage);

    const resultado = await caso.ejecutar(auth({ stationScope: '*' }), {
      estacionCodigo: 'CHANCAYLLO',
      fechaNegocio: '2026-08-22',
    });

    expect(resultado).toEqual({ url: expect.stringContaining('CHANCAYLLO'), tipo: 'application/pdf', expiraEn: 600 });
    expect(renderer.ultimosDatos).toEqual({ modo: 'individual', estacion: estacionDe('CHANCAYLLO') });
    expect(repo.llamadasListarTurnos).toEqual([{ estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-08-22' }]);
    expect(repo.llamoListarActivas).toBe(false);
  });

  it('individual: usa la estación única del token cuando no se manda estacionCodigo', async () => {
    const repo = new RepoFake({ CHANCAYLLO: reporteDe('CHANCAYLLO') });
    const caso = new ObtenerReporteDiaDocumento(repo, new RendererFake(), new StorageFake());

    const resultado = await caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { fechaNegocio: '2026-08-22' });

    expect(resultado.tipo).toBe('application/pdf');
    expect(repo.llamadasObtener).toEqual([{ estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-08-22' }]);
    expect(repo.llamadasListarTurnos).toEqual([{ estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-08-22' }]);
  });

  it('individual: 403 si el token no tiene acceso a la estación pedida', async () => {
    const repo = new RepoFake({ MALA: reporteDe('MALA') });
    const caso = new ObtenerReporteDiaDocumento(repo, new RendererFake(), new StorageFake());

    await expect(
      caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { estacionCodigo: 'MALA', fechaNegocio: '2026-08-22' })
    ).rejects.toThrow(AccesoDenegadoEstacionError);
    expect(repo.llamadasListarTurnos).toEqual([]);
  });

  it('individual: 404 si no hay cierre de día ACTIVO para esa estación/fecha (no llega a pedir los turnos)', async () => {
    const repo = new RepoFake({});
    const caso = new ObtenerReporteDiaDocumento(repo, new RendererFake(), new StorageFake());

    await expect(
      caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-08-22' })
    ).rejects.toThrow(RecursoNoEncontradoError);
    expect(repo.llamadasListarTurnos).toEqual([]);
  });

  it('consolidado: token wildcard sin estacionCodigo arma el PDF de todas las estaciones activas, cada una con su desglose por turno', async () => {
    const repo = new RepoFake(
      { CHANCAYLLO: reporteDe('CHANCAYLLO'), MALA: reporteDe('MALA'), ANDAHUASI: null },
      ['ANDAHUASI', 'CHANCAYLLO', 'MALA']
    );
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const caso = new ObtenerReporteDiaDocumento(repo, renderer, storage);

    const resultado = await caso.ejecutar(auth({ stationScope: '*' }), { fechaNegocio: '2026-08-22' });

    expect(resultado.tipo).toBe('application/pdf');
    expect(repo.llamoListarActivas).toBe(true);
    // ANDAHUASI no tenía cierre ese día -- se omite del consolidado, y por
    // eso tampoco se le pide el desglose por turno (evita una query de más).
    expect(renderer.ultimosDatos).toEqual({
      modo: 'consolidado',
      fechaNegocio: '2026-08-22',
      estaciones: [estacionDe('CHANCAYLLO'), estacionDe('MALA')],
    });
    expect(repo.llamadasListarTurnos.map((f) => f.estacionCodigo).sort()).toEqual(['CHANCAYLLO', 'MALA']);
    expect(storage.ultimoKey).toContain('consolidado');
  });

  it('consolidado: token multi-estación explícito (no wildcard) usa esa lista sin consultar todas las activas', async () => {
    const repo = new RepoFake({ CHANCAYLLO: reporteDe('CHANCAYLLO'), MALA: reporteDe('MALA') }, ['ANDAHUASI', 'CHANCAYLLO', 'MALA']);
    const renderer = new RendererFake();
    const caso = new ObtenerReporteDiaDocumento(repo, renderer, new StorageFake());

    await caso.ejecutar(auth({ stationScope: 'CHANCAYLLO,MALA' }), { fechaNegocio: '2026-08-22' });

    // No debe filtrar por ANDAHUASI -- el token no lo tenía en su lista, aunque esté "activa".
    expect(repo.llamoListarActivas).toBe(false);
    expect(renderer.ultimosDatos).toEqual({
      modo: 'consolidado',
      fechaNegocio: '2026-08-22',
      estaciones: [estacionDe('CHANCAYLLO'), estacionDe('MALA')],
    });
  });

  it('consolidado: 404 si ninguna estación del token tiene cierre ese día', async () => {
    const repo = new RepoFake({}, []);
    const caso = new ObtenerReporteDiaDocumento(repo, new RendererFake(), new StorageFake());

    await expect(caso.ejecutar(auth({ stationScope: '*' }), { fechaNegocio: '2026-08-22' })).rejects.toThrow(RecursoNoEncontradoError);
  });
});
