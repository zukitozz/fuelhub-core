// domain/MatchearProducto.ts
//
// Matchea la descripción libre de un ítem de factura (`Item/Description`
// del XML SUNAT, texto que pone el proveedor a su criterio -- "DIESEL B5
// S-50", "GASOHOL REGULAR 90", etc.) contra el catálogo de
// `productos_maestro` (5 filas hoy: Diésel/Premium/Regular/GLP/GNV, sección
// FacturaProveedorXml.ts). Función pura -- el caso de uso
// (`ProcesarFacturaProveedorCorreo`, por construir) le pasa el catálogo ya
// leído de la base, esto no hace I/O.
//
// v1.81 -- decisión explícita: sin matcheo difuso/similitud de texto (ej.
// distancia de Levenshtein) -- con solo 5 productos y nombres tan distintos
// entre sí, una lista de sinónimos por palabra clave es más simple, más
// predecible, y más fácil de auditar que un score de similitud. Si el
// catálogo llegara a crecer con productos ambiguos entre sí, esto habría
// que revisarlo -- no es el caso hoy.
//
// Cuando NO hay match confiable (cero coincidencias, o coincidencias
// AMBIGUAS -- la descripción parece calzar con más de un producto del
// catálogo a la vez), esto devuelve `undefined` a propósito en vez de
// adivinar: el caso de uso registra igual la compra (con
// `producto_nombre` = la descripción cruda del XML, sin `producto_id`) pero
// en estado `PENDIENTE_REVISION` (migración 1788600000000) para que Jorge
// la revise a mano -- más seguro que archivar mal un producto en silencio.

import type { CategoriaProducto } from '@fuelhub/shared-kernel';

export interface ProductoCatalogo {
  readonly id: string;
  readonly nombre: string;
  readonly alias: string | null;
  readonly categoria: CategoriaProducto;
}

// Sinónimos conocidos para los 5 productos combustibles de `productos_maestro`
// hoy (claves = nombre normalizado del catálogo, sección `normalizar` abajo).
// Términos reales que usan las distribuidoras peruanas en sus facturas
// electrónicas -- "DB5"/"B5" (diésel B5, el único que vende SUNAT/OSINERGMIN
// en el mercado peruano), grados de octanaje (90/84 = regular, 95/97 =
// premium) además del nombre comercial ("GASOHOL").
const SINONIMOS: Record<string, readonly string[]> = {
  DIESEL: ['DIESEL', 'DB5', 'D.B.5', ' B5', 'B-5'],
  PREMIUM: ['PREMIUM', ' 95', ' 97', '-95', '-97'],
  REGULAR: ['REGULAR', ' 90', ' 84', '-90', '-84'],
  GLP: ['GLP'],
  GNV: ['GNV'],
};

/**
 * Matchea `descripcionItem` contra `catalogo`. Devuelve el producto único
 * que matchea, o `undefined` si no matchea ninguno o si matchea más de uno
 * (ambiguo -- ver nota de cabecera).
 */
export function matchearProducto(descripcionItem: string, catalogo: readonly ProductoCatalogo[]): ProductoCatalogo | undefined {
  const descripcionNormalizada = normalizar(descripcionItem);

  const coincidencias = catalogo.filter((producto) => {
    const nombreNormalizado = normalizar(producto.nombre);
    // Los keywords de SINONIMOS ya están en mayúsculas/sin tildes a mano
    // (algunos con un espacio a propósito antes del número, ej. ' 90' --
    // para no matchear "90" como substring de cualquier otro número que
    // aparezca en la descripción). Por eso NO se pasan por normalizar() acá
    // -- normalizar() hace trim() y se comería justo ese espacio.
    const matcheaKeyword = (SINONIMOS[nombreNormalizado] ?? [nombreNormalizado]).some((keyword) => descripcionNormalizada.includes(keyword));
    const matcheaAlias = producto.alias !== null && descripcionNormalizada.includes(normalizar(producto.alias));
    return matcheaKeyword || matcheaAlias;
  });

  // Sin match, o ambiguo (calza con 2+ productos a la vez) -- ambos casos
  // se resuelven igual aguas arriba (PENDIENTE_REVISION), ver cabecera.
  if (coincidencias.length !== 1) return undefined;
  return coincidencias[0];
}

/** Mayúsculas + sin tildes/diacríticos + espacios colapsados -- para comparar sin depender de cómo cada proveedor tildó/capitalizó su descripción. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
