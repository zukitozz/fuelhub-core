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
//
// v1.70 (migración 1788400000000_agrega-entregas-externas-compras.sql), a
// pedido de Jorge -- "quiero registrar donde entregué el producto que
// compré" más allá de los grifos del grupo: hasta acá, cada `destino` era
// SIEMPRE un `tanqueId` de un tanque previamente registrado. Eso no cubre
// dos casos reales que Jorge describió:
//
//   - "Reventa" a terceros fuera del grupo: parte de una compra se entrega
//     a un cliente externo (nunca un sistema de ventas -- Jorge fue
//     explícito en que NO quiere eso -- solo registrar el destino físico).
//   - Venta al menudeo "a granel": varios vehículos del grupo tienen
//     mangueras propias y venden directo fuera de los grifos registrados --
//     una misma compra puede tener VARIAS entregas externas, no una sola.
//
// Cada `destino` ahora es exactamente UNA de dos cosas (nunca ambas, nunca
// ninguna -- XOR, validado en `validarDestino`):
//
//   - `tanqueId`: reparto a un tanque registrado (comportamiento de v1.65,
//     sin cambios).
//   - `descripcionEntrega`: texto libre para una entrega externa (decisión
//     explícita de Jorge: sin catálogo de clientes, cada entrega se anota
//     suelta -- "una especie de a granel", "3 ventas fuera de los grifos
//     registrados").
//
// Aplica IGUAL para compras de combustible y de mercadería (`categoria`) --
// Jorge confirmó que el objetivo es identificar compras vs. entregas/ventas
// para AMBOS tipos, no solo combustible. `destinos`/`categoria` ya eran
// independientes entre sí desde v1.65 (esta migración no cambia esa regla).
//
// La fórmula de merma (`cantidad - suma(destinos[].cantidad)`) NO cambia --
// ahora es más precisa: una entrega externa cuenta en la suma igual que un
// tanque, así que "merma" vuelve a significar lo que su nombre dice (pérdida
// sin explicar), no "todo lo que no fue a un tanque propio".

import { ParametrosInvalidosError, type CategoriaProducto, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface CompraDestinoInput {
  /** Reparto a un tanque registrado. Exactamente uno de tanqueId/descripcionEntrega (v1.70). */
  readonly tanqueId?: string | null;
  /** Entrega externa en texto libre (reventa, venta al menudeo a granel) -- v1.70. */
  readonly descripcionEntrega?: string | null;
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
  /**
   * Reparto físico a tanques Y/O entregas externas (v1.65, extendido v1.70)
   * -- ver nota de cabecera. Ausente/vacío = compra sin ningún destino
   * registrado todavía (p. ej. mercadería recién comprada, sin repartir).
   */
  readonly destinos?: readonly CompraDestinoInput[];
}

/**
 * Valida un `CompraDestinoInput` individual -- compartida entre
 * `validarCompra` y `validarCompraUpdate` (CompraUpdateInput.ts) para no
 * duplicar la regla XOR en dos lugares (v1.70).
 */
export function validarDestino(destino: CompraDestinoInput, index: number, errores: DetalleValidacion[]): void {
  const tieneTanque = !!destino.tanqueId?.trim();
  const tieneDescripcion = !!destino.descripcionEntrega?.trim();

  if (tieneTanque && tieneDescripcion) {
    errores.push({
      field: `destinos[${index}]`,
      issue: 'debe tener tanqueId O descripcionEntrega, no ambos (v1.70)',
    });
  } else if (!tieneTanque && !tieneDescripcion) {
    errores.push({
      field: `destinos[${index}]`,
      issue: 'requiere tanqueId (tanque registrado) o descripcionEntrega (entrega externa en texto libre) (v1.70)',
    });
  }

  if (typeof destino.cantidad !== 'number' || destino.cantidad <= 0) {
    errores.push({ field: `destinos[${index}].cantidad`, issue: 'debe ser un número > 0' });
  }
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
    input.destinos.forEach((destino, i) => validarDestino(destino, i, errores));

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
