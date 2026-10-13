// infrastructure/adapters/PostgresEstacionLookupRepository.ts
//
// Unica lectura a Aurora de este servicio -- ver la nota de cabecera del
// puerto (EstacionLookupRepository.ts). Mismo query que `resolverEstacion`
// en PostgresCierreDiaIngestaRepository.ts/PostgresCierreTurnoIngestaRepository.ts,
// sin transaccion explicita (no hay ningun INSERT que coordinar con esta
// lectura, a diferencia de esos dos).

import { ExecuteStatementCommand, RDSDataClient } from '@aws-sdk/client-rds-data';
import { conReintentoSiDbEstaResumiendo } from '@fuelhub/shared-kernel';
import type { EstacionLookupRepository } from '../../application/ports/EstacionLookupRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

export class PostgresEstacionLookupRepository implements EstacionLookupRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async resolverEstacionId(codigoEstacion: string): Promise<string | undefined> {
    const resultado = await conReintentoSiDbEstaResumiendo(() =>
      this.client.send(
        new ExecuteStatementCommand({
          resourceArn: this.config.resourceArn,
          secretArn: this.config.secretArn,
          database: this.config.database,
          sql: 'SELECT id FROM estaciones WHERE codigo = :codigo AND activo = true',
          parameters: [{ name: 'codigo', value: { stringValue: codigoEstacion } }],
          formatRecordsAs: 'JSON',
        })
      )
    );

    const filas = resultado.formattedRecords ? (JSON.parse(resultado.formattedRecords) as Array<{ id: unknown }>) : [];
    return filas[0] ? String(filas[0].id) : undefined;
  }
}
