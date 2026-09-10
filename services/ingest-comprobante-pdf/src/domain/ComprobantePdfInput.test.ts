// domain/ComprobantePdfInput.test.ts
import { validarYDecodificarComprobantePdf, MAX_PDF_BYTES, type ComprobantePdfInput } from './ComprobantePdfInput';
import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';

function pdfBase64(bytesExtra = 0): string {
  const header = Buffer.from('%PDF-1.4\n%%EOF');
  const relleno = Buffer.alloc(bytesExtra, 0x41);
  return Buffer.concat([header, relleno]).toString('base64');
}

function inputValido(overrides: Partial<ComprobantePdfInput> = {}): ComprobantePdfInput {
  return {
    codigoEstacion: 'CHANCAYLLO',
    ruc: '20123456789',
    contentBase64: pdfBase64(),
    ...overrides,
  };
}

describe('validarYDecodificarComprobantePdf', () => {
  it('no lanza con un payload valido y devuelve el buffer decodificado', () => {
    const { buffer } = validarYDecodificarComprobantePdf(inputValido(), 'F001-000123');
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('devuelve metadata vacia cuando no se manda ninguno de los campos opcionales', () => {
    const { metadata } = validarYDecodificarComprobantePdf(inputValido(), 'F001-000123');
    expect(metadata).toEqual({
      fechaEmision: undefined,
      importeTotal: undefined,
      moneda: undefined,
      estadoSunat: undefined,
    });
  });

  it('rechaza cuando falta numeracion (path)', () => {
    expect(() => validarYDecodificarComprobantePdf(inputValido(), undefined)).toThrow(ParametrosInvalidosError);
    expect(() => validarYDecodificarComprobantePdf(inputValido(), '   ')).toThrow(ParametrosInvalidosError);
  });

  it('rechaza cuando falta codigoEstacion', () => {
    expect(() => validarYDecodificarComprobantePdf(inputValido({ codigoEstacion: '' }), 'F001-000123')).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza cuando falta ruc', () => {
    expect(() => validarYDecodificarComprobantePdf(inputValido({ ruc: '' }), 'F001-000123')).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza un ruc que no tiene 11 digitos', () => {
    expect(() => validarYDecodificarComprobantePdf(inputValido({ ruc: '12345' }), 'F001-000123')).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza cuando falta contentBase64', () => {
    expect(() => validarYDecodificarComprobantePdf(inputValido({ contentBase64: '' }), 'F001-000123')).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza cuando el base64 decodifica a un buffer vacio', () => {
    expect(() => validarYDecodificarComprobantePdf(inputValido({ contentBase64: '====' }), 'F001-000123')).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza contentBase64 que no decodifica a un PDF (no empieza con %PDF-)', () => {
    const basura = Buffer.from('esto no es un pdf').toString('base64');
    expect(() => validarYDecodificarComprobantePdf(inputValido({ contentBase64: basura }), 'F001-000123')).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza un buffer que excede MAX_PDF_BYTES', () => {
    const grande = pdfBase64(MAX_PDF_BYTES);
    expect(() => validarYDecodificarComprobantePdf(inputValido({ contentBase64: grande }), 'F001-000123')).toThrow(
      ParametrosInvalidosError
    );
  });

  it('acepta un buffer justo en el limite de MAX_PDF_BYTES', () => {
    const header = Buffer.from('%PDF-');
    const relleno = Buffer.alloc(MAX_PDF_BYTES - header.length, 0x41);
    const exacto = Buffer.concat([header, relleno]).toString('base64');
    expect(() => validarYDecodificarComprobantePdf(inputValido({ contentBase64: exacto }), 'F001-000123')).not.toThrow();
  });

  it('acepta y normaliza los 4 campos de metadata opcional cuando vienen validos (v1.72)', () => {
    const { metadata } = validarYDecodificarComprobantePdf(
      inputValido({ fechaEmision: '2026-09-10', importeTotal: 125.5, moneda: 'pen', estadoSunat: '  ACEPTADO  ' }),
      'F001-000123'
    );
    expect(metadata).toEqual({
      fechaEmision: '2026-09-10',
      importeTotal: 125.5,
      moneda: 'PEN',
      estadoSunat: 'ACEPTADO',
    });
  });

  it('rechaza fechaEmision con formato invalido (v1.72)', () => {
    expect(() =>
      validarYDecodificarComprobantePdf(inputValido({ fechaEmision: '10/09/2026' }), 'F001-000123')
    ).toThrow(ParametrosInvalidosError);
  });

  it('rechaza importeTotal negativo (v1.72)', () => {
    expect(() => validarYDecodificarComprobantePdf(inputValido({ importeTotal: -1 }), 'F001-000123')).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza moneda que no sea PEN/USD (v1.72)', () => {
    expect(() => validarYDecodificarComprobantePdf(inputValido({ moneda: 'EUR' }), 'F001-000123')).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza estadoSunat vacio si se manda explicitamente (v1.72)', () => {
    expect(() => validarYDecodificarComprobantePdf(inputValido({ estadoSunat: '   ' }), 'F001-000123')).toThrow(
      ParametrosInvalidosError
    );
  });
});
