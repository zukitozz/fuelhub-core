// ActualizarCompra.test.ts (v1.66)
//
// Cubre la autorización por estación (403 sobre la estación REAL de la
// compra encontrada, nunca sobre un dato del body) y el 404 cuando el `id`
// no existe -- con un fake del puerto, sin AWS. La validación estructural
// del payload (`validarCompraUpdate`) ya se cubre en
// `CompraUpdateInput.test.ts`; acá solo se confirma que este caso de uso la
// invoca antes de tocar el repositorio.

import { AccesoDenegadoEstacionError, ParametrosInvalidosError, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ActualizarCompra } from './ActualizarCompra';
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

function compraDeEjemplo(overrides: Partial<CompraOutputDTO> = {}): CompraOutputDTO {
  return {
    id: 'c1c1c1c1-0000-0000-0000-000000000000',
    codigoEstacion: 'CHANCAYLLO',
    productoId: 'f7ec806f-0e5c-4949-8110-b48469fd3ecf',
    productoNombre: 'Diésel',
    categoria: 'COMBUSTIBLE',
    proveedor: 'Petroperú',
    fecha: '2026-09-02T10:00:00-05:00',
    cantidad: 3000,
    costoUnitario: 14.25,
    costoTotal: 42750,
    numeroGuia: 'T001-000123',
    destinos: [],
    merma: null,
    estado: 'ACTIVO',
    creadoEn: '2026-09-02T10:00:05-05:00',
    ...overrides,
  };
}

class RepoFake implements CompraIngestaRepository {
  public idActualizado: string | undefined;
  public cambiosRecibidos: CambiosCompra | undefined;
  constructor(private readonly existente: CompraOutputDTO | undefined) {}

  async registrar(_datos: DatosCompraAInsertar): Promise<CompraOutputDTO> {
    throw new Error('no usado en este test');
  }
  async obtenerPorId(): Promise<CompraOutputDTO | undefined> {
    return this.existente;
  }
  async actualizar(id: string, cambios: CambiosCompra): Promise<CompraOutputDTO> {
    this.idActualizado = id;
    this.cambiosRecibidos = cambios;
    return { ...(this.existente as CompraOutputDTO), ...cambios } as CompraOutputDTO;
  }
  async listar(_filtros: FiltrosCompra, _paginacion: ParametrosPaginacion): Promise<ResultadoPaginado<CompraResumenDTO>> {
    throw new Error('no usado en este test');
  }
}

describe('ActualizarCompra', () => {
  it('llama al repositorio cuando el token tiene acceso a la estación de la compra', async () => {
    const repo = new RepoFake(compraDeEjemplo());
    const useCase = new ActualizarCompra(repo);

    await useCase.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), 'c1c1c1c1-0000-0000-0000-000000000000', { proveedor: 'Otro proveedor' });

    expect(repo.idActualizado).toBe('c1c1c1c1-0000-0000-0000-000000000000');
    expect(repo.cambiosRecibidos).toEqual({ proveedor: 'Otro proveedor' });
  });

  it('rechaza con 403 cuando el token es de OTRA estación distinta a la de la compra', async () => {
    const repo = new RepoFake(compraDeEjemplo({ codigoEstacion: 'MALA' }));
    const useCase = new ActualizarCompra(repo);

    await expect(
      useCase.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), 'c1c1c1c1-0000-0000-0000-000000000000', { proveedor: 'x' })
    ).rejects.toThrow(AccesoDenegadoEstacionError);
    expect(repo.idActualizado).toBeUndefined();
  });

  it('rechaza con 404 cuando el id no existe', async () => {
    const repo = new RepoFake(undefined);
    const useCase = new ActualizarCompra(repo);

    await expect(useCase.ejecutar(auth(), 'no-existe', { proveedor: 'x' })).rejects.toThrow(RecursoNoEncontradoError);
  });

  it('rechaza con 400 un payload vacío, antes de tocar el repositorio', async () => {
    const repo = new RepoFake(compraDeEjemplo());
    const useCase = new ActualizarCompra(repo);

    await expect(useCase.ejecutar(auth(), 'c1c1c1c1-0000-0000-0000-000000000000', {})).rejects.toThrow(ParametrosInvalidosError);
    expect(repo.idActualizado).toBeUndefined();
  });
});
