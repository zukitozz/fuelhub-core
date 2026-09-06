// infrastructure/adapters/PostgresCompraIngestaRepository.ts
//
// Misma estrategia transaccional que los adaptadores de ingesta de cierres
// (BeginTransaction/Commit/RollbackTransaction explícitos de RDS Data API).
// `costo_total` es `GENERATED ALWAYS AS (cantidad * costo_unitario) STORED`
// (sección 3.3) -- no se inserta, se lee de vuelta con `RETURNING`.
//
// v1.65 (migración 1788200000000_extiende-compras-multiproducto-multitanque.sql):
//
//   - `resolverProducto`: `productoId` pasa a opcional. Cuando viene, el
//     catálogo (`productos_maestro`) es la fuente de verdad para
//     `categoria` -- se ignora cualquier `categoria` que mande el cliente,
//     mismo criterio que ya usa `PostgresCierreTurnoIngestaRepository` para
//     `cierres_turno_detalle`. Para `producto_nombre`, en cambio, se usa lo
//     que mande el cliente si lo manda (le permite dar su propio nombre
//     descriptivo a la compra), y solo si no lo manda se cae al nombre del
//     catálogo -- a diferencia de `cierres_turno_detalle`, acá el cliente
//     puede omitir `productoNombre` cuando hay `productoId` (el dominio
//     -- `CompraInput.ts` -- solo lo exige obligatorio sin `productoId`).
//
//   - `validarDestinos` REEMPLAZA a la vieja `validarTanque`: HASTA v1.64 se
//     exigía que el tanque de una compra perteneciera a la MISMA estación
//     que la compra (`WHERE ... AND estacion_id = :estacionId`). Eso ya no
//     aplica -- Jorge describió un caso real de contingencia donde una
//     compra facturada a una estación reparte parte del combustible a un
//     tanque de OTRA estación. `validarDestinos` ahora solo confirma que
//     cada `tanqueId` exista y esté activo, sin importar de qué estación
//     sea. Es una relajación deliberada de una validación que sí existía
//     antes -- documentado acá porque no es obvio de solo leer el código.
//
//   - El INSERT de `compras` ya NO escribe `tanque_id` (columna que queda
//     en el DDL, deprecada -- ver nota de cabecera de la migración): el
//     reparto a tanques vive exclusivamente en `compras_abastecimientos`,
//     insertada en la misma transacción.

import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';
import { ParametrosInvalidosError, conReintentoSiDbEstaResumiendo, type CategoriaProducto } from '@fuelhub/shared-kernel';
import type {
  CompraDestinoDTO,
  CompraIngestaRepository,
  CompraOutputDTO,
  DatosCompraAInsertar,
} from '../../application/ports/CompraIngestaRepository';

export interface AuroraDataApiConfig {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

interface ProductoResuelto {
  readonly productoId: string | null;
  readonly productoNombre: string;
  readonly categoria: CategoriaProducto | null;
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

      const producto = await this.resolverProducto(datos, transactionId);
      await this.validarDestinos(datos.destinos, transactionId);

      const cabecera = await this.insertarCompra(datos, estacionId, producto, transactionId);
      await this.insertarAbastecimientos(cabecera.id, datos.destinos, transactionId);

      await conReintentoSiDbEstaResumiendo(() => this.client.send(
        new CommitTransactionCommand({
          resourceArn: this.config.resourceArn,
          secretArn: this.config.secretArn,
          transactionId,
        })
      ));

      const destinos = datos.destinos ?? [];
      const merma = datos.destinos === undefined ? null : datos.cantidad - sumaDestinos(destinos);

