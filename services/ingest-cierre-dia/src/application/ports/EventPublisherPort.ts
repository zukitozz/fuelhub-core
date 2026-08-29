// application/ports/EventPublisherPort.ts
//
// Puerto de salida para publicar el evento `CierreDiaRegistrado` a
// EventBridge (sección 4.1) — el dominio/aplicación nunca importa el SDK de
// AWS directamente (sección 4, regla 1); el adaptador concreto
// (`infrastructure/adapters/EventBridgeCierreDiaPublisher.ts`) es el único
// que conoce `PutEventsCommand`.
//
// HALLAZGO A CONFIRMAR (ver changelog del documento): el campo
// `proyectoCodigo` del `detail` está documentado en la sección 4.1 del spec
// principal, pero su significado exacto (¿identificador fijo de este backend?
// ¿algo específico del lado de notificaciones?) es parte del contrato que
// vive en `specs-notificaciones-whatsapp.md` — documento deliberadamente
// fuera de alcance de esta sesión. Este adaptador le pone el valor fijo
// `"fuelhub-cloud"` (igual al `Source` del evento) como mejor esfuerzo; se
// debe confirmar contra ese otro documento antes de ir a producción.

export interface CierreDiaRegistradoEvent {
  readonly proyectoCodigo: string;
  readonly estacionId: string;
  readonly estacionCodigo: string;
  readonly fechaNegocio: string;
  readonly total: number;
  readonly cierreDiaId: string;
}

export interface EventPublisherPort {
  publicarCierreDiaRegistrado(evento: CierreDiaRegistradoEvent): Promise<void>;
}
