// application/use-cases/GuardarComprobantePdf.ts
//
// Espejo de RegistrarCierreTurno.ts: valida, autoriza por estación, delega.
// El orden importa (sección 5.4): primero la validación estructural pura
// (dominio), después la autorización por estación -- la única decisión de
// negocio que este caso de uso no delega al repositorio -- y recién al
// final se llama al puerto.

import { AccesoDenegadoEstacionError, hasAccessToStation, type AuthContext } from '@fuelhub/shared-kernel';
import { validarYDecodificarComprobantePdf, type ComprobantePdfInput } from '../../domain/ComprobantePdfInput';
import type { ComprobantePdfStorageRepository } from '../ports/ComprobantePdfStorageRepository';

export interface ComprobantePdfGuardadoResultado {
  readonly codigoEstacion: string;
  readonly numeracion: string;
  readonly key: string;
}

export class GuardarComprobantePdf {
  constructor(private readonly repo: ComprobantePdfStorageRepository) {}

  async ejecutar(
    auth: AuthContext,
    numeracion: string | undefined,
    input: ComprobantePdfInput
  ): Promise<ComprobantePdfGuardadoResultado> {
    const buffer = validarYDecodificarComprobantePdf(input, numeracion);

    // Autorización por estación (5.4): nunca se confía en que el payload
    // diga la verdad por sí solo -- se compara contra custom:station_scope
    // del token ya verificado, ANTES de tocar S3. El RUC no participa de
    // esta autorización (el token de Cognito está scoped por estación, no
    // por RUC, sección 9.2.1) -- solo se usa como parte de la key de storage.
    if (!hasAccessToStation(auth, input.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(input.codigoEstacion);
    }

    const { key } = await this.repo.guardar({
      ruc: input.ruc,
      numeracion: numeracion!,
      buffer,
    });

    return { codigoEstacion: input.codigoEstacion, numeracion: numeracion!, key };
  }
}
