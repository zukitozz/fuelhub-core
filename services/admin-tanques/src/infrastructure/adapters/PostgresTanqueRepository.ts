// infrastructure/adapters/PostgresTanqueRepository.ts
//
// Única capa que conoce RDS Data API y el esquema real (sección 3.3).
// `listar`/`obtenerPorId` son de solo lectura (sin transacción explícita,
// igual que en consulta-cierres). `actualizar` sí usa una transacción
// (Begin/Commit/Rollback) porque, cuando `productoId` cambia, primero hay
// que validarlo contra el catálogo activo antes del `UPDATE` — mismo
// criterio de atomicidad que los adaptadores de ingesta.

import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';
import { ParametrosInvalidosError, RecursoNoEncontradoError, conReintentoSiDbEstaResumiendo } from '@fuelhub/shared-kernel';
import type { CambiosTanque, TanqueDTO, TanqueRepository } from '../../application/ports/TanqueRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

const SELECT_BASE = `
  SELECT t.id, e.codigo AS codigo_estacion, t.producto_id, t.nombre, t.capacidad, t.stock_minimo,
         t.producto_asignado_en, t.activo, t.creado_en
  FROM tanques t
  JOIN estaciones e ON e.id = t.estacion_id
`;

const SELECT_BASE_TX = `${SELECT_BASE} WHERE t.id = CAST(:id AS uuid)`;

export class PostgresTanqueRepository implements TanqueRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async listar(estacionCodigo?: string): Promise<TanqueDTO[]> {
    const whereSql = estacionCodigo ? 'WHERE e.codigo = :estacionCodigo' : '';
    const parametros = estacionCodigo ? [paramText('estacionCodigo', estacionCodigo)] : [];
    const filas = await this.ejecutarSinTransaccion(`${SELECT_BASE} ${whereSql} ORDER BY e.codigo, t.nombre`, parametros);
    return filas.map(mapearFila);
  }

  async obtenerPorId(id: string): Promise<TanqueDTO | undefined> {
    const filas = await this.ejecutarSinTransaccion(`${SELECT_BASE} WHERE t.id = CAST(:id AS uuid)`, [paramText('id', id)]);
    return filas[0] ? mapearFila(filas[0]) : undefined;
  }

  async actualizar(id: string, cambios: CambiosTanque): Promise<TanqueDTO> {
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
      if (cambios.productoId !== undefined) {
        const filas = await this.ejecutar(
          'SELECT id FROM productos_maestro WHERE id = CAST(:id AS uuid) AND activo = true',
          [paramText('id', cambios.productoId)],
          transactionId
        );
        if (filas.length === 0) {
          throw new ParametrosInvalidosError('productoId no reconocido.', [
            { field: 'productoId', issue: 'no existe en productos_maestro o no está activo' },
          ]);
        }
      }

      const sets: string[] = [];
      const parametros: SqlParameter[] = [paramText('id', id)];

      if (cambios.productoId !== undefined) {
        sets.push('producto_id = CAST(:productoId AS uuid)', 'producto_asignado_en = now()');
        parametros.push(paramText('productoId', cambios.productoId));
      }
      if (cambios.capacidad !== undefined) {
        sets.push('capacidad = :capacidad');
        parametros.push(paramDecimal('capacidad', cambios.capacidad));
      }
      if (cambios.stockMinimo !== undefined) {
        sets.push('stock_minimo = :stockMinimo');
        parametros.push(paramDecimal('stockMinimo', cambios.stockMinimo));
      }
      if (cambios.activo !== undefined) {
        sets.push('activo = :activo');
        parametros.push({ name: 'activo', value: { booleanValue: cambios.activo } });
      }

      // `validarTanqueUpdate` (dominio) ya exige al menos un campo, pero se
      // deja esta guarda igual — si algún día se relaja esa regla, un UPDATE
      // sin SET no debe llegar a ejecutarse.
      const filaActualizada =
        sets.length > 0
          ? (
              await this.ejecutar(
                `UPDATE tanques t SET ${sets.join(', ')}
                 FROM estaciones e
                 WHERE t.estacion_id = e.id AND t.id = CAST(:id AS uuid)
                 RETURNING t.id, e.codigo AS codigo_estacion, t.producto_id, t.nombre, t.capacidad, t.stock_minimo,
                           t.producto_asignado_en, t.activo, t.creado_en`,
                parametros,
                transactionId
              )
            )[0]
          : (await this.ejecutar(SELECT_BASE_TX, [paramText('id', id)], transactionId))[0];

      if (!filaActualizada) {
        throw new RecursoNoEncontradoError('Tanque', id);
      }

      await conReintentoSiDbEstaResumiendo(() => this.client.send(
        new CommitTransactionCommand({
          resourceArn: this.config.resourceArn,
          secretArn: this.config.secretArn,
          transactionId,
        })
      ));

      return mapearFila(filaActualizada);
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

  private async ejecutarSinTransaccion(sql: string, parameters: SqlParameter[]): Promise<Record<string, unknown>[]> {
    const resultado = await conReintentoSiDbEstaResumiendo(() => this.client.send(
      new ExecuteStatementCommand({
        resourceArn: this.config.resourceArn,
        secretArn: this.config.secretArn,
        database: this.config.database,
        sql,
        parameters,
        formatRecordsAs: 'JSON',
      })
    ));
    return resultado.formattedRecords ? (JSON.parse(resultado.formattedRecords) as Record<string, unknown>[]) : [];
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

function mapearFila(fila: Record<string, unknown>): TanqueDTO {
  return {
    id: String(fila.id),
    codigoEstacion: String(fila.codigo_estacion),
    productoId: String(fila.producto_id),
    nombre: String(fila.nombre),
    capacidad: Number(fila.capacidad),
    stockMinimo: fila.stock_minimo === null || fila.stock_minimo === undefined ? null : Number(fila.stock_minimo),
    productoAsignadoEn: String(fila.producto_asignado_en),
    activo: Boolean(fila.activo),
    creadoEn: String(fila.creado_en),
  };
}
