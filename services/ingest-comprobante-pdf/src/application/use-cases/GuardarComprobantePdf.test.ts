// application/use-cases/GuardarComprobantePdf.test.ts
import { GuardarComprobantePdf } from './GuardarComprobantePdf';
import type { ComprobantePdfStorageRepository, ComprobantePdfGuardadoDTO } from '../ports/ComprobantePdfStorageRepository';
import { AccesoDenegadoEstacionError, type AuthContext } from '@fuelhub/shared-kernel';
import type { ComprobanteMetadata, ComprobantePdfInput } from '../../domain/ComprobantePdfInput';

function authDe(stationScope: string): AuthContext {
  return { clientId: 'test-client', role: 'SISTEMA_GRIFO', stationScope, scopes: ['fuelhub-api/cierres.write'] };
}

function inputValido(overrides: Partial<ComprobantePdfInput> = {}): ComprobantePdfInput {
  const pdf = Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
  return { codigoEstacion: 'CHANCAYLLO', ruc: '20123456789', contentBase64: pdf, ...overrides };
}

class RepoFake implements ComprobantePdfStorageRepository {
  readonly llamadas: Array<{ ruc: string; numeracion: string; buffer: Buffer; metadata: ComprobanteMetadata }> = [];

  async guardar(params: {
    ruc: string;
    numeracion: string;
    buffer: Buffer;
    metadata: ComprobanteMetadata;
  }): Promise<ComprobantePdfGuardadoDTO> {
    this.llamadas.push(params);
    return { key: `${params.ruc}/${params.numeracion}.pdf` };
  }
}

describe('GuardarComprobantePdf', () => {
  it('lanza AccesoDenegadoEstacionError cuando el token no tiene acceso a la estacion, sin llamar al repo', async () => {
    const repo = new RepoFake();
    const caso = new GuardarComprobantePdf(repo);

    await expect(
      caso.ejecutar(authDe('MALA'), 'F001-000123', inputValido({ codigoEstacion: 'CHANCAYLLO' }))
    ).rejects.toThrow(AccesoDenegadoEstacionError);
    expect(repo.llamadas).toHaveLength(0);
  });

  it('con payload valido y token autorizado, llama al repo con los bytes decodificados y devuelve la key', async () => {
    const repo = new RepoFake();
    const caso = new GuardarComprobantePdf(repo);

    const resultado = await caso.ejecutar(authDe('CHANCAYLLO'), 'F001-000123', inputValido());

    expect(repo.llamadas).toHaveLength(1);
    expect(repo.llamadas[0]?.ruc).toBe('20123456789');
    expect(repo.llamadas[0]?.numeracion).toBe('F001-000123');
    expect(repo.llamadas[0]?.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(resultado).toEqual({
      codigoEstacion: 'CHANCAYLLO',
      numeracion: 'F001-000123',
      key: '20123456789/F001-000123.pdf',
    });
  });

  it('token con acceso wildcard (*) pasa la autorizacion', async () => {
    const repo = new RepoFake();
    const caso = new GuardarComprobantePdf(repo);

    const resultado = await caso.ejecutar(authDe('*'), 'F001-000123', inputValido());
    expect(resultado.key).toBe('20123456789/F001-000123.pdf');
  });

  it('pasa la metadata opcional normalizada al repo cuando viene en el payload (v1.72)', async () => {
    const repo = new RepoFake();
    const caso = new GuardarComprobantePdf(repo);

    await caso.ejecutar(
      authDe('*'),
      'F001-000123',
      inputValido({ fechaEmision: '2026-09-10', importeTotal: 99.9, moneda: 'usd', estadoSunat: 'ACEPTADO' })
    );

    expect(repo.llamadas[0]?.metadata).toEqual({
      fechaEmision: '2026-09-10',
      importeTotal: 99.9,
      moneda: 'USD',
      estadoSunat: 'ACEPTADO',
    });
  });

  it('pasa metadata con todos los campos undefined cuando el payload no trae ninguno', async () => {
    const repo = new RepoFake();
    const caso = new GuardarComprobantePdf(repo);

    await caso.ejecutar(authDe('*'), 'F001-000123', inputValido());

    expect(repo.llamadas[0]?.metadata).toEqual({
      fechaEmision: undefined,
      importeTotal: undefined,
      moneda: undefined,
      estadoSunat: undefined,
    });
  });
});
