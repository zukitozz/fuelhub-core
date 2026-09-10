// CompraInput.test.ts — `npm run test:unit` (sección 7/12.6, v1.65).
//
// Cubre `validarCompra`, la validación puramente estructural, sin ningún
// import de AWS ni de infraestructura.

import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import { validarCompra, type CompraInput } from './CompraInput';

function inputValido(overrides: Partial<CompraInput> = {}): CompraInput {
  return {
    codigoEstacion: 'CHANCAYLLO',
    productoId: 'f7ec806f-0e5c-4949-8110-b48469fd3ecf',
    fecha: '2026-09-06T08:00:00-05:00',
    cantidad: 500,
    costoUnitario: 13.25,
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

describe('validarCompra', () => {
  it('no lanza con un payload de combustible válido (con productoId)', () => {
    expect(() => validarCompra(inputValido())).not.toThrow();
  });

  it('no lanza con un payload de mercadería válido (sin productoId, con productoNombre/categoria)', () => {
    expect(() =>
      validarCompra(
        inputValido({ productoId: undefined, productoNombre: 'Galletas surtidas', categoria: 'NO_COMBUSTIBLE' })
      )
    ).not.toThrow();
  });

  it('exige productoNombre cuando no se manda productoId (v1.65)', () => {
    const campos = detalles(() => validarCompra(inputValido({ productoId: undefined, categoria: 'NO_COMBUSTIBLE' })));
    expect(campos).toContainEqual({
      field: 'productoNombre',
      issue: 'requerido cuando no se manda productoId -- compra fuera del catálogo cruzado (v1.65)',
    });
  });

  it('exige categoria cuando no se manda productoId (v1.65)', () => {
    const campos = detalles(() => validarCompra(inputValido({ productoId: undefined, productoNombre: 'Galletas surtidas' })));
    expect(campos).toContainEqual({
      field: 'categoria',
      issue: 'requerido cuando no se manda productoId -- sin catálogo del que heredarla (v1.65)',
    });
  });

  it('no exige productoNombre/categoria cuando sí hay productoId', () => {
    expect(() => validarCompra(inputValido())).not.toThrow();
  });

  it('rechaza codigoEstacion vacío', () => {
    const campos = detalles(() => validarCompra(inputValido({ codigoEstacion: '' })));
    expect(campos).toContainEqual({ field: 'codigoEstacion', issue: 'requerido' });
  });

  it('rechaza fechas no parseables', () => {
    const campos = detalles(() => validarCompra(inputValido({ fecha: 'no-es-una-fecha' })));
    expect(campos).toContainEqual({ field: 'fecha', issue: 'fecha/hora inválida' });
  });

  it('rechaza cantidad <= 0', () => {
    const campos = detalles(() => validarCompra(inputValido({ cantidad: 0 })));
    expect(campos).toContainEqual({ field: 'cantidad', issue: 'debe ser un número > 0' });
  });

  it('rechaza costoUnitario <= 0', () => {
    const campos = detalles(() => validarCompra(inputValido({ costoUnitario: -1 })));
    expect(campos).toContainEqual({ field: 'costoUnitario', issue: 'debe ser un número > 0' });
  });

  it('no lanza cuando destinos reparte exactamente toda la cantidad', () => {
    expect(() =>
      validarCompra(inputValido({ cantidad: 500, destinos: [{ tanqueId: 'uuid-tanque-1', cantidad: 500 }] }))
    ).not.toThrow();
  });

  it('no lanza cuando destinos reparte MENOS que la cantidad (merma real, v1.65)', () => {
    expect(() =>
      validarCompra(
        inputValido({
          cantidad: 500,
          destinos: [
            { tanqueId: 'uuid-tanque-1', cantidad: 450 },
            { tanqueId: 'uuid-tanque-2', cantidad: 30 },
          ],
        })
      )
    ).not.toThrow();
  });

  it('rechaza cuando destinos reparte MÁS que la cantidad comprada', () => {
    const campos = detalles(() =>
      validarCompra(inputValido({ cantidad: 500, destinos: [{ tanqueId: 'uuid-tanque-1', cantidad: 600 }] }))
    );
    expect(campos).toContainEqual({
      field: 'destinos',
      issue: 'la suma de las cantidades repartidas a tanques (600) no puede superar la cantidad comprada (500)',
    });
  });

  it('rechaza un destino sin tanqueId NI descripcionEntrega (v1.70)', () => {
    const campos = detalles(() => validarCompra(inputValido({ destinos: [{ tanqueId: '', cantidad: 10 }] })));
    expect(campos).toContainEqual({
      field: 'destinos[0]',
      issue: 'requiere tanqueId (tanque registrado) o descripcionEntrega (entrega externa en texto libre) (v1.70)',
    });
  });

  it('rechaza un destino con tanqueId Y descripcionEntrega a la vez (v1.70)', () => {
    const campos = detalles(() =>
      validarCompra(
        inputValido({ destinos: [{ tanqueId: 'uuid-tanque-1', descripcionEntrega: 'Venta al menudeo', cantidad: 10 }] })
      )
    );
    expect(campos).toContainEqual({ field: 'destinos[0]', issue: 'debe tener tanqueId O descripcionEntrega, no ambos (v1.70)' });
  });

  it('no lanza con un destino de entrega externa (descripcionEntrega, sin tanqueId) -- v1.70', () => {
    expect(() =>
      validarCompra(
        inputValido({
          cantidad: 500,
          destinos: [{ descripcionEntrega: 'Venta al menudeo -- camion placa ABC-123', cantidad: 200 }],
        })
      )
    ).not.toThrow();
  });

  it('no lanza combinando un destino a tanque y una entrega externa en la misma compra (v1.70)', () => {
    expect(() =>
      validarCompra(
        inputValido({
          cantidad: 500,
          destinos: [
            { tanqueId: 'uuid-tanque-1', cantidad: 300 },
            { descripcionEntrega: 'Reventa a grifo vecino, sin factura', cantidad: 150 },
          ],
        })
      )
    ).not.toThrow();
  });

  it('rechaza un destino con cantidad <= 0', () => {
    const campos = detalles(() => validarCompra(inputValido({ destinos: [{ tanqueId: 'uuid-tanque-1', cantidad: 0 }] })));
    expect(campos).toContainEqual({ field: 'destinos[0].cantidad', issue: 'debe ser un número > 0' });
  });
});
