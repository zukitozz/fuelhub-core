// application/ports/EventPublisherPort.ts
//
// Puerto de salida para publicar `ReporteComprasSemanalRegistrado` a
// EventBridge (v1.86) -- primera vez que `consulta-reportes` publica un
// evento propio (día/turno lo publican `ingest-cierre-dia`/`ingest-cierre-turno`,
// justo después de su INSERT). Acá no hay INSERT: el Lambda semanal LEE
// `compras`, genera el Excel y recién ahí avisa -- mismo bus/fuente que
// CierreDiaRegistrado/CierreTurnoRegistrado (`notificaciones-bus`,
// `Source: "FuelHubCloud"`), calco de ese mismo contrato.
//
// `reporteSemanalId` cumple el mismo rol que `cierreDiaId`/`cierreTurnoId`
// (id único y estable para que notificaciones-whatsapp pueda deduplicar) --
// pero acá no existe una fila de base de datos de la que sacar un UUID
// (esto no es un cierre, es un reporte derivado), así que es determinístico:
// `${estacionId}-${fechaInicio}` (una estación nunca tiene dos reportes
// semanales con la misma fechaInicio, por diseño del cron).

export interface ReporteComprasSemanalRegistradoEvent {
  readonly proyectoCodigo: string;
  readonly estacionId: string;
  readonly estacionCodigo: string;
  readonly fechaInicio: string;
  readonly fechaFin: string;
  readonly tipo: string;
  readonly reporteSemanalId: string;
}

export interface EventPublisherPort {
  publicarReporteComprasSemanalRegistrado(evento: ReporteComprasSemanalRegistradoEvent): Promise<void>;
}
