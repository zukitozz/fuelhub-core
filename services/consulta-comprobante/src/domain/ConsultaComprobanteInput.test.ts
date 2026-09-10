// domain/ConsultaComprobanteInput.test.ts
import { validarConsultaComprobante } from './ConsultaComprobanteInput';
import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';

describe('validarConsultaComprobante', () => {
  it('descompone numeracion y ruc validos, infiriendo tipoComprobante FACTURA', () => {
    const resultado = validarConsultaComprobante({ ruc: '20123456789', numeracion: 'F001-000123' });
    expect(resultado).toEqual({
      ruc: '20123456789',
      numeracion: 'F001-000123',
      descompuesta: { serie: 'F001', correlativo: '000123', tipoComprobante: 'FACTURA' },
    });
  });

  it('infiere BOLETA cuando la serie empieza con B', () => {
    const resultado = validarConsultaComprobante({ ruc: '20123456789', numeracion: 'B002-000045' });
    expect(resultado.descompuesta.tipoComprobante).toBe('BOLETA');
  });

  it('infiere DESCONOCIDO cuando la serie no empieza con F ni B', () => {
    const resultado = validarConsultaComprobante({ ruc: '20123456789', numeracion: 'T001-000001' });
    expect(resultado.descompuesta.tipoComprobante).toBe('DESCONOCIDO');
  });

  it('rechaza cuando falta ruc', () => {
    expect(() => validarConsultaComprobante({ ruc: undefined, numeracion: 'F001-000123' })).toThrow(ParametrosInvalidosError);
  });

  it('rechaza un ruc que no tiene 11 digitos', () => {
    expect(() => validarConsultaComprobante({ ruc: '12345', numeracion: 'F001-000123' })).toThrow(ParametrosInvalidosError);
  });

  it('rechaza cuando falta numeracion', () => {
    expect(() => validarConsultaComprobante({ ruc: '20123456789', numeracion: undefined })).toThrow(ParametrosInvalidosError);
  });

  it('rechaza numeracion sin guion', () => {
    expect(() => validarConsultaComprobante({ ruc: '20123456789', numeracion: 'F001000123' })).toThrow(ParametrosInvalidosError);
  });
});
