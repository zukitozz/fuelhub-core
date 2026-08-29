// infrastructure/adapters/PostgresCierreDiaIngestaRepository.ts
//
// Misma estrategia transaccional que `PostgresCierreTurnoIngestaRepository.ts`
// (BeginTransaction/Commit/RollbackTransaction explícitos de RDS Data API),
// simplificada: no hay productos ni líneas de detalle que validar/insertar,
// solo resolver estación + auto-provisionar/verificar administrador + un
// único INSERT en `cierres_dia`.
//
// `usuarios.correo` (DDL 3.3) es NULLABLE desde v1.47 — el payload de
// `administrador` (sección 3.9/11) no lo trae, así que el auto-provisioning
// de abajo no lo incluye en el INSERT y queda en NULL (mismo criterio que
// `ingest-cierre-turno`, ver el comentario extendido ahí).

import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';
import { ParametrosInvalidosError } from '@fuelhub/shared-kernel';
import type { CierreDiaResumenDTO } from '@fuelhub/shared-kernel';
import type { AdministradorInput } from '../../domain/CierreDiaInput';
import type { CierreDiaIngestaRepository, DatosCierreDiaAInsertar } from '../../application/ports/CierreDiaIngestaRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

export class PostgresCierreDiaIngestaRepository implements CierreDiaIngestaRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async registrar(datos: DatosCierreDiaAInsertar): Promise<{ dto: CierreDiaResumenDTO; estacionId: string }> {
    const inicio = await this.client.send(
      new BeginTransactionCommand({
        resourceArn: this.config.resourceArn,
        secretArn: this.config.secretArn,
        database: this.config.database,
      })
    );
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

      const usuarioId = await this.resolverOAutoprovisionarAdministrador(datos.administrador, estacionId, transactionId);
      if (!usuarioId) {
        throw new ParametrosInvalidosError('administrador.codigo ya está registrado en otra estación.', [
          { field: 'administrador.codigo', issue: 'pertenece a una estación distinta — ver sección 9.7' },
        ]);
      }

      const cabecera = await this.insertarCabecera(datos, estacionId, usuarioId, transactionId);

      await this.client.send(
        new CommitTransactionCommand({
          resourceArn: this.config.resourceArn,
          secretArn: this.config.secretArn,
          transactionId,
        })
      );

      const dto: CierreDiaResumenDTO = {
        id: cabecera.id,
        codigoEstacion: datos.codigoEstacion,
        isla: datos.isla ?? null,
        fechaNegocio: datos.fechaNegocio,
        fecha: datos.fecha,
        total: datos.total,
        estado: 'ACTIVO',
        administrador: { codigo: datos.administrador.codigo, nombre: datos.administrador.nombre },
        recibidoEn: cabecera.recibidoEn,
      };

      return { dto, estacionId };
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

  private async resolverOAutoprovisionarAdministrador(
    administrador: AdministradorInput,
    estacionId: string,
    transactionId: string
  ): Promise<string | undefined> {
    // Mismo UPSERT atómico que en ingest-cierre-turno, con `rol = 'ADMINISTRADOR'`
    // (sección 3.7.1) — ver el comentario extendido en
    // `PostgresCierreTurnoIngestaRepository.ts` sobre por qué es atómico y no
    // "buscar, decidir, insertar" en dos pasos. `correo` se omite del INSERT
    // (columna nullable desde v1.47) porque el payload no lo trae.
    const filas = await this.ejecutar(
      `INSERT INTO usuarios (estacion_id, usuario, nombre, rol)
       VALUES (CAST(:estacionId AS uuid), :usuario, :nombre, 'ADMINISTRADOR')
       ON CONFLICT (usuario) DO UPDATE
         SET nombre = EXCLUDED.nombre, actualizado_en = now()
         WHERE usuarios.estacion_id = EXCLUDED.estacion_id
       RETURNING id`,
      [paramText('estacionId', estacionId), paramText('usuario', administrador.codigo), paramText('nombre', administrador.nombre)],
      transactionId
    );
    return filas[0] ? String(filas[0].id) : undefined;
  }

  private async insertarCabecera(
    datos: DatosCierreDiaAInsertar,
    estacionId: string,
    usuarioId: string,
    transactionId: string
  ): Promise<{ id: string; recibidoEn: string }> {
    const filas = await this.ejecutar(
      `INSERT INTO cierres_dia
         (estacion_id, isla, fecha_negocio, fecha, total, usuario_id, cliente_origen, payload_original)
       VALUES
         (CAST(:estacionId AS uuid), :isla, CAST(:fechaNegocio AS date), CAST(:fecha AS timestamptz), :total,
          CAST(:usuarioId AS uuid), :clienteOrigen, CAST(:payloadOriginal AS jsonb))
       RETURNING id, recibido_en`,
      [
        paramText('estacionId', estacionId),
        paramText('isla', datos.isla ?? null),
        paramText('fechaNegocio', datos.fechaNegocio),
        paramText('fecha', datos.fecha),
        paramDecimal('total', datos.total),
        paramText('usuarioId', usuarioId),
        paramText('clienteOrigen', datos.clienteOrigen),
        paramText('payloadOriginal', JSON.stringify(datos)),
      ],
      transactionId
    );
    const fila = filas[0];
    if (!fila) throw new Error('El INSERT de cierres_dia no devolvió fila (inesperado).');
    return { id: String(fila.id), recibidoEn: String(fila.recibido_en) };
  }

  private async ejecutar(sql: string, parameters: SqlParameter[], transactionId: string): Promise<Record<string, unknown>[]> {
    const resultado = await this.client.send(
      new ExecuteStatementCommand({
        resourceArn: this.config.resourceArn,
        secretArn: this.config.secretArn,
        database: this.config.database,
        sql,
        parameters,
        transactionId,
        formatRecordsAs: 'JSON',
      })
    );
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
