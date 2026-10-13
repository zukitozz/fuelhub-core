// infrastructure/adapters/EventBridgeReporteTopFacturasPublisher.ts
//
// Único lugar que conoce el SDK de EventBridge para este evento (v1.89) --
// calco de EventBridgeCierreDiaPublisher.ts/EventBridgeCierreTurnoPublisher.ts,
// con el mismo `source` como parámetro de constructor desde el día 1 (ver la
// nota de cabecera de EventBridgeCierreDiaPublisher.ts sobre el bug de
// dev/prod compartiendo bus -- este publisher nace ya corregido, no hace
// falta un v1.88 propio).
//
// Sin reintento propio (a diferencia de EventBridgeReporteComprasSemanalPublisher.ts):
// acá SÍ hay un cliente HTTP esperando la respuesta (fuelhub-local, igual
// que CierreDia/CierreTurno) -- reintentar adentro alargaría esa respuesta.
// El caso de uso ya trata esto como "best effort" (ver RegistrarReporteTopFacturas.ts).

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { EventPublisherPort, ReporteTopFacturasRegistradoEvent } from '../../application/ports/EventPublisherPort';

const DETAIL_TYPE = 'ReporteTopFacturasRegistrado';

export class EventBridgeReporteTopFacturasPublisher implements EventPublisherPort {
  constructor(private readonly client: EventBridgeClient, private readonly busName: string, private readonly source: string) {}

  async publicarReporteTopFacturasRegistrado(evento: ReporteTopFacturasRegistradoEvent): Promise<void> {
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

    if (resultado.FailedEntryCount && resultado.FailedEntryCount > 0) {
      const detalle = resultado.Entries?.[0];
      throw new Error(`EventBridge rechazó el evento ReporteTopFacturasRegistrado: ${detalle?.ErrorCode} — ${detalle?.ErrorMessage}`);
    }
  }
}
