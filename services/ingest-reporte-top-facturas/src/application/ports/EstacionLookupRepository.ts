// application/ports/EstacionLookupRepository.ts
//
// Puerto de solo lectura contra Aurora -- resuelve codigoEstacion -> id
// (UUID interno), el mismo dato que ingest-cierre-dia/ingest-cierre-turno ya
// resuelven como parte de su INSERT (ver `resolverEstacion` en
// PostgresCierreDiaIngestaRepository.ts). Este servicio no tiene ningun otro
// INSERT/UPDATE en Postgres -- solo esta lectura puntual, necesaria porque
// `estacionId` es un campo requerido del contrato ya confirmado con
// notificaciones-whatsapp (v1.57) para TODOS los eventos de este bus, y
// fuelhub-local nunca conoce ese UUID (solo conoce codigoEstacion).

export interface EstacionLookupRepository {
  /** `undefined` si la estacion no existe o no esta activa. */
  resolverEstacionId(codigoEstacion: string): Promise<string | undefined>;
}
