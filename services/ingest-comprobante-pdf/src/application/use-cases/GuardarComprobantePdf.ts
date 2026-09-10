// application/use-cases/GuardarComprobantePdf.ts
//
// Espejo de RegistrarCierreTurno.ts: valida, autoriza por estacion, delega.
// El orden importa (seccion 5.4): primero la validacion estructural pura
// (dominio), despues la autorizacion por estacion -- la unica decision de
// negocio que este caso de uso no delega al repositorio -- y recien al
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
    const { buffer, metadata } = validarYDecodificarComprobantePdf(input, numeracion);

    // Autorizacion por estacion (5.4): nunca se confia en que el payload
    // diga la verdad por si solo -- se compara contra custom:station_scope
    // del token ya verificado, ANTES de tocar S3. El RUC no participa de
    // esta autorizacion (el token de Cognito esta scoped por estacion, no
    // por RUC, seccion 9.2.1) -- solo se usa como parte de la key de storage.
    if (!hasAccessToStation(auth, input.codigoEstacion)) {
      throw new AccesoDenegadoEstacionError(input.codigoEstacion);
    }

    const { key } = await this.repo.guardar({
      ruc: input.ruc,
      numeracion: numeracion!,
      buffer,
      metadata,
    });

    return { codigoEstacion: input.codigoEstacion, numeracion: numeracion!, key };
  }
}
