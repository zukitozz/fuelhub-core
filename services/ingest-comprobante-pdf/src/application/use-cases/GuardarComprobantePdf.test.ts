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
  return {
    codigoEstacion: 'CHANCAYLLO',
    ruc: '20123456789',
    numeroDocumentoReceptor: '10456789123',
    contentBase64: pdf,
    fechaEmision: '2026-09-10',
    ...overrides,
  };
}

class RepoFake implements ComprobantePdfStorageRepository {
  readonly llamadas: Array<{
    ruc: string;
    numeroDocumentoReceptor: string;
    fechaEmision: string;
    numeracion: string;
    buffer: Buffer;
    metadata: ComprobanteMetadata;
    xmlBuffer?: Buffer;
    cdrBuffer?: Buffer;
  }> = [];

  async guardar(params: {
    ruc: string;
    numeroDocumentoReceptor: string;
    fechaEmision: string;
    numeracion: string;
    buffer: Buffer;
    metadata: ComprobanteMetadata;
    xmlBuffer?: Buffer;
    cdrBuffer?: Buffer;
  }): Promise<ComprobantePdfGuardadoDTO> {
    this.llamadas.push(params);
    const [anio, mes, dia] = params.fechaEmision.split('-');
    const prefijo = `${params.ruc}/${params.numeroDocumentoReceptor}/${anio}/${mes}/${dia}/${params.numeracion}`;
    return {
      key: `${prefijo}.pdf`,
      keyXml: params.xmlBuffer ? `${prefijo}.xml` : undefined,
      keyCdr: params.cdrBuffer ? `${prefijo}-cdr.xml` : undefined,
    };
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
    expect(repo.llamadas[0]?.numeroDocumentoReceptor).toBe('10456789123');
    expect(repo.llamadas[0]?.fechaEmision).toBe('2026-09-10');
    expect(repo.llamadas[0]?.numeracion).toBe('F001-000123');
    expect(repo.llamadas[0]?.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(resultado).toEqual({
      codigoEstacion: 'CHANCAYLLO',
      numeracion: 'F001-000123',
      key: '20123456789/10456789123/2026/09/10/F001-000123.pdf',
    });
  });

  it('token con acceso wildcard (*) pasa la autorizacion', async () => {
    const repo = new RepoFake();
    const caso = new GuardarComprobantePdf(repo);

    const resultado = await caso.ejecutar(authDe('*'), 'F001-000123', inputValido());
    expect(resultado.key).toBe('20123456789/10456789123/2026/09/10/F001-000123.pdf');
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

  it('pasa metadata con solo fechaEmision (requerida desde v1.79) cuando el payload no trae los demas campos opcionales', async () => {
    const repo = new RepoFake();
    const caso = new GuardarComprobantePdf(repo);

    await caso.ejecutar(authDe('*'), 'F001-000123', inputValido());

    expect(repo.llamadas[0]?.metadata).toEqual({
      fechaEmision: '2026-09-10',
      importeTotal: undefined,
      moneda: undefined,
      estadoSunat: undefined,
    });
  });

  it('pasa xmlBuffer/cdrBuffer al repo y devuelve keyXml/keyCdr cuando el payload los trae (v1.89)', async () => {
    const repo = new RepoFake();
    const caso = new GuardarComprobantePdf(repo);
    const xml = Buffer.from('<Invoice></Invoice>').toString('base64');
    const cdr = Buffer.from('<ApplicationResponse></ApplicationResponse>').toString('base64');

    const resultado = await caso.ejecutar(authDe('*'), 'F001-000123', inputValido({ xmlBase64: xml, cdrBase64: cdr }));

    expect(repo.llamadas[0]?.xmlBuffer?.toString('utf-8')).toBe('<Invoice></Invoice>');
    expect(repo.llamadas[0]?.cdrBuffer?.toString('utf-8')).toBe('<ApplicationResponse></ApplicationResponse>');
    expect(resultado).toEqual({
      codigoEstacion: 'CHANCAYLLO',
      numeracion: 'F001-000123',
      key: '20123456789/10456789123/2026/09/10/F001-000123.pdf',
      keyXml: '20123456789/10456789123/2026/09/10/F001-000123.xml',
      keyCdr: '20123456789/10456789123/2026/09/10/F001-000123-cdr.xml',
    });
  });

  it('no pasa xmlBuffer/cdrBuffer al repo cuando el payload no los trae -- keyXml/keyCdr quedan undefined (v1.89)', async () => {
    const repo = new RepoFake();
    const caso = new GuardarComprobantePdf(repo);

    const resultado = await caso.ejecutar(authDe('*'), 'F001-000123', inputValido());

    expect(repo.llamadas[0]?.xmlBuffer).toBeUndefined();
    expect(repo.llamadas[0]?.cdrBuffer).toBeUndefined();
    expect(resultado.keyXml).toBeUndefined();
    expect(resultado.keyCdr).toBeUndefined();
  });
});
