// application/use-cases/ConsultarComprobante.test.ts
import { ConsultarComprobante } from './ConsultarComprobante';
import type { ComprobanteEncontradoDTO, ComprobanteLecturaRepository } from '../ports/ComprobanteLecturaRepository';
import { RecursoNoEncontradoError, ParametrosInvalidosError } from '@fuelhub/shared-kernel';

class RepoFake implements ComprobanteLecturaRepository {
  constructor(private readonly respuesta: ComprobanteEncontradoDTO | null) {}
  async buscar(): Promise<ComprobanteEncontradoDTO | null> {
    return this.respuesta;
  }
}

describe('ConsultarComprobante', () => {
  it('lanza RecursoNoEncontradoError cuando el repo no encuentra el PDF', async () => {
    const caso = new ConsultarComprobante(new RepoFake(null));
    await expect(caso.ejecutar({ ruc: '20123456789', numeracion: 'F001-000123' })).rejects.toThrow(RecursoNoEncontradoError);
  });

  it('lanza ParametrosInvalidosError antes de tocar el repo si el input es invalido', async () => {
    const caso = new ConsultarComprobante(new RepoFake(null));
    await expect(caso.ejecutar({ ruc: '123', numeracion: 'F001-000123' })).rejects.toThrow(ParametrosInvalidosError);
  });

  it('devuelve serie/correlativo/tipo descompuestos + URLs y metadata cuando existe', async () => {
    const encontrado: ComprobanteEncontradoDTO = {
      urlPdf: 'https://example.com/pdf',
      urlXml: undefined,
      urlCdr: undefined,
      expiraEnSegundos: 300,
      metadata: { fechaEmision: '2026-09-01', importeTotal: 125.5, moneda: 'PEN', estadoSunat: 'ACEPTADO' },
    };
    const caso = new ConsultarComprobante(new RepoFake(encontrado));

    const resultado = await caso.ejecutar({ ruc: '20123456789', numeracion: 'F001-000123' });

    expect(resultado).toEqual({
      ruc: '20123456789',
      numeracion: 'F001-000123',
      serie: 'F001',
      correlativo: '000123',
      tipoComprobante: 'FACTURA',
      urlPdf: 'https://example.com/pdf',
      urlXml: undefined,
      urlCdr: undefined,
      expiraEnSegundos: 300,
      fechaEmision: '2026-09-01',
      importeTotal: 125.5,
      moneda: 'PEN',
      estadoSunat: 'ACEPTADO',
    });
  });

  it('incluye urlXml/urlCdr cuando el repo los trae', async () => {
    const encontrado: ComprobanteEncontradoDTO = {
      urlPdf: 'https://example.com/pdf',
      urlXml: 'https://example.com/xml',
      urlCdr: 'https://example.com/cdr',
      expiraEnSegundos: 300,
      metadata: {},
    };
    const caso = new ConsultarComprobante(new RepoFake(encontrado));

    const resultado = await caso.ejecutar({ ruc: '20123456789', numeracion: 'B002-000045' });

    expect(resultado.urlXml).toBe('https://example.com/xml');
    expect(resultado.urlCdr).toBe('https://example.com/cdr');
    expect(resultado.tipoComprobante).toBe('BOLETA');
  });
});
