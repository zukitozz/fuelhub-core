// ObtenerReporteDiaDocumento.test.ts (v1.78)
//
// Desde v1.78 este caso de uso ya no toca Postgres/pdfkit -- solo resuelve
// la key de S3 (estación explícita/única del token, o CONSOLIDADO para un
// token wildcard) y le pide a `DocumentoStoragePort` la URL firmada. Se
// prueba con un storage fake en memoria -- mismo criterio que el resto del
// repo (ver GenerarReporteDiaDocumento.test.ts para la lógica de generación
// que este caso de uso ya no tiene).

import { AccesoDenegadoEstacionError, ParametrosInvalidosError, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ObtenerReporteDiaDocumento } from './ObtenerReporteDiaDocumento';
import { DocumentoNoEncontradoError, type DocumentoStoragePort } from '../ports/ReporteDiaDocumentoPorts';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return { clientId: 'test-client', role: 'SISTEMA_GRIFO', stationScope: 'CHANCAYLLO', scopes: [], ...overrides };
}

class StorageFake implements DocumentoStoragePort {
  public llamadas: { key: string; expiraEnSegundos: number }[] = [];
  constructor(private readonly keysExistentes: Set<string> = new Set()) {}

  async subir(): Promise<void> {
    throw new Error('no usado en este caso de uso');
  }

  async obtenerUrlFirmada(params: { key: string; expiraEnSegundos: number }) {
    this.llamadas.push(params);
    if (!this.keysExistentes.has(params.key)) {
      throw new DocumentoNoEncontradoError(params.key);
    }
    return { url: `https://s3.fake/${params.key}`, expiraEn: params.expiraEnSegundos };
  }
}

describe('ObtenerReporteDiaDocumento', () => {
  it('individual: usa estacionCodigo explícito y resuelve la key estable {ESTACION}-{fecha}.pdf', async () => {
    const storage = new StorageFake(new Set(['reportes-dia/CHANCAYLLO-20260916.pdf']));
    const caso = new ObtenerReporteDiaDocumento(storage);

    const resultado = await caso.ejecutar(auth({ stationScope: '*' }), {
      estacionCodigo: 'CHANCAYLLO',
      fechaNegocio: '2026-09-16',
    });

    expect(resultado).toEqual({ url: expect.stringContaining('CHANCAYLLO-20260916'), tipo: 'application/pdf', expiraEn: 600 });
  });

  it('individual: usa la estación única del token cuando no se manda estacionCodigo', async () => {
    const storage = new StorageFake(new Set(['reportes-dia/CHANCAYLLO-20260916.pdf']));
    const caso = new ObtenerReporteDiaDocumento(storage);

    const resultado = await caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { fechaNegocio: '2026-09-16' });

    expect(resultado.tipo).toBe('application/pdf');
    expect(storage.llamadas).toEqual([{ key: 'reportes-dia/CHANCAYLLO-20260916.pdf', expiraEnSegundos: 600 }]);
  });

  it('individual: 403 si el token no tiene acceso a la estación pedida', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteDiaDocumento(storage);

    await expect(
      caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { estacionCodigo: 'MALA', fechaNegocio: '2026-09-16' })
    ).rejects.toThrow(AccesoDenegadoEstacionError);
    expect(storage.llamadas).toEqual([]);
  });

  it('individual: 404 si la key todavía no existe en S3 (sin fallback a generar al vuelo)', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteDiaDocumento(storage);

    await expect(
      caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { estacionCodigo: 'CHANCAYLLO', fechaNegocio: '2026-09-16' })
    ).rejects.toThrow(RecursoNoEncontradoError);
  });

  it('consolidado: token wildcard sin estacionCodigo resuelve la key CONSOLIDADO-{fecha}.pdf', async () => {
    const storage = new StorageFake(new Set(['reportes-dia/CONSOLIDADO-20260916.pdf']));
    const caso = new ObtenerReporteDiaDocumento(storage);

    const resultado = await caso.ejecutar(auth({ stationScope: '*' }), { fechaNegocio: '2026-09-16' });

    expect(resultado.tipo).toBe('application/pdf');
    expect(storage.llamadas).toEqual([{ key: 'reportes-dia/CONSOLIDADO-20260916.pdf', expiraEnSegundos: 600 }]);
  });

  it('consolidado: 404 si el CONSOLIDADO de esa fecha todavía no existe en S3', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteDiaDocumento(storage);

    await expect(caso.ejecutar(auth({ stationScope: '*' }), { fechaNegocio: '2026-09-16' })).rejects.toThrow(RecursoNoEncontradoError);
  });

  it('consolidado: 403 para un token multi-estación explícito (no wildcard) -- v1.78, ya no se sirve un recorte por token', async () => {
    const storage = new StorageFake(new Set(['reportes-dia/CONSOLIDADO-20260916.pdf']));
    const caso = new ObtenerReporteDiaDocumento(storage);

    await expect(
      caso.ejecutar(auth({ stationScope: 'CHANCAYLLO,MALA' }), { fechaNegocio: '2026-09-16' })
    ).rejects.toThrow(AccesoDenegadoEstacionError);
    expect(storage.llamadas).toEqual([]);
  });

  it('rechaza fechaNegocio ausente o inválida antes de tocar el storage', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteDiaDocumento(storage);

    await expect(caso.ejecutar(auth(), { estacionCodigo: 'CHANCAYLLO' })).rejects.toThrow(ParametrosInvalidosError);
    expect(storage.llamadas).toEqual([]);
  });
});
