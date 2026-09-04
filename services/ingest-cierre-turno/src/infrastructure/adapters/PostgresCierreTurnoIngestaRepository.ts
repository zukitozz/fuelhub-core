// infrastructure/adapters/PostgresCierreTurnoIngestaRepository.ts
//
// Única capa que conoce RDS Data API y el esquema real (sección 3.3). A
// diferencia de los adaptadores de solo lectura de consulta-cierres/
// consulta-cierre-detalle, acá TODO ocurre dentro de una única transacción
// explícita (BeginTransaction/Commit/Rollback de RDS Data API) porque hay
// varios pasos con efectos secundarios que deben ser atómicos entre sí:
// resolver la estación, validar los `productoId` del detalle, auto-provisionar
// o verificar al empleado, e insertar cabecera + pagos + detalle. Si cualquier
// paso falla, se hace ROLLBACK — nunca queda, por ejemplo, un usuario
// auto-provisionado "huérfano" de un cierre que terminó fallando.
//
// Nota sobre el auto-provisioning del empleado (sección 3.7): se resuelve con
// un único `INSERT ... ON CONFLICT (usuario) DO UPDATE ... WHERE ... RETURNING`
// en vez de "buscar, decidir, y luego insertar/actualizar" — ese patrón de dos
// pasos tiene una condición de carrera real (dos cierres del mismo operador
// llegando casi al mismo tiempo). El UPSERT es atómico: si la fila en
// conflicto tiene un `estacion_id` distinto, el `WHERE` de la cláusula
// `DO UPDATE` no se cumple, Postgres no actualiza nada, y `RETURNING` no
// devuelve fila — eso es la señal de "empleado pertenece a otra estación",
// sin necesitar un SELECT previo.
//
// `usuarios.correo` (DDL 3.3) es NULLABLE desde v1.47 — el payload de
// `empleado` (sección 3.9) solo trae `{ codigo, nombre }`, nunca un correo,
// así que el auto-provisioning de abajo simplemente no lo incluye en el
// INSERT y la columna queda en NULL (no `''`, que antes se usaba como
// placeholder y quedaba indistinguible de "correo vacío mandado a propósito").

import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';
import { ParametrosInvalidosError, conReintentoSiDbEstaResumiendo } from '@fuelhub/shared-kernel';
import type { CategoriaProducto, CierreTurnoDetalleDTO, DetalleLinea, Pago } from '@fuelhub/shared-kernel';
import type { DetalleLineaInput, EmpleadoInput, PagoInput } from '../../domain/CierreTurnoInput';
import type { CierreTurnoIngestaRepository, DatosCierreTurnoAInsertar } from '../../application/ports/CierreTurnoIngestaRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

export class PostgresCierreTurnoIngestaRepository implements CierreTurnoIngestaRepository {
  constructor(private readonly client: RDSDataClient, private readonly config: AuroraDataApiConfig) {}

