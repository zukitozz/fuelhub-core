// ObtenerReporteDiaDocumento.test.ts (v1.60)
//
// Cubre la rama nueva que no tiene ObtenerReporteDia: cuando no se manda
// estacionCodigo y el token no resuelve a una única estación, en vez de un
// 400 se arma el reporte CONSOLIDADO (todas las estaciones del token). Se
// prueba sin AWS real: repo/renderer/storage son fakes en memoria -- mismo
// criterio que ObtenerReporteDia.test.ts.

import { AccesoDenegadoEstacionError, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ObtenerReporteDiaDocumento } from './ObtenerReporteDiaDocumento';
import type { ReporteDiaDTO, ReporteDiaQueryRepository } from '../ports/ReporteDiaQueryRepository';
import type { DocumentoStoragePort, ReporteDiaDocumentoDatos, ReporteDiaRendererPort } from '../ports/ReporteDiaDocumentoPorts';

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

class RepoFake implements ReporteDiaQueryRepository {
  public llamadasObtener: unknown[] = [];
  public llamoListarActivas = false;
  constructor(
    private readonly reportesPorEstacion: Record<string, ReporteDiaDTO | null>,
    private readonly codigosActivos: string[] = []
  ) {}

  async obtener(filtros: { estacionCodigo: string; fechaNegocio: string }): Promise<ReporteDiaDTO | null> {
    this.llamadasObtener.push(filtros);
    return this.reportesPorEstacion[filtros.estacionCodigo] ?? null;
  }

  async listarCodigosEstacionesActivas(): Promise<string[]> {
    this.llamoListarActivas = true;
    return this.codigosActivos;
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
  it('individual: usa estacionCodigo explícito, arma el PDF de una sola estación', async () => {
    const repo = new RepoFake({ CHANCAYLLO: reporteDe('CHANCAYLLO') });
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const caso = new ObtenerReporteDiaDocumento(repo, renderer, storage);

    const resultado = await caso.ejecutar(auth({ stationScope: '*' }), {
      estacionCodigo: 'CHANCAYLLO',
      fechaNegocio: '2026-08-22',
    });

    expect(resultado).toEqual({ url: expect.stringContaining('CHANCAYLLO'), tipo: 'application/pdf', expiraEn: 600 });
    expect(renderer.ultimosDatos).toEqual({ modo: 'individual', reporte: reporteDe('CHANCAYLLO') });
    expect(repo.llamoListarActivas).toBe(false);
  });

  it('individual: usa la estación única del token cuando no se manda estacionCodigo', async () => {
    const repo = new RepoFake({ CHANCAYLLO: reporteDe('CHANCAYLLO') });
    const caso = new ObtenerReporteDiaDocumento(repo, new RendererFake(), new StorageFake());

    const resultado = await caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { fechaNegocio: '2026-08-22' });

    expect(resultado.tipo).toBe('application/pdf');
    expect(repo.llamadasObtener).toEqual([{ estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-08-22' }]);
  });

  it('individual: 403 si el token no tiene acceso a la estación pedida', async () => {
    const repo = new RepoFake({ MALA: reporteDe('MALA') });
    const caso = new ObtenerReporteDiaDocumento(repo, new RendererFake(), new StorageFake());

    await expect(
      caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { estacionCodigo: 'MALA', fechaNegocio: '2026-08-22' })
    ).rejects.toThrow(AccesoDenegadoEstacionError);
  });

  it('individual: 404 si no hay cierre de día ACTIVO para esa estación/fecha', async () => {
    const repo = new RepoFake({});
    const caso = new ObtenerReporteDiaDocumento(repo, new RendererFake(), new StorageFake());

    await expect(
      caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-08-22' })
    ).rejects.toThrow(RecursoNoEncontradoError);
  });

  it('consolidado: token wildcard sin estacionCodigo arma el PDF de todas las estaciones activas', async () => {
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
    // ANDAHUASI no tenía cierre ese día -- se omite del consolidado, no rompe nada.
    expect(renderer.ultimosDatos).toEqual({
      modo: 'consolidado',
      fechaNegocio: '2026-08-22',
      reportes: [reporteDe('CHANCAYLLO'), reporteDe('MALA')],
    });
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
      reportes: [reporteDe('CHANCAYLLO'), reporteDe('MALA')],
    });
  });

  it('consolidado: 404 si ninguna estación del token tiene cierre ese día', async () => {
    const repo = new RepoFake({}, []);
    const caso = new ObtenerReporteDiaDocumento(repo, new RendererFake(), new StorageFake());

    await expect(caso.ejecutar(auth({ stationScope: '*' }), { fechaNegocio: '2026-08-22' })).rejects.toThrow(RecursoNoEncontradoError);
  });
});