      return {
        id: cabecera.id,
        codigoEstacion: datos.codigoEstacion,
        productoId: producto.productoId,
        productoNombre: producto.productoNombre,
        categoria: producto.categoria,
        proveedor: datos.proveedor ?? null,
        fecha: datos.fecha,
        cantidad: datos.cantidad,
        costoUnitario: datos.costoUnitario,
        costoTotal: cabecera.costoTotal,
        numeroGuia: datos.numeroGuia ?? null,
        destinos,
        merma,
        creadoEn: cabecera.creadoEn,
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

  private async resolverProducto(datos: DatosCompraAInsertar, transactionId: string): Promise<ProductoResuelto> {
    if (!datos.productoId) {
      // Validado en el dominio (CompraInput.validarCompra): sin productoId,
      // productoNombre/categoria ya vinieron confirmados como presentes.
      return {
        productoId: null,
        productoNombre: datos.productoNombre as string,
        categoria: datos.categoria ?? null,
      };
    }

    const filas = await this.ejecutar(
      'SELECT nombre, categoria FROM productos_maestro WHERE id = CAST(:id AS uuid) AND activo = true',
      [paramText('id', datos.productoId)],
      transactionId
    );
    const fila = filas[0];
    if (!fila) {
      throw new ParametrosInvalidosError('productoId no reconocido.', [
        { field: 'productoId', issue: 'no existe en productos_maestro o no está activo' },
      ]);
    }
    return {
      productoId: datos.productoId,
      productoNombre: datos.productoNombre?.trim() ? datos.productoNombre : String(fila.nombre),
      categoria: fila.categoria as CategoriaProducto,
    };
  }

  private async validarDestinos(destinos: readonly CompraDestinoDTO[] | undefined, transactionId: string): Promise<void> {
    if (!destinos || destinos.length === 0) return;

    for (const destino of destinos) {
      const filas = await this.ejecutar(
        'SELECT id FROM tanques WHERE id = CAST(:id AS uuid) AND activo = true',
        [paramText('id', destino.tanqueId)],
        transactionId
      );
      if (filas.length === 0) {
        throw new ParametrosInvalidosError('destinos[].tanqueId no reconocido.', [
          { field: 'tanqueId', issue: `no existe o no está activo: ${destino.tanqueId}` },
        ]);
      }
    }
  }

  private async insertarCompra(
    datos: DatosCompraAInsertar,
    estacionId: string,
    producto: ProductoResuelto,
    transactionId: string
  ): Promise<{ id: string; costoTotal: number; creadoEn: string }> {
    const filas = await this.ejecutar(
      `INSERT INTO compras (estacion_id, producto_id, producto_nombre, categoria, proveedor, fecha, cantidad, costo_unitario, numero_guia)
       VALUES (CAST(:estacionId AS uuid), CAST(:productoId AS uuid), :productoNombre, CAST(:categoria AS categoria_producto), :proveedor,
               CAST(:fecha AS timestamptz), :cantidad, :costoUnitario, :numeroGuia)
       RETURNING id, costo_total, creado_en`,
      [
        paramText('estacionId', estacionId),
        paramText('productoId', producto.productoId),
        paramText('productoNombre', producto.productoNombre),
        paramText('categoria', producto.categoria),
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

    return { id: String(fila.id), costoTotal: Number(fila.costo_total), creadoEn: String(fila.creado_en) };
  }

  private async insertarAbastecimientos(
    compraId: string,
    destinos: readonly CompraDestinoDTO[] | undefined,
    transactionId: string
  ): Promise<void> {
    if (!destinos || destinos.length === 0) return;

    for (const destino of destinos) {
      await this.ejecutar(
        `INSERT INTO compras_abastecimientos (compra_id, tanque_id, cantidad)
         VALUES (CAST(:compraId AS uuid), CAST(:tanqueId AS uuid), :cantidad)`,
        [paramText('compraId', compraId), paramText('tanqueId', destino.tanqueId), paramDecimal('cantidad', destino.cantidad)],
        transactionId
      );
    }
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

function sumaDestinos(destinos: readonly CompraDestinoDTO[]): number {
  return destinos.reduce((acc, d) => acc + d.cantidad, 0);
}

function paramText(name: string, value: string | null | undefined): SqlParameter {
  if (value === null || value === undefined) return { name, value: { isNull: true } };
  return { name, value: { stringValue: value } };
}

function paramDecimal(name: string, value: number | null | undefined): SqlParameter {
  if (value === null || value === undefined) return { name, value: { isNull: true } };
  return { name, value: { stringValue: String(value) }, typeHint: 'DECIMAL' };
}
