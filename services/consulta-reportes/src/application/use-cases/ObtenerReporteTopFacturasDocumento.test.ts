// ObtenerReporteTopFacturasDocumento.test.ts (v1.89)
//
// Mismo criterio de StorageFake en memoria que ObtenerReporteComprasSemanalDocumento.test.ts.

import { AccesoDenegadoEstacionError, ParametrosInvalidosError, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ObtenerReporteTopFacturasDocumento } from './ObtenerReporteTopFacturasDocumento';
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

const KEY_EXISTENTE = 'top-facturas/reporte_top_facturas_CHANCAYLLO_2026-10-06.xlsx';

describe('ObtenerReporteTopFacturasDocumento', () => {
  it('arma la key estable y devuelve la URL firmada', async () => {
    const storage = new StorageFake(new Set([KEY_EXISTENTE]));
    const caso = new ObtenerReporteTopFacturasDocumento(storage);

    const resultado = await caso.ejecutar(auth(), { estacionCodigo: 'CHANCAYLLO', semanaInicio: '2026-10-06' });

    expect(resultado).toEqual({
      url: expect.stringContaining('reporte_top_facturas_CHANCAYLLO_2026-10-06'),
      tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      expiraEn: 600,
    });
    expect(storage.llamadas).toEqual([{ key: KEY_EXISTENTE, expiraEnSegundos: 600 }]);
  });

  it('rechaza sin estacionCodigo', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteTopFacturasDocumento(storage);

    await expect(caso.ejecutar(auth(), { semanaInicio: '2026-10-06' })).rejects.toThrow(ParametrosInvalidosError);
  });

  it('rechaza sin semanaInicio o con formato inválido', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteTopFacturasDocumento(storage);

    await expect(caso.ejecutar(auth(), { estacionCodigo: 'CHANCAYLLO' })).rejects.toThrow(ParametrosInvalidosError);
    await expect(caso.ejecutar(auth(), { estacionCodigo: 'CHANCAYLLO', semanaInicio: '06/10/2026' })).rejects.toThrow(ParametrosInvalidosError);
  });

  it('403 si el token no tiene acceso a la estación pedida', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteTopFacturasDocumento(storage);

    await expect(
      caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { estacionCodigo: 'MALA', semanaInicio: '2026-10-06' })
    ).rejects.toThrow(AccesoDenegadoEstacionError);
    expect(storage.llamadas).toEqual([]);
  });

  it('404 si el Excel todavía no existe en S3', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteTopFacturasDocumento(storage);

    await expect(caso.ejecutar(auth(), { estacionCodigo: 'CHANCAYLLO', semanaInicio: '2026-10-06' })).rejects.toThrow(
      RecursoNoEncontradoError
    );
  });
});
