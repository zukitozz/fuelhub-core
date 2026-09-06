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
//     que mande el cliente si lo manda, y solo si no lo manda se cae al
//     nombre del catálogo -- a diferencia de `cierres_turno_detalle`, acá el
//     cliente puede omitir `productoNombre` cuando hay `productoId`.
//
//   - `validarDestinos` REEMPLAZA a la vieja `validarTanque`: HASTA v1.64 se
//     exigía que el tanque de una compra perteneciera a la MISMA estación
//     que la compra. Eso ya no aplica -- Jorge describió un caso real de
//     contingencia donde una compra facturada a una estación reparte parte
//     del combustible a un tanque de OTRA estación. `validarDestinos` ahora
//     solo confirma que cada `tanqueId` exista y esté activo, sin importar
//     de qué estación sea.
//
// v1.66 (migración 1788300000000_agrega-estado-a-compras.sql), a pedido de
// Jorge -- "¿tengo un endpoint para agregar, eliminar o editar el detalle
// de la compra?": no había ninguno, se agrega `obtenerPorId`/`actualizar`
// (PUT parcial, mismo patrón que `PostgresTanqueRepository`):
//
//   - `resolverProductoParaActualizar` decide, entre `cambios` y la fila
//     actual, cuál es el producto final de la compra tras el PUT:
//       * `cambios.productoId` presente (string o `null`) -- se re-resuelve
//         desde cero con `resolverProducto`, exactamente igual que al crear.
//       * `cambios.productoId` ausente y la compra YA tenía un `productoId`
//         de catálogo -- `producto_nombre` se puede editar suelto, pero
//         `categoria` NO: el catálogo sigue mandando (mismo criterio que al
//         crear), cualquier `categoria` que llegue en `cambios` sin tocar
//         `productoId` se ignora en silencio -- no es un caso nuevo, es el
//         mismo comportamiento de `registrar` aplicado a una edición.
//       * `cambios.productoId` ausente y la compra YA era mercadería
//         (`productoId` null) -- `producto_nombre`/`categoria` se pueden
//         editar sueltos, cada uno independiente del otro.
//   - `destinos`, cuando viene en `cambios`, REEMPLAZA por completo las
//     filas de `compras_abastecimientos` de esa compra (DELETE + INSERT
//     dentro de la misma transacción) -- no hay upsert fila por fila.
//   - La suma de `destinos[].cantidad` se valida contra la cantidad VIGENTE
//     de la compra (la nueva, si `cambios.cantidad` también viene en este
//     mismo PUT; si no, la que ya estaba guardada) -- por eso esta
//     validación vive acá y no en el dominio (`CompraUpdateInput.ts`), que
//     no tiene acceso a la base.
//   - `estado` (anular/reactivar) es un campo más del mismo PUT parcial --
//     mismo criterio que `PUT /tanques/{id}` ya usa para `activo`. No se
//     construyó un endpoint de acción dedicado (`POST /compras/{id}/anular`)
//     porque hubiera sido la única ruta de ese estilo en todo el contrato.
//   - `calcularMerma` unifica el criterio de `merma` entre `registrar` y
//     los métodos nuevos: `null` cuando no hay ninguna fila de
//     `compras_abastecimientos`, calculada cuando sí hay -- reemplaza la
//     regla de v1.65 (`datos.destinos === undefined`), que dependía de una
//     distinción ("destinos ausente" vs. "destinos vacío") que
//     `obtenerPorId`/`actualizar` no pueden replicar al leer filas ya
//     guardadas.
//
// v1.67 (GET /compras) -- se agrega `listar`, mismo patrón de paginación
// (COUNT + LIMIT/OFFSET) que `PostgresCierreTurnoQueryRepository`
// (consulta-cierres): dos queries en paralelo contra la misma condición
// `WHERE`, una trae la página de filas y la otra el total. La merma por fila
// se calcula con un LEFT JOIN a un agregado de `compras_abastecimientos`
// (suma + conteo de filas por `compra_id`) en vez de traer cada destino
// individual -- el listado no expone `destinos[]` (ver `CompraResumenDTO`),
// así que no hace falta la fila a fila, solo el total repartido y si hubo
// alguna fila (para distinguir "sin destinos" de "repartido completo", igual
// que `calcularMerma`).

