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
//
// v1.75: `usuarios` pasó de UNIQUE global sobre `usuario` a UNIQUE
// COMPUESTO `(estacion_id, usuario)` (migración
// 1788500000000_usuario-unico-por-estacion.sql) — la suposición original de
// la sección 9.7 (un código de persona nunca se repite entre estaciones)
// resultó incorrecta: cada estación es una empresa distinta con su propio
// sistema legacy asignando códigos de forma independiente, y dos personas
// reales en dos estaciones distintas SÍ pueden compartir código por
// coincidencia (hallazgo real de Jorge, `POST /cierres-dia` rechazado sin
// motivo válido). Con el conflicto ya acotado a la propia estación, el
// UPSERT de abajo ya no necesita el `WHERE`/chequeo manual de "otra
// estación" — un conflicto entre estaciones distintas no puede ocurrir.
//
// v1.76: el payload ahora exige `cierresTurnoIds` (hallazgo real de Jorge en
// el reporte de un día concreto) — ver `vincularCierresTurno` más abajo. Se
// agrega un tercer paso a la transacción, después del INSERT de la cabecera:
// vincular esos `cierres_turno.cierre_dia_id` al `cierres_dia` recién creado.
// Sin esto, ese campo queda NULL para siempre (ningún otro caso de uso lo
// escribe) y `PostgresReporteDiaQueryRepository` no tiene forma no-ambigua de
// saber qué turnos pertenecen a qué día cuando hay más de un `cierres_dia`
// para la misma estación+fecha.

import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';
import { ParametrosInvalidosError, conReintentoSiDbEstaResumiendo } from '@fuelhub/shared-kernel';
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

      // v1.75: ya no puede devolver `undefined` — ver la nota de cabecera
      // sobre el UNIQUE compuesto `(estacion_id, usuario)`.
      const usuarioId = await this.resolverOAutoprovisionarAdministrador(datos.administrador, estacionId, transactionId);

      const cabecera = await this.insertarCabecera(datos, estacionId, usuarioId, transactionId);

      await this.vincularCierresTurno(datos.cierresTurnoIds, cabecera.id, estacionId, transactionId);

      await conReintentoSiDbEstaResumiendo(() => this.client.send(
        new CommitTransactionCommand({
          resourceArn: this.config.resourceArn,
          secretArn: this.config.secretArn,
          transactionId,
        })
      ));

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
  ): Promise<string> {
    // Mismo UPSERT atómico que en ingest-cierre-turno, con `rol = 'ADMINISTRADOR'`
    // (sección 3.7.1) — ver el comentario extendido en
    // `PostgresCierreTurnoIngestaRepository.ts` sobre por qué es atómico y no
    // "buscar, decidir, insertar" en dos pasos. `correo` se omite del INSERT
    // (columna nullable desde v1.47) porque el payload no lo trae.
    //
    // v1.75: `ON CONFLICT (estacion_id, usuario)` (antes `ON CONFLICT
    // (usuario)` + `WHERE` manual) — con el UNIQUE ya compuesto, el
    // conflicto solo puede darse dentro de la MISMA estación, así que el
    // `DO UPDATE` siempre se aplica y `RETURNING` siempre trae una fila.
    const filas = await this.ejecutar(
      `INSERT INTO usuarios (estacion_id, usuario, nombre, rol)
       VALUES (CAST(:estacionId AS uuid), :usuario, :nombre, 'ADMINISTRADOR')
       ON CONFLICT (estacion_id, usuario) DO UPDATE
         SET nombre = EXCLUDED.nombre, actualizado_en = now()
       RETURNING id`,
      [paramText('estacionId', estacionId), paramText('usuario', administrador.codigo), paramText('nombre', administrador.nombre)],
      transactionId
    );
    const fila = filas[0];
    if (!fila) {
      // No debería ocurrir tras el UNIQUE compuesto (estacion_id, usuario)
      // de v1.75 -- el UPSERT siempre inserta o actualiza exactamente una
      // fila. Si esto se dispara, es un bug real (o el índice cambió sin
      // actualizar este comentario), no un error de datos del cliente.
      throw new Error('INSERT ... ON CONFLICT sobre usuarios no devolvió ninguna fila (ver v1.75).');
    }
    return String(fila.id);
  }

  /**
   * v1.76 -- vincula cada `cierres_turno.id` recibido con el `cierres_dia`
   * recién insertado, DENTRO de la misma transacción. Mismo motivo que el
   * hallazgo documentado en `PostgresReporteDiaQueryRepository.ts`: sin este
   * `UPDATE`, `cierre_dia_id` queda NULL para siempre y los reportes no
   * tienen forma no-ambigua de saber qué turnos pertenecen a qué día.
   *
   * `IN (CAST(:id0 AS uuid), ...)` en vez de un solo parámetro de array --
   * mismo criterio que `PostgresCierreTurnoIngestaRepository.validarProductos`
   * (v1.51): RDS Data API rechaza `arrayValue` en runtime.
   *
   * Si `RETURNING` trae menos filas que `cierresTurnoIds.length`, algún id no
   * existe, es de otra estación, no está `ACTIVO`, o ya tenía un
   * `cierre_dia_id` asignado -- se rechaza el cierre de día COMPLETO (decisión
   * de Jorge: nada de best-effort acá) lanzando, lo que hace que el `catch`
   * de `registrar()` haga ROLLBACK de todo, INSERT de la cabecera incluido.
   */
  private async vincularCierresTurno(
    cierresTurnoIds: readonly string[],
    cierreDiaId: string,
    estacionId: string,
    transactionId: string
  ): Promise<void> {
    const idsUnicos = [...new Set(cierresTurnoIds)];
    const placeholders = idsUnicos.map((_, i) => `CAST(:id${i} AS uuid)`).join(', ');
    const filas = await this.ejecutar(
      `UPDATE cierres_turno
       SET cierre_dia_id = CAST(:cierreDiaId AS uuid)
       WHERE id IN (${placeholders})
         AND estacion_id = CAST(:estacionId AS uuid)
         AND estado = 'ACTIVO'
         AND cierre_dia_id IS NULL
       RETURNING id`,
      [
        paramText('cierreDiaId', cierreDiaId),
        paramText('estacionId', estacionId),
        ...idsUnicos.map((id, i) => paramText(`id${i}`, id)),
      ],
      transactionId
    );

    if (filas.length !== idsUnicos.length) {
      const vinculados = new Set(filas.map((f) => String(f.id)));
      const noMatchean = idsUnicos.filter((id) => !vinculados.has(id));
      throw new ParametrosInvalidosError(
        'Uno o más cierresTurnoIds no se pudieron vincular a este cierre de día.',
        noMatchean.map((id) => ({
          field: 'cierresTurnoIds',
          issue: `id ${id}: no existe, no es de ${estacionId}, no está ACTIVO, o ya tiene un cierre de día asignado`,
        }))
      );
    }
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
