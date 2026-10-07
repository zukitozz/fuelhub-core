// application/use-cases/ConsultarComprobantesPeriodo.test.ts
import { ConsultarComprobantesPeriodo } from './ConsultarComprobantesPeriodo';
import type {
  ComprobanteIndividualResultadoDTO,
  ComprobantePeriodoLecturaRepository,
  ComprobanteZipResultadoDTO,
} from '../ports/ComprobantePeriodoLecturaRepository';
import type { ConsultaComprobantePeriodoInput } from '../../domain/ConsultaComprobantePeriodoInput';
import { ParametrosInvalidosError, RecursoNoEncontradoError } from '@fuelhub/shared-kernel';

function inputValido(overrides: Partial<ConsultaComprobantePeriodoInput> = {}): ConsultaComprobantePeriodoInput {
  return { rucEmisor: '20123456789', numeroDocumentoReceptor: '10456789123', anio: '2026', mes: '10', ...overrides };
}

class RepoFake implements ComprobantePeriodoLecturaRepository {
  constructor(
    private readonly individual: ComprobanteIndividualResultadoDTO | null = null,
    private readonly masivo: ComprobanteZipResultadoDTO | null = null
  ) {}

  llamadasIndividual: unknown[] = [];
  llamadasMasivo: unknown[] = [];

  async buscarIndividual(params: unknown) {
    this.llamadasIndividual.push(params);
    return this.individual;
  }

  async buscarMasivo(params: unknown) {
    this.llamadasMasivo.push(params);
    return this.masivo;
  }
}

describe('ConsultarComprobantesPeriodo', () => {
  it('modo masivo: devuelve la url del zip y la cantidad cuando el repo encuentra comprobantes', async () => {
    const repo = new RepoFake(null, { url: 'https://s3/fake.zip', expiraEnSegundos: 300, cantidad: 12 });
    const caso = new ConsultarComprobantesPeriodo(repo);

    const resultado = await caso.ejecutar(inputValido());

    expect(resultado).toEqual({ modo: 'masivo', url: 'https://s3/fake.zip', expiraEnSegundos: 300, cantidad: 12 });
    expect(repo.llamadasMasivo).toEqual([
      { rucEmisor: '20123456789', numeroDocumentoReceptor: '10456789123', anio: '2026', mes: '10' },
    ]);
    expect(repo.llamadasIndividual).toHaveLength(0);
  });

  it('modo masivo: 404 cuando el repo no encuentra ningun comprobante en el periodo', async () => {
    const repo = new RepoFake(null, null);
    const caso = new ConsultarComprobantesPeriodo(repo);

    await expect(caso.ejecutar(inputValido())).rejects.toThrow(RecursoNoEncontradoError);
  });

  it('modo individual: devuelve la url del PDF cuando dia+serie+correlativo vienen juntos', async () => {
    const repo = new RepoFake({ url: 'https://s3/fake.pdf', expiraEnSegundos: 300 }, null);
    const caso = new ConsultarComprobantesPeriodo(repo);

    const resultado = await caso.ejecutar(inputValido({ dia: '15', serie: 'F001', correlativo: '000123' }));

    expect(resultado).toEqual({ modo: 'individual', url: 'https://s3/fake.pdf', expiraEnSegundos: 300 });
    expect(repo.llamadasIndividual).toEqual([
      {
        rucEmisor: '20123456789',
        numeroDocumentoReceptor: '10456789123',
        anio: '2026',
        mes: '10',
        dia: '15',
        numeracion: 'F001-000123',
      },
    ]);
    expect(repo.llamadasMasivo).toHaveLength(0);
  });

  it('modo individual: 404 cuando el repo no encuentra el PDF puntual', async () => {
    const repo = new RepoFake(null, null);
    const caso = new ConsultarComprobantesPeriodo(repo);

    await expect(caso.ejecutar(inputValido({ dia: '15', serie: 'F001', correlativo: '000123' }))).rejects.toThrow(
      RecursoNoEncontradoError
    );
  });

  it('propaga ParametrosInvalidosError de la validacion de dominio sin llamar al repo', async () => {
    const repo = new RepoFake();
    const caso = new ConsultarComprobantesPeriodo(repo);

    await expect(caso.ejecutar(inputValido({ mes: undefined }))).rejects.toThrow(ParametrosInvalidosError);
    expect(repo.llamadasMasivo).toHaveLength(0);
    expect(repo.llamadasIndividual).toHaveLength(0);
  });
});
