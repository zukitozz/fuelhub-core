// domain/value-objects/Paginacion.ts — sin dependencias de AWS (sección 4, regla 1).
//
// v1.67: copia deliberada de `consulta-cierres/src/domain/value-objects/Paginacion.ts`
// para `GET /compras` (sección 8.1 de `specs-frontend-fuelhub-web.md`) --
// mismo criterio de duplicación de utilidades chicas por servicio que ya usa
// el repo (p. ej. `TanqueUpdateInput`/`CambiosTanque`, no se deduplican en
// `shared-kernel` solo porque coinciden en forma). No hay import cruzado
// entre `ingest-compra` y `consulta-cierres` a propósito -- cada servicio es
// independiente (sección 4).

export interface ParametrosPaginacion {
  readonly page: number;
  readonly pageSize: number;
}

export interface Paginacion {
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface ResultadoPaginado<T> {
  readonly data: readonly T[];
  readonly pagination: Paginacion;
}

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100; // sección 11.1

/**
 * Normaliza page/pageSize crudos (de query params, ya strings) a un valor
 * seguro — nunca deja pasar un pageSize sin tope hacia el adaptador de datos.
 */
export function normalizarPaginacion(pageRaw?: string, pageSizeRaw?: string): ParametrosPaginacion {
  const page = Math.max(1, parseIntSeguro(pageRaw, 1));
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseIntSeguro(pageSizeRaw, PAGE_SIZE_DEFAULT)));
  return { page, pageSize };
}

export function construirPaginacion(params: ParametrosPaginacion, totalItems: number): Paginacion {
  return {
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / params.pageSize)),
  };
}

function parseIntSeguro(valor: string | undefined, porDefecto: number): number {
  if (!valor) return porDefecto;
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) ? n : porDefecto;
}
