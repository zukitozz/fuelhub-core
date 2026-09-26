// ListarCompras.test.ts (v1.67)
//
// Mismo criterio de test que ListarCierresTurno (consulta-cierres): fake del
// puerto, sin AWS. Cubre la resolución de `estacionCodigo` por defecto desde
// el token de una sola estación, la autorización cuando se manda un código
// explícito, que `estado` ya NO tiene default implícito (v1.82.2 -- sin el
// parámetro, retorna cualquier estado), la validación de `categoria`, y que
// la paginación devuelta se recalcula con el `totalItems` real del repositorio.

import { AccesoDenegadoEstacionError, ParametrosInvalidosError, type AuthContext } from '@fuelhub/shared-kernel';
import { ListarCompras } from './ListarCompras';
import type {
  CambiosCompra,
  CompraIngestaRepository,
  CompraOutputDTO,
  CompraResumenDTO,
  DatosCompraAInsertar,
  FiltrosCompra,
} from '../ports/CompraIngestaRepository';
import type { ParametrosPaginacion, ResultadoPaginado } from '../../domain/value-objects/Paginacion';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return { clientId: 'test-client', role: 'SISTEMA_GRIFO', stationScope: 'CHANCAYLLO', scopes: [], ...overrides };
}

class RepoFake implements CompraIngestaRepository {
  public filtrosRecibidos: FiltrosCompra | undefined;
  public paginacionRecibida: ParametrosPaginacion | undefined;
  constructor(private readonly totalItems = 0) {}

  async registrar(_datos: DatosCompraAInsertar): Promise<CompraOutputDTO> {
    throw new Error('no usado en este test');
  }
  async obtenerPorId(): Promise<CompraOutputDTO | undefined> {
    throw new Error('no usado en este test');
  }
  async actualizar(_id: string, _cambios: CambiosCompra): Promise<CompraOutputDTO> {
    throw new Error('no usado en este test');
  }
  async listar(filtros: FiltrosCompra, paginacion: ParametrosPaginacion): Promise<ResultadoPaginado<CompraResumenDTO>> {
    this.filtrosRecibidos = filtros;
    this.paginacionRecibida = paginacion;
    return { data: [], pagination: { page: paginacion.page, pageSize: paginacion.pageSize, totalItems: this.totalItems, totalPages: 1 } };
  }
}

describe('ListarCompras', () => {
  it('usa la estación única del token cuando no se manda estacionCodigo', async () => {
    const repo = new RepoFake();
    const useCase = new ListarCompras(repo);

    await useCase.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), {});

    expect(repo.filtrosRecibidos?.estacionCodigo).toBe('CHANCAYLLO');
  });

  it('acepta un estacionCodigo explícito autorizado por el token', async () => {
    const repo = new RepoFake();
    const useCase = new ListarCompras(repo);

    await useCase.ejecutar(auth({ stationScope: '*' }), { estacionCodigo: 'PACHACUTEC' });

    expect(repo.filtrosRecibidos?.estacionCodigo).toBe('PACHACUTEC');
  });

  it('rechaza con 403 un estacionCodigo fuera del station_scope del token', async () => {
    const repo = new RepoFake();
    const useCase = new ListarCompras(repo);

    await expect(useCase.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { estacionCodigo: 'MALA' })).rejects.toThrow(
      AccesoDenegadoEstacionError
    );
  });

  it('sin estado explícito, no filtra por estado -- retorna cualquiera (v1.82.2, ya no hay default ACTIVO)', async () => {
    const repo = new RepoFake();
    const useCase = new ListarCompras(repo);

    await useCase.ejecutar(auth(), {});

    expect(repo.filtrosRecibidos?.estado).toBeUndefined();
  });

  it('rechaza con 400 un estado inválido', async () => {
    const repo = new RepoFake();
    const useCase = new ListarCompras(repo);

    await expect(useCase.ejecutar(auth(), { estado: 'BORRADO' })).rejects.toThrow(ParametrosInvalidosError);
  });

  it('acepta PENDIENTE_REVISION -- v1.81, lo que el Lambda de correo deja para que Jorge revise', async () => {
    const repo = new RepoFake();
    const useCase = new ListarCompras(repo);

    await useCase.ejecutar(auth(), { estado: 'PENDIENTE_REVISION' });

    expect(repo.filtrosRecibidos?.estado).toBe('PENDIENTE_REVISION');
  });

  it('rechaza con 400 una categoria inválida', async () => {
    const repo = new RepoFake();
    const useCase = new ListarCompras(repo);

    await expect(useCase.ejecutar(auth(), { categoria: 'LUBRICANTE' })).rejects.toThrow(ParametrosInvalidosError);
  });

  it('recalcula totalPages a partir del totalItems real del repositorio', async () => {
    const repo = new RepoFake(45);
    const useCase = new ListarCompras(repo);

    const resultado = await useCase.ejecutar(auth(), { pageSize: '20' });

    expect(resultado.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 45, totalPages: 3 });
  });
});
