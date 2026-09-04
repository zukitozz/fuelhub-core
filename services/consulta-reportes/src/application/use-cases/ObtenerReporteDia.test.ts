// ObtenerReporteDia.test.ts (v1.58)
//
// Este Lambda no tenía tests de casos de uso hasta ahora (`ObtenerReporteMargen`/
// `ObtenerReporteAbastecimiento` solo se cubren indirectamente por los
// `.integration.test.ts` de sus repositorios). Se agrega este archivo porque
// `ObtenerReporteDia` tiene una rama nueva que ninguno de los otros dos
// reportes tiene: `estacionCodigo` es condicionalmente OBLIGATORIO (400, no
// "sin filtro") — vale la pena fijarla con un test de dominio, sin AWS.

import { AccesoDenegadoEstacionError, ParametrosInvalidosError, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ObtenerReporteDia } from './ObtenerReporteDia';
import type { ReporteDiaDTO, ReporteDiaQueryRepository } from '../ports/ReporteDiaQueryRepository';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return { clientId: 'test-client', role: 'SISTEMA_GRIFO', stationScope: 'CHANCAYLLO', scopes: [], ...overrides };
}

function reporteDeEjemplo(): ReporteDiaDTO {
  return {
    estacionCodigo: 'CHANCAYLLO',
    fechaNegocio: '2026-08-22',
    cierreDiaId: 'a1b2c3d4-0000-0000-0000-000000000000',
    total: 4820.5,
    totalCombustible: 4500,
    totalNoCombustible: 320.5,
    totalSinClasificar: 0,
    productos: [],
  };
}

class RepoFake implements ReporteDiaQueryRepository {
  public ultimosFiltros: unknown;
  constructor(private readonly resultado: ReporteDiaDTO | null) {}
  async obtener(filtros: { estacionCodigo: string; fechaNegocio: string }): Promise<ReporteDiaDTO | null> {
    this.ultimosFiltros = filtros;
    return this.resultado;
  }
  // No lo usa ninguno de los tests de este archivo (todos son de estación
  // única) -- agregado solo para satisfacer la interfaz desde que
  // ObtenerReporteDiaDocumento (v1.60) la necesita. Ver
  // ObtenerReporteDiaDocumento.test.ts para los tests que sí la ejercitan.
  async listarCodigosEstacionesActivas(): Promise<string[]> {
    return [];
  }
}

describe('ObtenerReporteDia', () => {
  it('usa la estación única del token cuando no se manda estacionCodigo', async () => {
    const repo = new RepoFake(reporteDeEjemplo());
    const caso = new ObtenerReporteDia(repo);

    const resultado = await caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { fechaNegocio: '2026-08-22' });

    expect(resultado).toEqual(reporteDeEjemplo());
    expect(repo.ultimosFiltros).toEqual({ estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-08-22' });
  });

  it('rechaza con 400 cuando el token es multi-estación y no se manda estacionCodigo', async () => {
    const repo = new RepoFake(reporteDeEjemplo());
    const caso = new ObtenerReporteDia(repo);

    await expect(caso.ejecutar(auth({ stationScope: 'CHANCAYLLO,MALA' }), { fechaNegocio: '2026-08-22' })).rejects.toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza con 400 cuando el token es wildcard y no se manda estacionCodigo', async () => {
    const repo = new RepoFake(reporteDeEjemplo());
    const caso = new ObtenerReporteDia(repo);

    await expect(caso.ejecutar(auth({ stationScope: '*' }), { fechaNegocio: '2026-08-22' })).rejects.toThrow(ParametrosInvalidosError);
  });

  it('un token wildcard SÍ puede pedir una estación puntual por query', async () => {
    const repo = new RepoFake(reporteDeEjemplo());
    const caso = new ObtenerReporteDia(repo);

    const resultado = await caso.ejecutar(auth({ stationScope: '*' }), { estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-08-22' });

    expect(resultado.estacionCodigo).toBe('CHANCAYLLO');
  });

  it('rechaza con 403 cuando se pide una estación fuera del alcance del token', async () => {
    const repo = new RepoFake(reporteDeEjemplo());
    const caso = new ObtenerReporteDia(repo);

    await expect(
      caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { estacionCodigo: 'MALA', fechaNegocio: '2026-08-22' })
    ).rejects.toThrow(AccesoDenegadoEstacionError);
  });

  it('rechaza con 400 cuando falta fechaNegocio', async () => {
    const repo = new RepoFake(reporteDeEjemplo());
    const caso = new ObtenerReporteDia(repo);

    await expect(caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), {})).rejects.toThrow(ParametrosInvalidosError);
  });

  it('mapea "sin cierre de día para esa estación/fecha" a RecursoNoEncontradoError (404)', async () => {
    const repo = new RepoFake(null);
    const caso = new ObtenerReporteDia(repo);

    await expect(caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { fechaNegocio: '2026-08-22' })).rejects.toThrow(
      RecursoNoEncontradoError
    );
  });
});
