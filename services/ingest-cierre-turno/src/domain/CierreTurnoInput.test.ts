// CierreTurnoInput.test.ts — `npm run test:unit` (sección 7/12.6, v1.50).
//
// Cubre `validarCierreTurno` (sección 3.9), la validación puramente
// estructural, sin ningún import de AWS ni de infraestructura.

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import { validarCierreTurno, type CierreTurnoInput } from './CierreTurnoInput';

function inputValido(overrides: Partial<CierreTurnoInput> = {}): CierreTurnoInput {
  return {
    codigoEstacion: 'CHANCAYLLO',
    turno: 'TURNO1',
    fechaNegocio: '2026-08-22',
    fechaInicio: '2026-08-22T06:00:00-05:00',
    fecha: '2026-08-22T14:00:00-05:00',
    total: 500,
    empleado: { codigo: 'OP001', nombre: 'Juan Pérez' },
    pagos: [{ medio: 'EFECTIVO', monto: 500 }],
    detalle: [{ producto: 'Diésel', codigoLocal: 'DSL', totalCantidad: 100, totalSoles: 500 }],
    ...overrides,
  };
}

function detalles(fn: () => void): { field: string; issue: string }[] {
  try {
    fn();
    return [];
  } catch (err) {
    if (err instanceof ParametrosInvalidosError) return [...(err.details ?? [])];
    throw err;
  }
}

describe('validarCierreTurno', () => {
  it('no lanza con un payload completo y válido', () => {
    expect(() => validarCierreTurno(inputValido())).not.toThrow();
  });

  it('rechaza un turno fuera del catálogo cerrado (sección 3.4)', () => {
    const campos = detalles(() => validarCierreTurno(inputValido({ turno: 'TURNO 1' })));
    expect(campos).toContainEqual({ field: 'turno', issue: 'debe ser uno de: TURNO1, TURNO2, TURNO3' });
  });

  it('rechaza fecha <= fechaInicio (sección 3.4.2 — CHECK (fecha > fecha_inicio) del DDL)', () => {
    const campos = detalles(() =>
      validarCierreTurno(inputValido({ fechaInicio: '2026-08-22T14:00:00-05:00', fecha: '2026-08-22T06:00:00-05:00' }))
    );
    expect(campos).toContainEqual({ field: 'fecha', issue: 'debe ser posterior a fechaInicio' });
  });

  it('rechaza fechas no parseables', () => {
    const campos = detalles(() => validarCierreTurno(inputValido({ fecha: 'no-es-una-fecha' })));
    expect(campos).toContainEqual({ field: 'fecha', issue: 'fecha/hora inválida' });
  });

  it('exige al menos un medio de pago', () => {
    const campos = detalles(() => validarCierreTurno(inputValido({ pagos: [] })));
    expect(campos).toContainEqual({ field: 'pagos', issue: 'debe traer al menos un medio de pago' });
  });

  it('exige al menos una línea de detalle', () => {
    const campos = detalles(() => validarCierreTurno(inputValido({ detalle: [] })));
    expect(campos).toContainEqual({ field: 'detalle', issue: 'debe traer al menos una línea de producto' });
  });

  it('exige productoId o codigoLocal en cada línea (sección 3.8.1.1)', () => {
    const campos = detalles(() =>
      validarCierreTurno(
        inputValido({
          detalle: [{ producto: 'Balón de gas', totalCantidad: 2, totalSoles: 40 }],
        })
      )
    );
    expect(campos).toContainEqual({ field: 'detalle[0].codigoLocal', issue: 'requerido cuando no se envía productoId' });
  });

  it('acepta una línea con productoId y sin codigoLocal (catálogo cruzado)', () => {
    expect(() =>
      validarCierreTurno(
        inputValido({
          detalle: [
            {
              productoId: 'f7ec806f-0e5c-4949-8110-b48469fd3ecf',
              producto: 'Diésel',
              totalCantidad: 100,
              totalSoles: 500,
            },
          ],
        })
      )
    ).not.toThrow();
  });

  it('exige empleado.codigo y empleado.nombre no vacíos', () => {
    const campos = detalles(() => validarCierreTurno(inputValido({ empleado: { codigo: '  ', nombre: '' } })));
    expect(campos).toContainEqual({ field: 'empleado.codigo', issue: 'requerido' });
    expect(campos).toContainEqual({ field: 'empleado.nombre', issue: 'requerido' });
  });

  it('rechaza total negativo', () => {
    const campos = detalles(() => validarCierreTurno(inputValido({ total: -1 })));
    expect(campos).toContainEqual({ field: 'total', issue: 'debe ser un número >= 0' });
  });

  it('rechaza facturasEmitidas no entero o negativo cuando viene', () => {
    const campos = detalles(() => validarCierreTurno(inputValido({ facturasEmitidas: -3 })));
    expect(campos).toContainEqual({ field: 'facturasEmitidas', issue: 'debe ser un entero >= 0' });
  });

  it('acumula todos los errores encontrados en un solo throw, no solo el primero', () => {
    const campos = detalles(() => validarCierreTurno(inputValido({ turno: 'X', pagos: [], detalle: [] })));
    expect(campos.length).toBeGreaterThanOrEqual(3);
  });
});
