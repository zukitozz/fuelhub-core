// domain/CompraInput.ts
//
// Sin dependencias de AWS (sección 4, regla 1). Espejo de `CompraInput` del
// contrato OpenAPI (sección 11) + validación estructural pura.
//
// v1.65 -- dos cambios reales pedidos por Jorge (migración
// 1788200000000_extiende-compras-multiproducto-multitanque.sql):
//
//   1. `productoId` deja de ser SIEMPRE obligatorio. Las compras ya no son
//      exclusivamente de combustible -- Jorge también compra mercadería
//      para el mercadito de cada estación (galletas, panetón, etc.), que
//      nunca va a estar en `productos_maestro` (catálogo cruzado de
//      combustibles, 5 filas). Mismo patrón que `cierres_turno_detalle`
//      desde v1.7/v1.58: sin `productoId`, `productoNombre` (texto libre) y
//      `categoria` (clasificación explícita, sin catálogo del que
//      heredarla) pasan a ser obligatorios -- decisión explícita de Jorge
//      de no mantener un catálogo intermedio para mercadería.
//
//   2. `destinos`: una compra de combustible puede repartirse entre varios
//      tanques -- incluso de OTRA estación (contingencia real: se factura a
//      nombre de una estación pero parte del combustible va físicamente a
//      otra). Reemplaza el `tanqueId` suelto de versiones anteriores (sin
//      consumidores reales todavía, confirmado con Jorge -- no es un cambio
//      de contrato que rompa a nadie). La suma de `destinos[].cantidad`
//      puede ser MENOR que `cantidad` -- la diferencia es merma real
//      (confirmado con Jorge: pérdida física de combustible, no un error de
//      datos) -- pero nunca MAYOR, eso sí se rechaza acá.

import { ParametrosInvalidosError, type CategoriaProducto, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface CompraDestinoInput {
  readonly tanqueId: string;
  readonly cantidad: number;
}

export interface CompraInput {
  readonly codigoEstacion: string;
  /** Opcional desde v1.65 -- ver nota de cabecera, punto 1. */
  readonly productoId?: string | null;
  /** Obligatorio SOLO cuando no se manda `productoId` (v1.65). */
  readonly productoNombre?: string | null;
  /** Obligatorio SOLO cuando no se manda `productoId` (v1.65) -- con `productoId`, el catálogo manda y este campo se ignora. */
  readonly categoria?: CategoriaProducto | null;
  readonly proveedor?: string | null;
  readonly fecha: string;
  readonly cantidad: number;
  readonly costoUnitario: number;
  readonly numeroGuia?: string | null;
  /** Reparto físico a tanques (v1.65) -- ver nota de cabecera, punto 2. Ausente/vacío = compra sin tanque asociado (p. ej. mercadería). */
  readonly destinos?: readonly CompraDestinoInput[];
}

export function validarCompra(input: CompraInput): void {
  const errores: DetalleValidacion[] = [];

  if (!input.codigoEstacion?.trim()) {
    errores.push({ field: 'codigoEstacion', issue: 'requerido' });
  }

  if (!input.productoId?.trim()) {
    if (!input.productoNombre?.trim()) {
      errores.push({
        field: 'productoNombre',
        issue: 'requerido cuando no se manda productoId -- compra fuera del catálogo cruzado (v1.65)',
      });
    }
    if (!input.categoria) {
      errores.push({
        field: 'categoria',
        issue: 'requerido cuando no se manda productoId -- sin catálogo del que heredarla (v1.65)',
      });
    }
  }

  if (!input.fecha || Number.isNaN(Date.parse(input.fecha))) {
    errores.push({ field: 'fecha', issue: 'fecha/hora inválida' });
  }
  if (typeof input.cantidad !== 'number' || input.cantidad <= 0) {
    errores.push({ field: 'cantidad', issue: 'debe ser un número > 0' });
  }
  if (typeof input.costoUnitario !== 'number' || input.costoUnitario <= 0) {
    errores.push({ field: 'costoUnitario', issue: 'debe ser un número > 0' });
  }

  if (input.destinos !== undefined) {
    input.destinos.forEach((destino, i) => {
      if (!destino.tanqueId?.trim()) {
        errores.push({ field: `destinos[${i}].tanqueId`, issue: 'requerido' });
      }
      if (typeof destino.cantidad !== 'number' || destino.cantidad <= 0) {
        errores.push({ field: `destinos[${i}].cantidad`, issue: 'debe ser un número > 0' });
      }
    });

    const sumaDestinos = input.destinos.reduce((acc, d) => acc + (typeof d.cantidad === 'number' ? d.cantidad : 0), 0);
    if (typeof input.cantidad === 'number' && sumaDestinos > input.cantidad) {
      errores.push({
        field: 'destinos',
        issue: `la suma de las cantidades repartidas a tanques (${sumaDestinos}) no puede superar la cantidad comprada (${input.cantidad})`,
      });
    }
    // sumaDestinos < cantidad -- merma real, no es un error (confirmado con Jorge, v1.65). Se calcula, no se valida acá.
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El payload de compra no pasó la validación.', errores);
  }
}
