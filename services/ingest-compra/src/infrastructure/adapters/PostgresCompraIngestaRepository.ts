// infrastructure/adapters/PostgresCompraIngestaRepository.ts
//
// Misma estrategia transaccional que los adaptadores de ingesta de cierres
// (BeginTransaction/Commit/RollbackTransaction explícitos de RDS Data API) —
// acá con menos pasos: no hay auto-provisioning de usuario, solo resolver
// estación, validar producto activo, validar tanque (si se envía) y el
// INSERT. `costo_total` es `GENERATED ALWAYS AS (cantidad * costo_unitario)
// STORED` (sección 3.3) — no se inserta, se lee de vuelta con `RETURNING`.

import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';
import { ParametrosInvalidosError, conReintentoSiDbEstaResumiendo } from '@fuelhub/shared-kernel';
import type { CompraIngestaRepository, CompraOutputDTO, DatosCompraAInsertar } from '../../application/ports/CompraIngestaRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

export class PostgresCompraIngestaRepository implements CompraIngestaRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async registrar(datos: DatosCompraAInsertar): Promise<CompraOutputDTO> {
    const inicio = await conReintentoSiDbEstaResumiendo(() => this.client.send(
      new BeginTransactionCommand({
        resourceArn: this.config.resourceArn,
        secretArn: this.config.secretArn,
        database: this.config.database,
      })
    ));
    const transactionId = inicio.transactionId;
    if (!transactionId) {
      throw new Error('RDS Data API no devolvió transactionId al iniciar la transacción.');
    }

    try {
      const estacionId = await this.resolverEstacion(datos.codigoEstacion, transactionId);
      if (!estacionId) {
        throw new ParametrosInvalidosError('codigoEstacion no reconocido.', [
          { field: 'codigoEstacion', issue: 'no existe en estaciones o no está activa' },
        ]);
      }

      const productoValido = await this.validarProducto(datos.productoId, transactionId);
      if (!productoValido) {
        throw new ParametrosInvalidosError('productoId no reconocido.', [
          { field: 'productoId', issue: 'no existe en productos_maestro o no está activo' },
        ]);
      }

      if (datos.tanqueId) {
        const tanqueValido = await this.validarTanque(datos.tanqueId, estacionId, transactionId);
        if (!tanqueValido) {
          throw new ParametrosInvalidosError('tanqueId no reconocido para esta estación.', [
            { field: 'tanqueId', issue: 'no existe o pertenece a otra estación' },
          ]);
        }
      }

      const cabecera = await this.insertarCompra(datos, estacionId, transactionId);

      await conReintentoSiDbEstaResumiendo(() => this.client.send(
        new CommitTransactionCommand({
          resourceArn: this.config.resourceArn,
          secretArn: this.config.secretArn,
          transactionId,
        })
      ));

      return cabecera;
    } catch (err) {
      await this.client
        .send(
          new RollbackTransactionCommand({
            resourceArn: this.config.resourceArn,
            secretArn: this.config.secretArn,
            transactionId,
          })
        )
        .catch((errorDeRollback) => console.error('Falló el ROLLBACK de la transacción:', errorDeRollback));
      throw err;
    }
  }

  private async resolverEstacion(codigo: string, transactionId: string): Promise<string | undefined> {
    const filas = await this.ejecutar(
      'SELECT id FROM estaciones WHERE codigo = :codigo AND activo = true',
      [paramText('codigo', codigo)],
      transactionId
    );
    return filas[0] ? String(filas[0].id) : undefined;
  }

  private async validarProducto(productoId: string, transactionId: string): Promise<boolean> {
    const filas = await this.ejecutar(
      'SELECT id FROM productos_maestro WHERE id = CAST(:id AS uuid) AND activo = true',
      [paramText('id', productoId)],
      transactionId
    );
    return filas.length > 0;
  }

  private async validarTanque(tanqueId: string, estacionId: string, transactionId: string): Promise<boolean> {
    const filas = await this.ejecutar(
      'SELECT id FROM tanques WHERE id = CAST(:id AS uuid) AND estacion_id = CAST(:estacionId AS uuid) AND activo = true',
      [paramText('id', tanqueId), paramText('estacionId', estacionId)],
      transactionId
    );
    return filas.length > 0;
  }

  private async insertarCompra(datos: DatosCompraAInsertar, estacionId: string, transactionId: string): Promise<CompraOutputDTO> {
    const filas = await this.ejecutar(
      `INSERT INTO compras (estacion_id, tanque_id, producto_id, proveedor, fecha, cantidad, costo_unitario, numero_guia)
       VALUES (CAST(:estacionId AS uuid), CAST(:tanqueId AS uuid), CAST(:productoId AS uuid), :proveedor,
               CAST(:fecha AS timestamptz), :cantidad, :costoUnitario, :numeroGuia)
       RETURNING id, costo_total, creado_en`,
      [
        paramText('estacionId', estacionId),
        paramText('tanqueId', datos.tanqueId ?? null),
        paramText('productoId', datos.productoId),
        paramText('proveedor', datos.proveedor ?? null),
        paramText('fecha', datos.fecha),
        paramDecimal('cantidad', datos.cantidad),
        paramDecimal('costoUnitario', datos.costoUnitario),
        paramText('numeroGuia', datos.numeroGuia ?? null),
      ],
      transactionId
    );
    const fila = filas[0];
    if (!fila) throw new Error('El INSERT de compras no devolvió fila (inesperado).');

    return {
      id: String(fila.id),
      codigoEstacion: datos.codigoEstacion,
      tanqueId: datos.tanqueId ?? null,
      productoId: datos.productoId,
      proveedor: datos.proveedor ?? null,
      fecha: datos.fecha,
      cantidad: datos.cantidad,
      costoUnitario: datos.costoUnitario,
      costoTotal: Number(fila.costo_total),
      numeroGuia: datos.numeroGuia ?? null,
      creadoEn: String(fila.creado_en),
    };
  }

  private async ejecutar(sql: string, parameters: SqlParameter[], transactionId: string): Promise<Record<string, unknown>[]> {
    const resultado = await conReintentoSiDbEstaResumiendo(() => this.client.send(
      new ExecuteStatementCommand({
        resourceArn: this.config.resourceArn,
        secretArn: this.config.secretArn,
        database: this.config.database,
        sql,
        parameters,
        transactionId,
        formatRecordsAs: 'JSON',
      })
    ));
    return resultado.formattedRecords ? (JSON.parse(resultado.formattedRecords) as Record<string, unknown>[]) : [];
  }
}

function paramText(name: string, value: string | null | undefined): SqlParameter {
  if (value === null || value === undefined) return { name, value: { isNull: true } };
  return { name, value: { stringValue: value } };
}

function paramDecimal(name: string, value: number | null | undefined): SqlParameter {
  if (value === null || value === undefined) return { name, value: { isNull: true } };
  return { name, value: { stringValue: String(value) }, typeHint: 'DECIMAL' };
}
