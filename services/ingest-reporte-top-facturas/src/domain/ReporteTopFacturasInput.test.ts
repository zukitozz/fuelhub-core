// domain/ReporteTopFacturasInput.test.ts
import { validarReporteTopFacturas, MAX_CLIENTES_TOP, type ReporteTopFacturasInput, type ClienteTopFacturasInput } from './ReporteTopFacturasInput';
import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';

function facturaValida(overrides: Partial<ReporteTopFacturasInput['top'][number]['facturas'][number]> = {}) {
  return {
    numeracion: 'F001-000123',
    fecha: '2026-10-07',
    monto: 350,
    despachadorNombre: 'Juan Perez',
    despachadorDocumento: '12345678',
    ...overrides,
  };
}

function clienteValido(overrides: Partial<ClienteTopFacturasInput> = {}): ClienteTopFacturasInput {
  return {
    numeroDocumentoCliente: '20123456789',
    nombreCliente: 'Transportes ABC SAC',
    totalSoles: 350,
    facturas: [facturaValida()],
    ...overrides,
  };
}

function inputValido(overrides: Partial<ReporteTopFacturasInput> = {}): ReporteTopFacturasInput {
  return {
    codigoEstacion: 'CHANCAYLLO',
    semanaInicio: '2026-10-06',
    top: [clienteValido()],
    ...overrides,
  };
}

describe('validarReporteTopFacturas', () => {
  it('no lanza con un payload valido', () => {
    expect(() => validarReporteTopFacturas(inputValido())).not.toThrow();
  });

  it('acepta top vacio (semana sin clientes destacados)', () => {
    expect(() => validarReporteTopFacturas(inputValido({ top: [] }))).not.toThrow();
  });

  it('rechaza cuando falta codigoEstacion', () => {
    expect(() => validarReporteTopFacturas(inputValido({ codigoEstacion: '' }))).toThrow(ParametrosInvalidosError);
  });

  it('rechaza cuando falta semanaInicio', () => {
    expect(() => validarReporteTopFacturas(inputValido({ semanaInicio: '' }))).toThrow(ParametrosInvalidosError);
  });

  it('rechaza semanaInicio con formato invalido', () => {
    expect(() => validarReporteTopFacturas(inputValido({ semanaInicio: '06/10/2026' }))).toThrow(ParametrosInvalidosError);
  });

  it('rechaza top con mas de MAX_CLIENTES_TOP clientes', () => {
    const top = Array.from({ length: MAX_CLIENTES_TOP + 1 }, (_, i) => clienteValido({ numeroDocumentoCliente: String(i).padStart(11, '0') }));
    expect(() => validarReporteTopFacturas(inputValido({ top }))).toThrow(ParametrosInvalidosError);
  });

  it('acepta top con exactamente MAX_CLIENTES_TOP clientes', () => {
    const top = Array.from({ length: MAX_CLIENTES_TOP }, (_, i) => clienteValido({ numeroDocumentoCliente: String(i).padStart(11, '0') }));
    expect(() => validarReporteTopFacturas(inputValido({ top }))).not.toThrow();
  });

  it('rechaza cuando falta numeroDocumentoCliente de un cliente', () => {
    expect(() => validarReporteTopFacturas(inputValido({ top: [clienteValido({ numeroDocumentoCliente: '' })] }))).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza cuando falta nombreCliente', () => {
    expect(() => validarReporteTopFacturas(inputValido({ top: [clienteValido({ nombreCliente: '' })] }))).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza totalSoles negativo', () => {
    expect(() => validarReporteTopFacturas(inputValido({ top: [clienteValido({ totalSoles: -1 })] }))).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza un cliente sin facturas', () => {
    expect(() => validarReporteTopFacturas(inputValido({ top: [clienteValido({ facturas: [] })] }))).toThrow(
      ParametrosInvalidosError
    );
  });

  it('rechaza cuando falta numeracion de una factura', () => {
    expect(() =>
      validarReporteTopFacturas(inputValido({ top: [clienteValido({ facturas: [facturaValida({ numeracion: '' })] })] }))
    ).toThrow(ParametrosInvalidosError);
  });

  it('rechaza fecha de factura con formato invalido', () => {
    expect(() =>
      validarReporteTopFacturas(inputValido({ top: [clienteValido({ facturas: [facturaValida({ fecha: '07/10/2026' })] })] }))
    ).toThrow(ParametrosInvalidosError);
  });

  it('rechaza monto de factura negativo', () => {
    expect(() =>
      validarReporteTopFacturas(inputValido({ top: [clienteValido({ facturas: [facturaValida({ monto: -1 })] })] }))
    ).toThrow(ParametrosInvalidosError);
  });

  it('rechaza cuando falta despachadorNombre', () => {
    expect(() =>
      validarReporteTopFacturas(inputValido({ top: [clienteValido({ facturas: [facturaValida({ despachadorNombre: '' })] })] }))
    ).toThrow(ParametrosInvalidosError);
  });

  it('rechaza despachadorDocumento que no tiene 8 digitos', () => {
    expect(() =>
      validarReporteTopFacturas(
        inputValido({ top: [clienteValido({ facturas: [facturaValida({ despachadorDocumento: '123' })] })] })
      )
    ).toThrow(ParametrosInvalidosError);
  });

  it('acumula errores de varios clientes/facturas en un solo throw', () => {
    const input = inputValido({
      top: [
        clienteValido({ nombreCliente: '' }),
        clienteValido({ numeroDocumentoCliente: '', facturas: [facturaValida({ despachadorDocumento: 'x' })] }),
      ],
    });

    expect(() => validarReporteTopFacturas(input)).toThrow(ParametrosInvalidosError);

    let detalles: readonly { field: string; issue: string }[] = [];
    try {
      validarReporteTopFacturas(input);
    } catch (err) {
      detalles = (err as InstanceType<typeof ParametrosInvalidosError>).details ?? [];
    }
    expect(detalles.length).toBeGreaterThanOrEqual(3);
  });
});
