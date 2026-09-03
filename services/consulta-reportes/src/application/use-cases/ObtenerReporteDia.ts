// application/use-cases/ObtenerReporteDia.ts
//
// Orquesta `GET /v1/reportes/dia` (v1.58). A diferencia de
// `ObtenerReporteMargen`/`ObtenerReporteAbastecimiento`, acá `estacionCodigo`
// NO es opcional de verdad: el reporte devuelve un único objeto (un día de
// una estación), no una lista, así que si el token no resuelve a una sola
// estación (multi-estación explícito, o wildcard '*') y no se manda
// `estacionCodigo`, es un 400 — no hay "agregado cross-estación" que
// devolver aquí como sí pasa en los otros dos reportes.

import {
  AccesoDenegadoEstacionError,
  estacionUnicaDelToken,
  hasAccessToStation,
  ParametrosInvalidosError,
  RecursoNoEncontradoError,
  type AuthContext,
} from '@fuelhub/shared-kernel';
import { normalizarFechaNegocio } from '../../domain/value-objects/RangoFechas';
import type { ReporteDiaDTO, ReporteDiaQueryRepository } from '../ports/ReporteDiaQueryRepository';

export interface ObtenerReporteDiaQuery {
  readonly estacionCodigo?: string;
  readonly fechaNegocio?: string;
}

export class ObtenerReporteDia {
  constructor(private readonly repo: ReporteDiaQueryRepository) {}

  async ejecutar(auth: AuthContext, query: ObtenerReporteDiaQuery): Promise<ReporteDiaDTO> {
    const fechaNegocio = normalizarFechaNegocio(query.fechaNegocio);
    const estacionCodigo = query.estacionCodigo ?? estacionUnicaDelToken(auth);

    if (estacionCodigo === undefined) {
      throw new ParametrosInvalidosError('Falta el parámetro "estacionCodigo".', [
        {
          field: 'estacionCodigo',
          issue:
            'requerido cuando el token tiene acceso a más de una estación (o a todas, "*") — este reporte es de una sola estación a la vez, no hay vista agregada',
        },
      ]);
    }

    if (!hasAccessToStation(auth, estacionCodigo)) {
      throw new AccesoDenegadoEstacionError(estacionCodigo);
    }

    const resultado = await this.repo.obtener({ estacionCodigo, fechaNegocio });
    if (resultado === null) {
      throw new RecursoNoEncontradoError('Cierre de día', `${estacionCodigo} / ${fechaNegocio}`);
    }
    return resultado;
  }
}
