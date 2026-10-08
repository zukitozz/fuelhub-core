// infrastructure/adapters/EventBridgeCierreTurnoPublisher.ts
//
// Único lugar que conoce el SDK de EventBridge para este Lambda (v1.85) --
// calco exacto de `ingest-cierre-dia/infrastructure/adapters/EventBridgeCierreDiaPublisher.ts`.
// `Source` es el mismo bus/fuente que ya usa `CierreDiaRegistrado`
// (`notificaciones-bus`, `Source = 'FuelHubCloud'`) -- confirmado con
// notificaciones-whatsapp que es "mismo bus, misma fuente y mismo mecanismo
// de publicación que hoy usan para CierreDiaRegistrado". Solo cambia
// `DetailType`.

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { CierreTurnoRegistradoEvent, EventPublisherPort } from '../../application/ports/EventPublisherPort';

const SOURCE = 'FuelHubCloud';
const DETAIL_TYPE = 'CierreTurnoRegistrado';

export class EventBridgeCierreTurnoPublisher implements EventPublisherPort {
  constructor(private readonly client: EventBridgeClient, private readonly busName: string) {}

  async publicarCierreTurnoRegistrado(evento: CierreTurnoRegistradoEvent): Promise<void> {
    const resultado = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: SOURCE,
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
