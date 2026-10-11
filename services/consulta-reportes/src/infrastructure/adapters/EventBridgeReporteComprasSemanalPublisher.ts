// infrastructure/adapters/EventBridgeReporteComprasSemanalPublisher.ts
//
// Único lugar que conoce el SDK de EventBridge para este evento (v1.86) --
// calco exacto de `EventBridgeCierreTurnoPublisher.ts` (ingest-cierre-turno).
// Mismo bus/fuente, solo cambia `DetailType`.

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { EventPublisherPort, ReporteComprasSemanalRegistradoEvent } from '../../application/ports/EventPublisherPort';

const SOURCE = 'FuelHubCloud';
const DETAIL_TYPE = 'ReporteComprasSemanalRegistrado';

export class EventBridgeReporteComprasSemanalPublisher implements EventPublisherPort {
  constructor(private readonly client: EventBridgeClient, private readonly busName: string) {}

  async publicarReporteComprasSemanalRegistrado(evento: ReporteComprasSemanalRegistradoEvent): Promise<void> {
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

    if (resultado.FailedEntryCount && resultado.FailedEntryCount > 0) {
      const detalle = resultado.Entries?.[0];
      throw new Error(`EventBridge rechazó el evento ReporteComprasSemanalRegistrado: ${detalle?.ErrorCode} — ${detalle?.ErrorMessage}`);
    }
  }
}
