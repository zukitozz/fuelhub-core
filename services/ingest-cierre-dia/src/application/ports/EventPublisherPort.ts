// application/ports/EventPublisherPort.ts
//
// Puerto de salida para publicar el evento `CierreDiaRegistrado` a
// EventBridge (sección 4.1) — el dominio/aplicación nunca importa el SDK de
// AWS directamente (sección 4, regla 1); el adaptador concreto
// (`infrastructure/adapters/EventBridgeCierreDiaPublisher.ts`) es el único
// que conoce `PutEventsCommand`.
//
// CONFIRMADO v1.57 contra el contrato real recibido de la sesión de
// `notificaciones-whatsapp`: `proyectoCodigo` es el identificador fijo de
// este backend visto desde afuera, valor literal `"FUELHUBCLOUD"` (antes
// `"fuelhub-cloud"`, mismo valor que `Source` — resultó que el contrato real
// usa casings DISTINTOS para cada uno: `Source: "FuelHubCloud"` pero
// `proyectoCodigo: "FUELHUBCLOUD"`, no el mismo string en los dos lugares
// como se había asumido de mejor esfuerzo). El resto de los campos
// (`estacionId`, `estacionCodigo`, `fechaNegocio`, `total`, `cierreDiaId`)
// ya calzaban exactos contra ese contrato sin cambios.

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
