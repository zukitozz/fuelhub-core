// application/ports/EventPublisherPort.ts
//
// Puerto de salida para publicar el evento `CierreTurnoRegistrado` a
// EventBridge (v1.85) -- calco exacto de `ingest-cierre-dia/application/ports/EventPublisherPort.ts`
// (mismo criterio: el dominio/aplicación nunca importa el SDK de AWS
// directamente, sección 4 regla 1; el adaptador concreto
// `infrastructure/adapters/EventBridgeCierreTurnoPublisher.ts` es el único
// que conoce `PutEventsCommand`).
//
// Pedido real de `notificaciones-whatsapp`: los administradores de UNA
// estación quieren un aviso por WhatsApp al cerrar CADA turno, no solo al
// cerrar el día (eso ya lo cubre `CierreDiaRegistrado`). `cierreTurnoId`
// cumple el mismo rol que `cierreDiaId` en el evento de día: id único y
// estable del cierre, para que su lado pueda deduplicar (EventBridge entrega
// "al menos una vez").
//
// `tipo` ("turno 1", "turno 2", "turno 3") es texto legible que su sistema
// muestra tal cual en el mensaje -- no es un campo de negocio nuestro, es
// una proyección de `turno` (`'TURNO1'|'TURNO2'|'TURNO3'`) armada en
// `RegistrarCierreTurno.ts` (`TIPO_POR_TURNO`) solo para este evento.

export interface CierreTurnoRegistradoEvent {
  readonly proyectoCodigo: string;
  readonly estacionId: string;
  readonly estacionCodigo: string;
  readonly fechaNegocio: string;
  readonly turno: 'TURNO1' | 'TURNO2' | 'TURNO3';
  readonly tipo: string;
  readonly total: number;
  readonly cierreTurnoId: string;
}

export interface EventPublisherPort {
  publicarCierreTurnoRegistrado(evento: CierreTurnoRegistradoEvent): Promise<void>;
}
