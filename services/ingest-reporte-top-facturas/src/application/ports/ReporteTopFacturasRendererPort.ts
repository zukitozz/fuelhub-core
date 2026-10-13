// application/ports/ReporteTopFacturasRendererPort.ts
//
// Puerto de renderizado del Excel descargable (v1.89, agregado tras
// comentario de Jorge: así como día/turno/compras-semanal generan su propio
// documento y notificaciones-whatsapp solo accede vía un GET .../documento,
// top-facturas debía seguir el mismo criterio en vez de dejar que
// notificaciones arme su propio reporte a partir del resumen del evento).
//
// A diferencia de ExcelReporteComprasSemanalRenderer.ts (consulta-reportes),
// acá el render ocurre DENTRO del mismo POST que recibe el dato (no hace
// falta un Lambda disparado por evento que vuelva a leer de S3): el payload
// de fuelhub-local ya trae todo lo necesario.

import type { ClienteTopFacturasInput } from '../../domain/ReporteTopFacturasInput';

export interface ReporteTopFacturasRendererPort {
  renderizarExcel(params: {
    readonly codigoEstacion: string;
    readonly semanaInicio: string;
    readonly top: readonly ClienteTopFacturasInput[];
  }): Promise<Buffer>;
}