import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';
import { ParametrosInvalidosError, RecursoNoEncontradoError, conReintentoSiDbEstaResumiendo, type CategoriaProducto, type EstadoCierre } from '@fuelhub/shared-kernel';
import type {
  CambiosCompra,
  CompraDestinoDTO,
  CompraIngestaRepository,
  CompraOutputDTO,
  CompraResumenDTO,
  DatosCompraAInsertar,
  FiltrosCompra,
} from '../../application/ports/CompraIngestaRepository';
import type { ParametrosPaginacion, ResultadoPaginado } from '../../domain/value-objects/Paginacion';

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

interface FilaCompra {
  readonly id: string;
  readonly codigoEstacion: string;
  readonly productoId: string | null;
  readonly productoNombre: string;
  readonly categoria: CategoriaProducto | null;
  readonly proveedor: string | null;
  readonly fecha: string;
  readonly cantidad: number;
  readonly costoUnitario: number;
  readonly costoTotal: number;
  readonly numeroGuia: string | null;
  readonly estado: EstadoCierre;
  readonly creadoEn: string;
}

const SELECT_COMPRA = `
  SELECT c.id, e.codigo AS codigo_estacion, c.producto_id, c.producto_nombre, c.categoria,
         c.proveedor, c.fecha, c.cantidad, c.costo_unitario, c.costo_total, c.numero_guia,
         c.estado, c.creado_en
  FROM compras c
  JOIN estaciones e ON e.id = c.estacion_id
`;

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

      const producto = await this.resolverProducto(datos.productoId ?? null, datos.productoNombre, datos.categoria, transactionId);
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
        merma: calcularMerma(datos.cantidad, destinos),
        estado: 'ACTIVO',
        creadoEn: cabecera.creadoEn,
      };
    } catch (err) {
      await this.rollback(transactionId);
      throw err;
    }
  }

  async obtenerPorId(id: string): Promise<CompraOutputDTO | undefined> {
    const fila = (await this.ejecutarSinTransaccion(`${SELECT_COMPRA} WHERE c.id = CAST(:id AS uuid)`, [paramText('id', id)]))[0];
    if (!fila) return undefined;

    const destinos = await this.ejecutarSinTransaccion(
      'SELECT tanque_id, cantidad FROM compras_abastecimientos WHERE compra_id = CAST(:id AS uuid) ORDER BY creado_en',
      [paramText('id', id)]
    ).then((filas) => filas.map(mapearFilaDestino));

    return mapearCompraCompleta(mapearFilaCompra(fila), destinos);
  }

  async listar(filtros: FiltrosCompra, paginacion: ParametrosPaginacion): Promise<ResultadoPaginado<CompraResumenDTO>> {
    const { whereSql, parameters } = construirWhereCompras(filtros);
    const offset = (paginacion.page - 1) * paginacion.pageSize;

    // LEFT JOIN a un agregado de compras_abastecimientos por compra_id --
    // NULL (sin filas) cuando la compra no tiene ningún destino registrado,
    // igual criterio de "null vs. calculada" que `calcularMerma` usa para
    // `registrar`/`obtenerPorId`/`actualizar` (ver nota de cabecera del archivo).
    const sqlDatos = `
      SELECT c.id, e.codigo AS codigo_estacion, c.producto_id, c.producto_nombre, c.categoria,
             c.proveedor, c.fecha, c.cantidad, c.costo_unitario, c.costo_total, c.numero_guia,
             c.estado, c.creado_en, ca.cantidad_repartida, ca.filas_destino
      FROM compras c
      JOIN estaciones e ON e.id = c.estacion_id
      LEFT JOIN (
        SELECT compra_id, SUM(cantidad) AS cantidad_repartida, COUNT(*) AS filas_destino
        FROM compras_abastecimientos
        GROUP BY compra_id
      ) ca ON ca.compra_id = c.id
      ${whereSql}
      ORDER BY c.fecha DESC
      LIMIT :limit OFFSET :offset
    `;

    const sqlConteo = `
      SELECT COUNT(*) AS total
      FROM compras c
      JOIN estaciones e ON e.id = c.estacion_id
      ${whereSql}
    `;

    const [filas, conteo] = await Promise.all([
      this.ejecutarSinTransaccion(sqlDatos, [...parameters, paramLong('limit', paginacion.pageSize), paramLong('offset', offset)]),
      this.ejecutarSinTransaccion(sqlConteo, parameters),
    ]);

    return {
      data: filas.map(mapearFilaResumen),
      pagination: { page: paginacion.page, pageSize: paginacion.pageSize, totalItems: leerConteo(conteo), totalPages: 1 },
      // totalPages real lo termina de calcular el caso de uso (construirPaginacion) con este totalItems.
    };
  }

  async actualizar(id: string, cambios: CambiosCompra): Promise<CompraOutputDTO> {
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
      const filaActual = (await this.ejecutar(`${SELECT_COMPRA} WHERE c.id = CAST(:id AS uuid)`, [paramText('id', id)], transactionId))[0];
      if (!filaActual) {
        // Defensivo: `ActualizarCompra` (application) ya valida esto antes de
        // llegar acá -- se re-chequea igual, mismo criterio que
        // `PostgresTanqueRepository.actualizar`.
        throw new RecursoNoEncontradoError('Compra', id);
      }
      const actual = mapearFilaCompra(filaActual);

      const productoCambio = cambios.productoId !== undefined || cambios.productoNombre !== undefined || cambios.categoria !== undefined;
      const producto = productoCambio ? await this.resolverProductoParaActualizar(cambios, actual, transactionId) : null;

      const cantidadFinal = cambios.cantidad ?? actual.cantidad;

      if (cambios.destinos !== undefined) {
        const sumaDestinos = sumaCantidades(cambios.destinos);
        if (sumaDestinos > cantidadFinal) {
          throw new ParametrosInvalidosError('destinos no pasó la validación.', [
            {
              field: 'destinos',
              issue: `la suma de las cantidades repartidas a tanques (${sumaDestinos}) no puede superar la cantidad de la compra (${cantidadFinal})`,
            },
          ]);
        }
        await this.validarDestinos(cambios.destinos, transactionId);
      }

      const sets: string[] = [];
      const parametros: SqlParameter[] = [paramText('id', id)];

      if (producto) {
        sets.push('producto_id = CAST(:productoId AS uuid)', 'producto_nombre = :productoNombre', 'categoria = CAST(:categoria AS categoria_producto)');
        parametros.push(paramText('productoId', producto.productoId), paramText('productoNombre', producto.productoNombre), paramText('categoria', producto.categoria));
      }
      if (cambios.proveedor !== undefined) {
        sets.push('proveedor = :proveedor');
        parametros.push(paramText('proveedor', cambios.proveedor));
      }
      if (cambios.fecha !== undefined) {
        sets.push('fecha = CAST(:fecha AS timestamptz)');
        parametros.push(paramText('fecha', cambios.fecha));
      }
      if (cambios.cantidad !== undefined) {
        sets.push('cantidad = :cantidad');
        parametros.push(paramDecimal('cantidad', cambios.cantidad));
      }
      if (cambios.costoUnitario !== undefined) {
        sets.push('costo_unitario = :costoUnitario');
        parametros.push(paramDecimal('costoUnitario', cambios.costoUnitario));
      }
      if (cambios.numeroGuia !== undefined) {
        sets.push('numero_guia = :numeroGuia');
        parametros.push(paramText('numeroGuia', cambios.numeroGuia));
      }
      if (cambios.estado !== undefined) {
        sets.push('estado = CAST(:estado AS estado_cierre)');
        parametros.push(paramText('estado', cambios.estado));
      }

      const filaTrasUpdate =
        sets.length > 0
          ? (
              await this.ejecutar(
                `UPDATE compras c SET ${sets.join(', ')}
                 FROM estaciones e
                 WHERE c.estacion_id = e.id AND c.id = CAST(:id AS uuid)
                 RETURNING c.id, e.codigo AS codigo_estacion, c.producto_id, c.producto_nombre, c.categoria,
                           c.proveedor, c.fecha, c.cantidad, c.costo_unitario, c.costo_total, c.numero_guia,
                           c.estado, c.creado_en`,
                parametros,
                transactionId
              )
            )[0]
          : filaActual;
      if (!filaTrasUpdate) {
        throw new RecursoNoEncontradoError('Compra', id);
      }
      const compraFinal = mapearFilaCompra(filaTrasUpdate);

      if (cambios.destinos !== undefined) {
        await this.ejecutar('DELETE FROM compras_abastecimientos WHERE compra_id = CAST(:id AS uuid)', [paramText('id', id)], transactionId);
        await this.insertarAbastecimientos(id, cambios.destinos, transactionId);
      }

      const destinos = (
        await this.ejecutar(
          'SELECT tanque_id, cantidad FROM compras_abastecimientos WHERE compra_id = CAST(:id AS uuid) ORDER BY creado_en',
          [paramText('id', id)],
          transactionId
        )
      ).map(mapearFilaDestino);

      await conReintentoSiDbEstaResumiendo(() => this.client.send(
        new CommitTransactionCommand({
          resourceArn: this.config.resourceArn,
          secretArn: this.config.secretArn,
          transactionId,
        })
      ));

      return mapearCompraCompleta(compraFinal, destinos);
    } catch (err) {
      await this.rollback(transactionId);
      throw err;
    }
  }

  private async rollback(transactionId: string): Promise<void> {
    await this.client
      .send(
        new RollbackTransactionCommand({
          resourceArn: this.config.resourceArn,
          secretArn: this.config.secretArn,
          transactionId,
        })
      )
      .catch((errorDeRollback) => console.error('Falló el ROLLBACK de la transacción:', errorDeRollback));
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
   * Resuelve producto_id/producto_nombre/categoria DESDE CERO -- usado por
   * `registrar` y por `actualizar` cuando `cambios.productoId` viene
   * presente (string o `null`). `productoId === null` => mercadería sin
   * catálogo (ya validado aguas arriba: `productoNombre` viene presente).
   * `productoId` string => revalida contra el catálogo activo; `categoria`
   * SIEMPRE sale del catálogo ahí (se ignora cualquier `categoria` del
   * cliente), `producto_nombre` usa lo que mande el cliente o, si no manda
   * nada, el nombre del catálogo.
   */
  private async resolverProducto(productoId: string | null, productoNombreCliente: string | null | undefined, categoriaCliente: CategoriaProducto | null | undefined, transactionId: string): Promise<ProductoResuelto> {
    if (productoId === null) {
      // v1.68 fix: `categoria` se estaba perdiendo aquí (regresión de v1.66 al refactorizar
      // esta función para aceptar parámetros sueltos en vez de `datos` completo) -- para
      // mercadería, `categoria` SIEMPRE viene del cliente (nunca de un catálogo), a
      // diferencia de la rama de abajo (productoId de catálogo), donde sí se ignora.
      return { productoId: null, productoNombre: (productoNombreCliente ?? '') as string, categoria: categoriaCliente ?? null };
    }

    const filas = await this.ejecutar(
      'SELECT nombre, categoria FROM productos_maestro WHERE id = CAST(:id AS uuid) AND activo = true',
      [paramText('id', productoId)],
      transactionId
    );
    const fila = filas[0];
    if (!fila) {
      throw new ParametrosInvalidosError('productoId no reconocido.', [
        { field: 'productoId', issue: 'no existe en productos_maestro o no está activo' },
      ]);
    }
    return {
      productoId,
      productoNombre: productoNombreCliente?.trim() ? productoNombreCliente : String(fila.nombre),
      categoria: fila.categoria as CategoriaProducto,
    };
  }

  /**
   * Variante de `resolverProducto` para `actualizar`, solo invocada cuando
   * `cambios` toca al menos uno de productoId/productoNombre/categoria --
   * ver el comentario de cabecera del archivo para las 3 ramas.
   */
  private async resolverProductoParaActualizar(cambios: CambiosCompra, actual: FilaCompra, transactionId: string): Promise<ProductoResuelto> {
    if (cambios.productoId !== undefined) {
      return this.resolverProducto(cambios.productoId, cambios.productoNombre, cambios.categoria, transactionId);
    }

    if (actual.productoId !== null) {
      // Sigue siendo un producto de catálogo: solo producto_nombre es editable acá -- categoria la sigue mandando el catálogo (se ignora en silencio cualquier `cambios.categoria`, mismo criterio que al crear).
      return {
        productoId: actual.productoId,
        productoNombre: cambios.productoNombre?.trim() ? cambios.productoNombre : actual.productoNombre,
        categoria: actual.categoria,
      };
    }

    // Sigue siendo mercadería (ya era productoId null): producto_nombre/categoria se editan sueltos.
    return {
      productoId: null,
      productoNombre: cambios.productoNombre?.trim() ? cambios.productoNombre : actual.productoNombre,
      categoria: cambios.categoria !== undefined ? cambios.categoria : actual.categoria,
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

function calcularMerma(cantidad: number, destinos: readonly CompraDestinoDTO[]): number | null {
  return destinos.length === 0 ? null : cantidad - sumaCantidades(destinos);
}

function sumaCantidades(destinos: readonly CompraDestinoDTO[]): number {
  return destinos.reduce((acc, d) => acc + d.cantidad, 0);
}

function mapearFilaCompra(fila: Record<string, unknown>): FilaCompra {
  return {
    id: String(fila.id),
    codigoEstacion: String(fila.codigo_estacion),
    productoId: fila.producto_id === null || fila.producto_id === undefined ? null : String(fila.producto_id),
    productoNombre: String(fila.producto_nombre),
    categoria: (fila.categoria as CategoriaProducto | null | undefined) ?? null,
    proveedor: fila.proveedor === null || fila.proveedor === undefined ? null : String(fila.proveedor),
    fecha: String(fila.fecha),
    cantidad: Number(fila.cantidad),
    costoUnitario: Number(fila.costo_unitario),
    costoTotal: Number(fila.costo_total),
    numeroGuia: fila.numero_guia === null || fila.numero_guia === undefined ? null : String(fila.numero_guia),
    estado: fila.estado as EstadoCierre,
    creadoEn: String(fila.creado_en),
  };
}

function mapearFilaDestino(fila: Record<string, unknown>): CompraDestinoDTO {
  return { tanqueId: String(fila.tanque_id), cantidad: Number(fila.cantidad) };
}

function mapearCompraCompleta(compra: FilaCompra, destinos: readonly CompraDestinoDTO[]): CompraOutputDTO {
  return {
    id: compra.id,
    codigoEstacion: compra.codigoEstacion,
    productoId: compra.productoId,
    productoNombre: compra.productoNombre,
    categoria: compra.categoria,
    proveedor: compra.proveedor,
    fecha: compra.fecha,
    cantidad: compra.cantidad,
    costoUnitario: compra.costoUnitario,
    costoTotal: compra.costoTotal,
    numeroGuia: compra.numeroGuia,
    destinos,
    merma: calcularMerma(compra.cantidad, destinos),
    estado: compra.estado,
    creadoEn: compra.creadoEn,
  };
}

function paramText(name: string, value: string | null | undefined): SqlParameter {
  if (value === null || value === undefined) return { name, value: { isNull: true } };
  return { name, value: { stringValue: value } };
}

function paramDecimal(name: string, value: number | null | undefined): SqlParameter {
  if (value === null || value === undefined) return { name, value: { isNull: true } };
  return { name, value: { stringValue: String(value) }, typeHint: 'DECIMAL' };
}

function paramLong(name: string, value: number): SqlParameter {
  return { name, value: { longValue: value } };
}

/**
 * `WHERE` de `listar` (v1.67) -- mismo patrón que
 * `PostgresCierreTurnoQueryRepository.construirWhere` (consulta-cierres):
 * arma condiciones + parámetros juntos para no desalinearlos.
 *
 * `productoId` NO se valida como UUID acá (ni en `ListarCompras`, capa de
 * aplicación) antes del `CAST` -- mismo comportamiento que el resto del
 * repo para un `id` de path/filtro mal formado (cae al 500 genérico de
 * `mapErrorToResponse`, gap preexistente y aceptado en todo el repo, no
 * introducido por este cambio).
 */
function construirWhereCompras(filtros: FiltrosCompra): { whereSql: string; parameters: SqlParameter[] } {
  const condiciones: string[] = ['c.estado = CAST(:estado AS estado_cierre)'];
  const parameters: SqlParameter[] = [paramText('estado', filtros.estado)];

  if (filtros.estacionCodigo) {
    condiciones.push('e.codigo = :estacionCodigo');
    parameters.push(paramText('estacionCodigo', filtros.estacionCodigo));
  }
  // c.fecha es TIMESTAMPTZ (hora exacta de la compra), no DATE -- mismo
  // criterio que PostgresReporteMargenQueryRepository: "< día siguiente" en
  // vez de "<= fechaHasta" para incluir el día completo de fechaHasta.
  if (filtros.fechaDesde) {
    condiciones.push('c.fecha >= CAST(:fechaDesde AS date)');
    parameters.push(paramText('fechaDesde', filtros.fechaDesde));
  }
  if (filtros.fechaHasta) {
    condiciones.push("c.fecha < CAST(:fechaHasta AS date) + INTERVAL '1 day'");
    parameters.push(paramText('fechaHasta', filtros.fechaHasta));
  }
  if (filtros.productoId) {
    condiciones.push('c.producto_id = CAST(:productoId AS uuid)');
    parameters.push(paramText('productoId', filtros.productoId));
  }
  if (filtros.categoria) {
    condiciones.push('c.categoria = CAST(:categoria AS categoria_producto)');
    parameters.push(paramText('categoria', filtros.categoria));
  }

  return { whereSql: `WHERE ${condiciones.join(' AND ')}`, parameters };
}

function leerConteo(filas: Record<string, unknown>[]): number {
  const total = filas[0]?.total;
  return typeof total === 'number' ? total : Number(total ?? 0);
}

function mapearFilaResumen(fila: Record<string, unknown>): CompraResumenDTO {
  const filasDestino = Number(fila.filas_destino ?? 0);
  const cantidad = Number(fila.cantidad);
  const cantidadRepartida = Number(fila.cantidad_repartida ?? 0);

  return {
    id: String(fila.id),
    codigoEstacion: String(fila.codigo_estacion),
    productoId: fila.producto_id === null || fila.producto_id === undefined ? null : String(fila.producto_id),
    productoNombre: String(fila.producto_nombre),
    categoria: (fila.categoria as CategoriaProducto | null | undefined) ?? null,
    proveedor: fila.proveedor === null || fila.proveedor === undefined ? null : String(fila.proveedor),
    fecha: String(fila.fecha),
    cantidad,
    costoUnitario: Number(fila.costo_unitario),
    costoTotal: Number(fila.costo_total),
    numeroGuia: fila.numero_guia === null || fila.numero_guia === undefined ? null : String(fila.numero_guia),
    merma: filasDestino === 0 ? null : cantidad - cantidadRepartida,
    estado: fila.estado as EstadoCierre,
    creadoEn: String(fila.creado_en),
  };
}
