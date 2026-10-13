// domain/ReporteTopFacturasInput.ts
//
// Validacion estructural pura (sin AWS) del payload de
// POST /reportes/top-facturas (v1.89) -- lo manda `fuelhub-local`, una vez
// por semana por estacion, con el top de clientes que mas facturaron (hasta
// 20) y, por cada factura de cada cliente, que despachador la genero. El
// calculo del top-20 (y el DNI del despachador) lo hace fuelhub-local con su
// propia base local -- este servicio solo valida, guarda y notifica, no
// recalcula nada (fuelhub-core no tiene visibilidad de los datos de venta de
// fuelhub-local, solo de los comprobantes ya emitidos via
// ingest-comprobante-pdf).
//
// `cantidadFacturas` NO es un campo del payload -- se deriva de
// `facturas.length` en vez de pedirselo al cliente y confiar en que
// coincida (una clase entera de inconsistencias que se evita gratis).

import { ParametrosInvalidosError, type DetalleValidacion } from '@fuelhub/shared-kernel';

export interface FacturaTopFacturasInput {
  readonly numeracion: string;
  /** YYYY-MM-DD */
  readonly fecha: string;
  readonly monto: number;
  readonly despachadorNombre: string;
  /** DNI, 8 digitos -- confirmado con Jorge que siempre es DNI (nunca carnet de extranjeria u otro). */
  readonly despachadorDocumento: string;
}

export interface ClienteTopFacturasInput {
  readonly numeroDocumentoCliente: string;
  readonly nombreCliente: string;
  readonly totalSoles: number;
  readonly facturas: readonly FacturaTopFacturasInput[];
}

export interface ReporteTopFacturasInput {
  readonly codigoEstacion: string;
  /** YYYY-MM-DD -- lunes de la semana que resume el reporte. */
  readonly semanaInicio: string;
  /** Hasta 20 clientes -- ver nota de cabecera. */
  readonly top: readonly ClienteTopFacturasInput[];
}

export const MAX_CLIENTES_TOP = 20;

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DNI_REGEX = /^\d{8}$/;

export function validarReporteTopFacturas(input: ReporteTopFacturasInput): void {
  const errores: DetalleValidacion[] = [];

  if (!input.codigoEstacion?.trim()) {
    errores.push({ field: 'codigoEstacion', issue: 'requerido' });
  }

  if (!input.semanaInicio?.trim()) {
    errores.push({ field: 'semanaInicio', issue: 'requerido' });
  } else if (!FECHA_REGEX.test(input.semanaInicio.trim())) {
    errores.push({ field: 'semanaInicio', issue: 'debe tener formato YYYY-MM-DD' });
  }

  if (!Array.isArray(input.top)) {
    errores.push({ field: 'top', issue: 'requerido, debe ser un arreglo' });
  } else {
    if (input.top.length > MAX_CLIENTES_TOP) {
      errores.push({ field: 'top', issue: `maximo ${MAX_CLIENTES_TOP} clientes, se recibieron ${input.top.length}` });
    }
    input.top.forEach((cliente, indiceCliente) => validarCliente(cliente, indiceCliente, errores));
  }

  if (errores.length > 0) {
    throw new ParametrosInvalidosError('El payload no paso la validacion.', errores);
  }
}

function validarCliente(cliente: ClienteTopFacturasInput, indiceCliente: number, errores: DetalleValidacion[]): void {
  const prefijo = `top[${indiceCliente}]`;

  if (!cliente?.numeroDocumentoCliente?.trim()) {
    errores.push({ field: `${prefijo}.numeroDocumentoCliente`, issue: 'requerido' });
  }
  if (!cliente?.nombreCliente?.trim()) {
    errores.push({ field: `${prefijo}.nombreCliente`, issue: 'requerido' });
  }
  if (typeof cliente?.totalSoles !== 'number' || !Number.isFinite(cliente.totalSoles) || cliente.totalSoles < 0) {
    errores.push({ field: `${prefijo}.totalSoles`, issue: 'debe ser un numero >= 0' });
  }
  if (!Array.isArray(cliente?.facturas) || cliente.facturas.length === 0) {
    errores.push({ field: `${prefijo}.facturas`, issue: 'requerido, al menos 1 factura' });
    return;
  }
  cliente.facturas.forEach((factura, indiceFactura) => validarFactura(factura, prefijo, indiceFactura, errores));
}

function validarFactura(
  factura: FacturaTopFacturasInput,
  prefijoCliente: string,
  indiceFactura: number,
  errores: DetalleValidacion[]
): void {
  const prefijo = `${prefijoCliente}.facturas[${indiceFactura}]`;

  if (!factura?.numeracion?.trim()) {
    errores.push({ field: `${prefijo}.numeracion`, issue: 'requerido' });
  }
  if (!factura?.fecha?.trim()) {
    errores.push({ field: `${prefijo}.fecha`, issue: 'requerido' });
  } else if (!FECHA_REGEX.test(factura.fecha.trim())) {
    errores.push({ field: `${prefijo}.fecha`, issue: 'debe tener formato YYYY-MM-DD' });
  }
  if (typeof factura?.monto !== 'number' || !Number.isFinite(factura.monto) || factura.monto < 0) {
    errores.push({ field: `${prefijo}.monto`, issue: 'debe ser un numero >= 0' });
  }
  if (!factura?.despachadorNombre?.trim()) {
    errores.push({ field: `${prefijo}.despachadorNombre`, issue: 'requerido' });
  }
  if (!factura?.despachadorDocumento?.trim()) {
    errores.push({ field: `${prefijo}.despachadorDocumento`, issue: 'requerido' });
  } else if (!DNI_REGEX.test(factura.despachadorDocumento.trim())) {
    errores.push({ field: `${prefijo}.despachadorDocumento`, issue: 'debe tener 8 digitos (DNI)' });
  }
}
