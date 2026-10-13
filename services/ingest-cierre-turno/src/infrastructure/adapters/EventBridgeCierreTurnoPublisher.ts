// infrastructure/adapters/EventBridgeCierreTurnoPublisher.ts
//
// Único lugar que conoce el SDK de EventBridge para este Lambda (v1.85) --
// calco exacto de `ingest-cierre-dia/infrastructure/adapters/EventBridgeCierreDiaPublisher.ts`.
// `Source` es el mismo bus/fuente que ya usa `CierreDiaRegistrado`
// (`notificaciones-bus`, `Source = 'FuelHubCloud'` en prod) -- confirmado
// con notificaciones-whatsapp que es "mismo bus, misma fuente y mismo
// mecanismo de publicación que hoy usan para CierreDiaRegistrado". Solo
// cambia `DetailType`.
//
// v1.88 -- `source` pasa a ser un parámetro del constructor -- ver la nota
// de cabecera equivalente en `EventBridgeCierreDiaPublisher.ts` (mismo bug,
// mismo fix: dev y prod comparten bus, `fuenteEventBridgePara(ambiente)` de
// `@fuelhub/shared-kernel` resuelve el valor correcto por ambiente).

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { CierreTurnoRegistradoEvent, EventPublisherPort } from '../../application/ports/EventPublisherPort';

const DETAIL_TYPE = 'CierreTurnoRegistrado';

export class EventBridgeCierreTurnoPublisher implements EventPublisherPort {
  constructor(private readonly client: EventBridgeClient, private readonly busName: string, private readonly source: string) {}

  async publicarCierreTurnoRegistrado(evento: CierreTurnoRegistradoEvent): Promise<void> {
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

    // Mismo criterio que EventBridgeCierreDiaPublisher.ts: PutEvents no
    // lanza por entradas rechazadas, hay que revisar FailedEntryCount a
    // mano. El caso de uso trata esto como "best effort" (ver
    // RegistrarCierreTurno.ts).
    if (resultado.FailedEntryCount && resultado.FailedEntryCount > 0) {
      const detalle = resultado.Entries?.[0];
      throw new Error(`EventBridge rechazó el evento CierreTurnoRegistrado: ${detalle?.ErrorCode} — ${detalle?.ErrorMessage}`);
    }
  }
}
