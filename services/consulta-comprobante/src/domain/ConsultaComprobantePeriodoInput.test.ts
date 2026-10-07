// domain/ConsultaComprobantePeriodoInput.test.ts
import { validarConsultaComprobantePeriodo, type ConsultaComprobantePeriodoInput } from './ConsultaComprobantePeriodoInput';
import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';

function inputValido(overrides: Partial<ConsultaComprobantePeriodoInput> = {}): ConsultaComprobantePeriodoInput {
  return {
    rucEmisor: '20123456789',
    numeroDocumentoReceptor: '10456789123',
    anio: '2026',
    mes: '10',
    ...overrides,
  };
}

describe('validarConsultaComprobantePeriodo', () => {
  it('acepta un periodo valido (sin individual) y lo normaliza', () => {
    const resultado = validarConsultaComprobantePeriodo(inputValido());
    expect(resultado).toEqual({
      rucEmisor: '20123456789',
      numeroDocumentoReceptor: '10456789123',
      anio: '2026',
      mes: '10',
    });
  });

  it('rechaza cuando falta rucEmisor', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ rucEmisor: undefined }))).toThrow(ParametrosInvalidosError);
  });

  it('rechaza un rucEmisor que no tiene 11 digitos', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ rucEmisor: '123' }))).toThrow(ParametrosInvalidosError);
  });

  it('rechaza cuando falta numeroDocumentoReceptor', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ numeroDocumentoReceptor: undefined }))).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza cuando falta anio', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ anio: undefined }))).toThrow(ParametrosInvalidosError);
  });

  it('rechaza un anio con formato invalido', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ anio: '26' }))).toThrow(ParametrosInvalidosError);
  });

  it('rechaza cuando falta mes -- no se permite listar el anio completo', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ mes: undefined }))).toThrow(ParametrosInvalidosError);
  });

  it('rechaza un mes fuera de 01-12', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ mes: '13' }))).toThrow(ParametrosInvalidosError);
  });

  it('acepta dia+serie+correlativo juntos y arma el lookup individual', () => {
    const resultado = validarConsultaComprobantePeriodo(inputValido({ dia: '15', serie: 'F001', correlativo: '000123' }));
    expect(resultado.individual).toEqual({ dia: '15', numeracion: 'F001-000123' });
  });

  it('rechaza cuando viene solo dia sin serie/correlativo', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ dia: '15' }))).toThrow(ParametrosInvalidosError);
  });

  it('rechaza cuando viene solo serie sin dia/correlativo', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ serie: 'F001' }))).toThrow(ParametrosInvalidosError);
  });

  it('rechaza un dia fuera de 01-31', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ dia: '32', serie: 'F001', correlativo: '123' }))).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza un correlativo no numerico', () => {
    expect(() => validarConsultaComprobantePeriodo(inputValido({ dia: '15', serie: 'F001', correlativo: 'abc' }))).toThrow(
      ParametrosInvalidosError
    );
  });
});
