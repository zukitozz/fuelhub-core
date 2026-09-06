// ObtenerCompra.test.ts (v1.67)
//
// Mismo criterio de test que ActualizarCompra.test.ts: fake del puerto, sin
// AWS. Cubre la autorización DESPUÉS de resolver el recurso (403 sobre la
// estación real de la compra encontrada, nunca sobre un dato de entrada) y
// el 404 cuando el id no existe.

import { AccesoDenegadoEstacionError, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ObtenerCompra } from './ObtenerCompra';
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
  constructor(private readonly existente: CompraOutputDTO | undefined) {}

  async registrar(_datos: DatosCompraAInsertar): Promise<CompraOutputDTO> {
    throw new Error('no usado en este test');
  }
  async obtenerPorId(): Promise<CompraOutputDTO | undefined> {
    return this.existente;
  }
  async actualizar(_id: string, _cambios: CambiosCompra): Promise<CompraOutputDTO> {
    throw new Error('no usado en este test');
  }
  async listar(_filtros: FiltrosCompra, _paginacion: ParametrosPaginacion): Promise<ResultadoPaginado<CompraResumenDTO>> {
    throw new Error('no usado en este test');
  }
}

describe('ObtenerCompra', () => {
  it('devuelve la compra cuando el token tiene acceso a su estación', async () => {
    const repo = new RepoFake(compraDeEjemplo());
    const useCase = new ObtenerCompra(repo);

    const resultado = await useCase.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), 'c1c1c1c1-0000-0000-0000-000000000000');

    expect(resultado.id).toBe('c1c1c1c1-0000-0000-0000-000000000000');
    expect(resultado.codigoEstacion).toBe('CHANCAYLLO');
  });

  it('rechaza con 403 cuando el token es de OTRA estación distinta a la de la compra', async () => {
    const repo = new RepoFake(compraDeEjemplo({ codigoEstacion: 'MALA' }));
    const useCase = new ObtenerCompra(repo);

    await expect(useCase.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), 'c1c1c1c1-0000-0000-0000-000000000000')).rejects.toThrow(
      AccesoDenegadoEstacionError
    );
  });

  it('rechaza con 404 cuando el id no existe', async () => {
    const repo = new RepoFake(undefined);
    const useCase = new ObtenerCompra(repo);

    await expect(useCase.ejecutar(auth(), 'no-existe')).rejects.toThrow(RecursoNoEncontradoError);
  });

  it('permite el acceso con un token de estación wildcard ("*")', async () => {
    const repo = new RepoFake(compraDeEjemplo({ codigoEstacion: 'PACHACUTEC' }));
    const useCase = new ObtenerCompra(repo);

    const resultado = await useCase.ejecutar(auth({ stationScope: '*' }), 'c1c1c1c1-0000-0000-0000-000000000000');

    expect(resultado.codigoEstacion).toBe('PACHACUTEC');
  });
});