  async registrar(datos: DatosCierreTurnoAInsertar): Promise<CierreTurnoDetalleDTO> {
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

      const categoriaPorProductoId = await this.validarProductos(datos.detalle, transactionId);

      const usuarioId = await this.resolverOAutoprovisionarEmpleado(datos.empleado, estacionId, transactionId);
      if (!usuarioId) {
        throw new ParametrosInvalidosError('empleado.codigo ya está registrado en otra estación.', [
          { field: 'empleado.codigo', issue: 'pertenece a una estación distinta — ver sección 9.7' },
        ]);
      }

      const cabecera = await this.insertarCabecera(datos, estacionId, usuarioId, transactionId);
      const pagos = await this.insertarPagos(cabecera.id, datos.pagos, transactionId);
      const detalle = await this.insertarDetalle(cabecera.id, datos.detalle, categoriaPorProductoId, transactionId);

      await conReintentoSiDbEstaResumiendo(() => this.client.send(
        new CommitTransactionCommand({
          resourceArn: this.config.resourceArn,
          secretArn: this.config.secretArn,
          transactionId,
        })
      ));

      return {
        id: cabecera.id,
        codigoEstacion: datos.codigoEstacion,
        isla: datos.isla ?? null,
        turno: datos.turno as CierreTurnoDetalleDTO['turno'],
        fechaNegocio: datos.fechaNegocio,
        fechaInicio: datos.fechaInicio,
        fecha: datos.fecha,
        total: datos.total,
        estado: 'ACTIVO',
        empleado: { codigo: datos.empleado.codigo, nombre: datos.empleado.nombre },
        recibidoEn: cabecera.recibidoEn,
        cierreDiaId: null, // se enlaza más adelante desde ingest-cierre-dia (sección 3.10), no acá
        facturasEmitidas: datos.facturasEmitidas ?? 0,
        clienteOrigen: datos.clienteOrigen,
        pagos,
        detalle,
      };
    } catch (err) {
      await this.client
        .send(
          new RollbackTransactionCommand({
            resourceArn: this.config.resourceArn,
            secretArn: this.config.secretArn,
            transactionId,
          })
        )
        // Si el propio rollback falla (p. ej. conexión caída), se prioriza
        // propagar el error de negocio original — no lo pisa un error de infra.
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

  /**
   * Valida que cada `productoId` referenciado exista y esté activo, y de paso
   * devuelve su `categoria` (v1.58) — el catálogo es la fuente de verdad para
   * la clasificación combustible/no-combustible de esas líneas, así que
   * `insertarDetalle` nunca debe volver a preguntarle a la línea de entrada
   * su propia `categoria` cuando trae `productoId` (ver comentario en
   * `DetalleLineaInput.categoria`).
   */
  private async validarProductos(
    detalle: readonly DetalleLineaInput[],
    transactionId: string
  ): Promise<Map<string, CategoriaProducto>> {
    const referenciados = detalle
      .map((linea, i) => ({ i, id: linea.productoId }))
      .filter((x): x is { i: number; id: string } => !!x.id);

    if (referenciados.length === 0) return new Map(); // ninguna línea usa el catálogo cruzado (sección 3.8.1.1)

    // v1.51 -- descubierto en el primer test:integration real contra Aurora:
    // RDS Data API rechaza `arrayValue` acá con "ValidationException: Array
    // parameters are not supported." (limitación real del servicio, no un
    // typo de tipos -- el SDK sí tiene el campo `arrayValue`, pero esta
    // llamada concreta lo rechaza en runtime). Se arma un placeholder
    // individual por id en vez de un solo parámetro de array.
    const idsUnicos = [...new Set(referenciados.map((x) => x.id))];
    const placeholders = idsUnicos.map((_, i) => `CAST(:id${i} AS uuid)`).join(', ');
    const filas = await this.ejecutar(
      `SELECT id, categoria FROM productos_maestro WHERE id IN (${placeholders}) AND activo = true`,
      idsUnicos.map((id, i) => paramText(`id${i}`, id)),
      transactionId
    );
    const categoriaPorId = new Map(filas.map((f) => [String(f.id), String(f.categoria) as CategoriaProducto]));
    const faltantes = referenciados.filter((x) => !categoriaPorId.has(x.id));

    if (faltantes.length > 0) {
      throw new ParametrosInvalidosError(
        'Uno o más productoId no existen en el catálogo o no están activos.',
        faltantes.map((f) => ({ field: `detalle[${f.i}].productoId`, issue: 'no existe en productos_maestro o no está activo' }))
      );
    }

    return categoriaPorId;
  }

  private async resolverOAutoprovisionarEmpleado(
    empleado: EmpleadoInput,
    estacionId: string,
    transactionId: string
  ): Promise<string | undefined> {
    // Ver nota de cabecera del archivo: `correo` no viene en el payload, y
    // desde v1.47 la columna es nullable — se omite del INSERT y queda NULL.
    const filas = await this.ejecutar(
      `INSERT INTO usuarios (estacion_id, usuario, nombre, rol)
       VALUES (CAST(:estacionId AS uuid), :usuario, :nombre, 'OPERADOR')
       ON CONFLICT (usuario) DO UPDATE
         SET nombre = EXCLUDED.nombre, actualizado_en = now()
         WHERE usuarios.estacion_id = EXCLUDED.estacion_id
       RETURNING id`,
      [paramText('estacionId', estacionId), paramText('usuario', empleado.codigo), paramText('nombre', empleado.nombre)],
      transactionId
    );
    return filas[0] ? String(filas[0].id) : undefined;
  }

  private async insertarCabecera(
    datos: DatosCierreTurnoAInsertar,
    estacionId: string,
    usuarioId: string,
    transactionId: string
  ): Promise<{ id: string; recibidoEn: string }> {
    const filas = await this.ejecutar(
      `INSERT INTO cierres_turno
         (estacion_id, isla, turno, fecha_negocio, fecha_inicio, fecha, total, facturas_emitidas, usuario_id, cliente_origen, payload_original)
       VALUES
         (CAST(:estacionId AS uuid), :isla, CAST(:turno AS turno_enum), CAST(:fechaNegocio AS date),
          CAST(:fechaInicio AS timestamptz), CAST(:fecha AS timestamptz), :total, :facturasEmitidas,
          CAST(:usuarioId AS uuid), :clienteOrigen, CAST(:payloadOriginal AS jsonb))
       RETURNING id, recibido_en`,
      [
        paramText('estacionId', estacionId),
        paramText('isla', datos.isla ?? null),
        paramText('turno', datos.turno),
        paramText('fechaNegocio', datos.fechaNegocio),
        paramText('fechaInicio', datos.fechaInicio),
        paramText('fecha', datos.fecha),
        paramDecimal('total', datos.total),
        paramInt('facturasEmitidas', datos.facturasEmitidas ?? 0),
        paramText('usuarioId', usuarioId),
        paramText('clienteOrigen', datos.clienteOrigen),
        paramText('payloadOriginal', JSON.stringify(datos)),
      ],
      transactionId
    );
    const fila = filas[0];
    if (!fila) throw new Error('El INSERT de cierres_turno no devolvió fila (inesperado).');
    return { id: String(fila.id), recibidoEn: String(fila.recibido_en) };
  }

  private async insertarPagos(cierreTurnoId: string, pagos: readonly PagoInput[], transactionId: string): Promise<Pago[]> {
    const resultado: Pago[] = [];
    for (const pago of pagos) {
      await this.ejecutar(
        `INSERT INTO cierres_turno_pagos (cierre_turno_id, medio_pago, monto) VALUES (CAST(:cierreTurnoId AS uuid), :medio, :monto)`,
        [paramText('cierreTurnoId', cierreTurnoId), paramText('medio', pago.medio), paramDecimal('monto', pago.monto)],
        transactionId
      );
      resultado.push({ medio: pago.medio, monto: pago.monto });
    }
    return resultado;
  }

  private async insertarDetalle(
    cierreTurnoId: string,
    detalle: readonly DetalleLineaInput[],
    categoriaPorProductoId: Map<string, CategoriaProducto>,
    transactionId: string
  ): Promise<DetalleLinea[]> {
    const resultado: DetalleLinea[] = [];
    for (const linea of detalle) {
      // v1.58: con productoId, la categoría SIEMPRE viene del catálogo
      // (`categoriaPorProductoId`, resuelta en `validarProductos`) — se
      // ignora a propósito cualquier `categoria` que la línea de entrada
      // traiga en ese caso, el catálogo es la fuente de verdad. Sin
      // productoId, se usa lo que mandó el cliente (o NULL si no mandó nada).
      const categoria = linea.productoId ? categoriaPorProductoId.get(linea.productoId) ?? null : linea.categoria ?? null;

      await this.ejecutar(
        `INSERT INTO cierres_turno_detalle
           (cierre_turno_id, producto_id, producto_codigo_local, producto_nombre, medida,
            total_cantidad, total_soles, calibracion_cantidad, calibracion_soles, despacho_cantidad, despacho_soles, categoria)
         VALUES
           (CAST(:cierreTurnoId AS uuid), CAST(:productoId AS uuid), :codigoLocal, :producto, :medida,
            :totalCantidad, :totalSoles, :calibracionCantidad, :calibracionSoles, :despachoCantidad, :despachoSoles,
            CAST(:categoria AS categoria_producto))`,
        [
          paramText('cierreTurnoId', cierreTurnoId),
          paramText('productoId', linea.productoId ?? null),
          paramText('codigoLocal', linea.codigoLocal ?? null),
          paramText('producto', linea.producto),
          paramText('medida', linea.medida ?? null),
          paramDecimal('totalCantidad', linea.totalCantidad),
          paramDecimal('totalSoles', linea.totalSoles),
          paramDecimal('calibracionCantidad', linea.calibracionCantidad ?? null),
          paramDecimal('calibracionSoles', linea.calibracionSoles ?? null),
          paramDecimal('despachoCantidad', linea.despachoCantidad ?? null),
          paramDecimal('despachoSoles', linea.despachoSoles ?? null),
          paramText('categoria', categoria),
        ],
        transactionId
      );
      resultado.push({
        productoId: linea.productoId ?? null,
        codigoLocal: linea.codigoLocal ?? null,
        producto: linea.producto,
        medida: linea.medida ?? null,
        totalCantidad: linea.totalCantidad,
        totalSoles: linea.totalSoles,
        calibracionCantidad: linea.calibracionCantidad ?? null,
        calibracionSoles: linea.calibracionSoles ?? null,
        despachoCantidad: linea.despachoCantidad ?? null,
        despachoSoles: linea.despachoSoles ?? null,
        categoria,
      });
    }
    return resultado;
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

function paramInt(name: string, value: number | null | undefined): SqlParameter {
  if (value === null || value === undefined) return { name, value: { isNull: true } };
  return { name, value: { longValue: value } };
}

/** NUMERIC(...) de Postgres — se pasa como string + typeHint DECIMAL para no perder precisión con floats de JS (montos/cantidades). */
function paramDecimal(name: string, value: number | null | undefined): SqlParameter {
  if (value === null || value === undefined) return { name, value: { isNull: true } };
  return { name, value: { stringValue: String(value) }, typeHint: 'DECIMAL' };
}
