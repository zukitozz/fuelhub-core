// application/ports/EventPublisherPort.ts
//
// Puerto de salida para publicar `ReporteTopFacturasRegistrado` a
// EventBridge (v1.89) -- mismo bus/contrato base que CierreDiaRegistrado/
// CierreTurnoRegistrado/ReporteComprasSemanalRegistrado (`notificaciones-bus`,
// `proyectoCodigo: "FUELHUBCLOUD"`, `estacionId`/`estacionCodigo` siempre
// presentes -- contrato confirmado v1.57).
//
// `top` acá es un RESUMEN por cliente (total, cantidad de facturas,
// despachadores involucrados), no el detalle factura-por-factura que sí
// queda en el JSON guardado en S3 (ver RegistrarReporteTopFacturas.ts) --
// el evento es para que notificaciones-whatsapp arme el mensaje de alerta,
// no para ser el registro de auditoría completo.
//
// `reporteTopFacturasId` cumple el mismo rol que `reporteSemanalId`
// (consulta-reportes/EventPublisherPort.ts): id determinístico y estable
// para que notificaciones-whatsapp pueda deduplicar -- `${estacionId}-${semanaInicio}`.

export interface ClienteTopFacturasEvento {
  readonly numeroDocumentoCliente: string;
  readonly nombreCliente: string;
  readonly totalSoles: number;
  readonly cantidadFacturas: number;
  /** Nombres de despachador unicos, en orden de aparicion -- quien(es) generaron las facturas de este cliente. */
  readonly despachadores: readonly string[];
}

export interface ReporteTopFacturasRegistradoEvent {
  readonly proyectoCodigo: string;
  readonly estacionId: string;
  readonly estacionCodigo: string;
  readonly semanaInicio: string;
  readonly tipo: string;
  readonly reporteTopFacturasId: string;
  readonly top: readonly ClienteTopFacturasEvento[];
}

export interface EventPublisherPort {
  publicarReporteTopFacturasRegistrado(evento: ReporteTopFacturasRegistradoEvent): Promise<void>;
}
