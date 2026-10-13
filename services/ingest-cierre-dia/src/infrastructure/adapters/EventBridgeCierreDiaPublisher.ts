// infrastructure/adapters/EventBridgeCierreDiaPublisher.ts
//
// Único lugar que conoce el SDK de EventBridge (sección 4.1). `Source` y
// `DetailType` son el contrato de integración con el servicio independiente
// de notificaciones — confirmado v1.57 contra el documento de contrato real
// que compartió la sesión de `notificaciones-whatsapp`: en PROD, `Source`
// debe ser literal `"FuelHubCloud"` (antes `'fuelhub-cloud'`, valor
// provisorio de mejor esfuerzo puesto antes de tener el contrato real). No
// cambiar ese valor sin coordinar con ese lado — es matching exacto de
// string, EventBridge no hace normalización de casing en las reglas de
// filtro por `source`.
//
// v1.88 -- `source` pasa a ser un parámetro del constructor (antes una
// constante fija) -- bug real reportado por notificaciones-whatsapp: dev y
// prod comparten el mismo `notificaciones-bus`, y con `Source` hardcodeado
// igual en los dos, una corrida de dev quedaba indistinguible de una de
// prod del otro lado. Quien arma este adaptador (`handler.ts`) decide el
// valor vía `fuenteEventBridgePara(ambiente)` (`@fuelhub/shared-kernel`) --
// ver esa función para el valor exacto de cada ambiente.

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { CierreDiaRegistradoEvent, EventPublisherPort } from '../../application/ports/EventPublisherPort';

const DETAIL_TYPE = 'CierreDiaRegistrado';

export class EventBridgeCierreDiaPublisher implements EventPublisherPort {
  constructor(private readonly client: EventBridgeClient, private readonly busName: string, private readonly source: string) {}

  async publicarCierreDiaRegistrado(evento: CierreDiaRegistradoEvent): Promise<void> {
    const resultado = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: this.source,
            DetailType: DETAIL_TYPE,
            Detail: JSON.stringify(evento),
          },
        ],
      })
    );

    // PutEvents no lanza excepción por entradas individuales rechazadas — hay
    // que revisar `FailedEntryCount` explícitamente (comportamiento estándar
    // del SDK de EventBridge). El caso de uso ya trata esto como "best effort"
    // (ver RegistrarCierreDia.ts), así que acá basta con lanzar para que ese
    // catch lo loguee — no hay reintento propio en esta primera versión.
    if (resultado.FailedEntryCount && resultado.FailedEntryCount > 0) {
      const detalle = resultado.Entries?.[0];
      throw new Error(`EventBridge rechazó el evento CierreDiaRegistrado: ${detalle?.ErrorCode} — ${detalle?.ErrorMessage}`);
    }
  }
}
