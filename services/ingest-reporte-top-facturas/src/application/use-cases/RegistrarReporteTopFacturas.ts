// application/use-cases/RegistrarReporteTopFacturas.ts
//
// Orquesta el registro del reporte top-facturas (v1.89): valida, autoriza
// por estacion, resuelve estacionId, guarda en S3 y publica el evento --
// mismo orden y mismo criterio "best effort" para la publicacion que
// RegistrarCierreDia.ts/RegistrarCierreTurno.ts (el guardado en S3 ya es la
// fuente de verdad; una falla de EventBridge no debe convertirse en un 500
// para fuelhub-local, que sí cumplió su parte).
//
// La idempotencia (`Idempotency-Key`) NO aparece acá, igual que en
// RegistrarCierreDia/Turno -- se resuelve envolviendo el handler completo
// con Lambda Powertools (ver handler.ts). Es necesaria a pesar de que el PUT
// a S3 es naturalmente idempotente (misma key, mismo contenido): sin
// Idempotency-Key, un reintento HTTP volvería a publicar el evento y
// duplicaría la notificación de WhatsApp -- el mismo problema que
// ingest-comprobante-pdf NO tiene (ese Lambda no publica eventos).
//
// v1.89 -- genera el Excel descargable en el mismo request (no hace falta
// un Lambda aparte disparado por evento, como sí necesitan día/turno: el
// payload de fuelhub-local ya trae todo el detalle, no hay que ir a buscar
// nada a Aurora). GET /reportes/top-facturas/documento (consulta-reportes)
// sirve ese Excel vía URL firmada -- mismo patrón que día/turno/
// compras-semanal (ver comentario de Jorge: notificaciones-whatsapp no
// debería tener que armar su propio reporte a partir del resumen del
// evento).

import { AccesoDenegadoEstacionError, RecursoNoEncontradoError, hasAccessToStation, type AuthContext } from '@fuelhub/shared-kernel';
import { validarReporteTopFacturas, type ReporteTopFacturasInput } from '../../domain/ReporteTopFacturasInput';
import type { EstacionLookupRepository } from '../ports/EstacionLookupRepository';
import type { ReporteTopFacturasStorageRepository } from '../ports/ReporteTopFacturasStorageRepository';
import type { ReporteTopFacturasRendererPort } from '../ports/ReporteTopFacturasRendererPort';
import type { ClienteTopFacturasEvento, EventPublisherPort } from '../ports/EventPublisherPort';

const PROYECTO_CODIGO = 'FUELHUBCLOUD'; // mismo valor que RegistrarCierreDia.ts/RegistrarCierreTurno.ts -- confirmado v1.57
const TIPO = 'top facturas';

export interface ReporteTopFacturasRegistradoResultado {
  readonly codigoEstacion: string;
  readonly semanaInicio: string;
  readonly key: string;
}

export class RegistrarReporteTopFacturas {
  constructor(
    private readonly estaciones: EstacionLookupRepository,
    private readonly renderer: ReporteTopFacturasRendererPort,
    private readonly repo: ReporteTopFacturasStorageRepository,
    private readonly eventos: EventPublisherPort
  ) {}

  async ejecutar(auth: AuthContext, input: ReporteTopFacturasInput): Promise<ReporteTopFacturasRegistradoResultado> {
    validarReporteTopFacturas(input);

    // Autorizacion por estacion (5.4), mismo criterio que el resto del
    // repo: nunca se confia en el payload por si solo.
    if (!hasAccessToStation(auth, input.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(input.codigoEstacion);
    }

    const estacionId = await this.estaciones.resolverEstacionId(input.codigoEstacion);
    if (!estacionId) {
      throw new RecursoNoEncontradoError('estación', input.codigoEstacion);
    }

    const excelBuffer = await this.renderer.renderizarExcel({
      codigoEstacion: input.codigoEstacion,
      semanaInicio: input.semanaInicio,
      top: input.top,
    });

    const { key } = await this.repo.guardar({
      codigoEstacion: input.codigoEstacion,
      semanaInicio: input.semanaInicio,
      top: input.top,
      excelBuffer,
    });

    try {
      await this.eventos.publicarReporteTopFacturasRegistrado({
        proyectoCodigo: PROYECTO_CODIGO,
        estacionId,
        estacionCodigo: input.codigoEstacion,
        semanaInicio: input.semanaInicio,
        tipo: TIPO,
        reporteTopFacturasId: `${estacionId}-${input.semanaInicio}`,
        top: input.top.map(resumirCliente),
      });
    } catch (errorDePublicacion) {
      // Best effort a proposito (mismo criterio que RegistrarCierreDia.ts/
      // RegistrarCierreTurno.ts) -- el reporte ya quedo guardado en S3.
      console.error('No se pudo publicar ReporteTopFacturasRegistrado a EventBridge:', errorDePublicacion);
    }

    return { codigoEstacion: input.codigoEstacion, semanaInicio: input.semanaInicio, key };
  }
}

/** Reduce el detalle factura-por-factura de un cliente al resumen que lleva el evento -- ver nota de cabecera de EventPublisherPort.ts. */
function resumirCliente(cliente: ReporteTopFacturasInput['top'][number]): ClienteTopFacturasEvento {
  const despachadores: string[] = [];
  for (const factura of cliente.facturas) {
    if (!despachadores.includes(factura.despachadorNombre)) {
      despachadores.push(factura.despachadorNombre);
    }
  }

  return {
    numeroDocumentoCliente: cliente.numeroDocumentoCliente,
    nombreCliente: cliente.nombreCliente,
    totalSoles: cliente.totalSoles,
    cantidadFacturas: cliente.facturas.length,
    despachadores,
  };
}
