// ObtenerReporteTurnoDocumento.test.ts (v1.85)
//
// Mismo criterio que ObtenerReporteDiaDocumento.test.ts -- solo S3, storage fake en memoria.

import { AccesoDenegadoEstacionError, ParametrosInvalidosError, RecursoNoEncontradoError, type AuthContext } from '@fuelhub/shared-kernel';
import { ObtenerReporteTurnoDocumento } from './ObtenerReporteTurnoDocumento';
import { DocumentoNoEncontradoError, type DocumentoStoragePort } from '../ports/ReporteDiaDocumentoPorts';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return { clientId: 'test-client', role: 'SISTEMA_GRIFO', stationScope: 'PACHACUTEC', scopes: [], ...overrides };
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

describe('ObtenerReporteTurnoDocumento', () => {
  it('resuelve la key estable cierre_turno_{ESTACION}_{fecha}_T{N}.pdf', async () => {
    const storage = new StorageFake(new Set(['reportes-dia/cierre_turno_PACHACUTEC_2026-09-15_T1.pdf']));
    const caso = new ObtenerReporteTurnoDocumento(storage);

    const resultado = await caso.ejecutar(auth(), { estacionCodigo: 'PACHACUTEC', fechaNegocio: '2026-09-15', turno: 'TURNO1' });

    expect(resultado).toEqual({
      url: 'https://s3.fake/reportes-dia/cierre_turno_PACHACUTEC_2026-09-15_T1.pdf',
      tipo: 'application/pdf',
      expiraEn: 600,
    });
  });

  it('rechaza si falta estacionCodigo -- siempre obligatorio para turno, a diferencia de día', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteTurnoDocumento(storage);

    await expect(caso.ejecutar(auth(), { fechaNegocio: '2026-09-15', turno: 'TURNO1' })).rejects.toThrow(ParametrosInvalidosError);
    expect(storage.llamadas).toEqual([]);
  });

  it('rechaza un turno inválido', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteTurnoDocumento(storage);

    await expect(
      caso.ejecutar(auth(), { estacionCodigo: 'PACHACUTEC', fechaNegocio: '2026-09-15', turno: 'TURNO9' })
    ).rejects.toThrow(ParametrosInvalidosError);
  });

  it('403 si el token no tiene acceso a la estación pedida', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteTurnoDocumento(storage);

    await expect(
      caso.ejecutar(auth({ stationScope: 'CHANCAYLLO' }), { estacionCodigo: 'PACHACUTEC', fechaNegocio: '2026-09-15', turno: 'TURNO1' })
    ).rejects.toThrow(AccesoDenegadoEstacionError);
  });

  it('404 si la key todavía no existe en S3', async () => {
    const storage = new StorageFake();
    const caso = new ObtenerReporteTurnoDocumento(storage);

    await expect(
      caso.ejecutar(auth(), { estacionCodigo: 'PACHACUTEC', fechaNegocio: '2026-09-15', turno: 'TURNO1' })
    ).rejects.toThrow(RecursoNoEncontradoError);
  });

  it('token wildcard también puede pedir el reporte de una estación puntual', async () => {
    const storage = new StorageFake(new Set(['reportes-dia/cierre_turno_PACHACUTEC_2026-09-15_T2.pdf']));
    const caso = new ObtenerReporteTurnoDocumento(storage);

    const resultado = await caso.ejecutar(auth({ stationScope: '*' }), {
      estacionCodigo: 'PACHACUTEC',
      fechaNegocio: '2026-09-15',
      turno: 'TURNO2',
    });

    expect(resultado.tipo).toBe('application/pdf');
  });
});
