// GenerarReporteTurnoDocumento.test.ts (v1.85)
//
// Mismo criterio de fakes en memoria que GenerarReporteDiaDocumento.test.ts.

import { GenerarReporteTurnoDocumento } from './GenerarReporteTurnoDocumento';
import type { ReporteDiaDTO, ReporteDiaQueryRepository, ReporteDiaTurnoDTO } from '../ports/ReporteDiaQueryRepository';
import type { ReporteTurnoRendererPort } from '../ports/ReporteTurnoDocumentoPorts';
import type { DocumentoStoragePort } from '../ports/ReporteDiaDocumentoPorts';

function turnoDe(cierreTurnoId: string): ReporteDiaTurnoDTO {
  return {
    cierreTurnoId,
    turno: 'TURNO1',
    empleado: 'Juan Pérez',
    fechaInicio: '2026-09-15T06:00:00.000Z',
    fecha: '2026-09-15T14:00:00.000Z',
    total: 400,
    productos: [],
  };
}

class RepoFake implements ReporteDiaQueryRepository {
  public llamadasObtenerTurnoPorId: string[] = [];
  constructor(private readonly turnosPorId: Record<string, ReporteDiaTurnoDTO | null>) {}

  async obtener(): Promise<ReporteDiaDTO | null> {
    throw new Error('no usado en este caso de uso');
  }
  async listarCodigosEstacionesActivas(): Promise<string[]> {
    throw new Error('no usado en este caso de uso');
  }
  async listarTurnos(): Promise<ReporteDiaTurnoDTO[]> {
    throw new Error('no usado en este caso de uso');
  }
  async obtenerTurnoPorId(cierreTurnoId: string): Promise<ReporteDiaTurnoDTO | null> {
    this.llamadasObtenerTurnoPorId.push(cierreTurnoId);
    return this.turnosPorId[cierreTurnoId] ?? null;
  }
}

class RendererFake implements ReporteTurnoRendererPort {
  public llamadas: { estacionCodigo: string; fechaNegocio: string; turno: ReporteDiaTurnoDTO }[] = [];
  async renderizarPdfTurno(estacionCodigo: string, fechaNegocio: string, turno: ReporteDiaTurnoDTO): Promise<Buffer> {
    this.llamadas.push({ estacionCodigo, fechaNegocio, turno });
    return Buffer.from('pdf-fake');
  }
}

class StorageFake implements DocumentoStoragePort {
  public subidas: { key: string; contentType: string }[] = [];
  async subir(params: { buffer: Buffer; key: string; contentType: string }): Promise<void> {
    this.subidas.push({ key: params.key, contentType: params.contentType });
  }
  async obtenerUrlFirmada(): Promise<never> {
    throw new Error('no usado en este caso de uso');
  }
}

describe('GenerarReporteTurnoDocumento', () => {
  it('genera y sube el PDF del turno con la key estable cierre_turno_{ESTACION}_{fecha}_T{N}.pdf', async () => {
    const repo = new RepoFake({ 'turno-id-1': turnoDe('turno-id-1') });
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const caso = new GenerarReporteTurnoDocumento(repo, renderer, storage);

    await caso.ejecutar({ estacionCodigo: 'PACHACUTEC', fechaNegocio: '2026-09-15', turno: 'TURNO1', cierreTurnoId: 'turno-id-1' });

    expect(repo.llamadasObtenerTurnoPorId).toEqual(['turno-id-1']);
    expect(renderer.llamadas).toEqual([{ estacionCodigo: 'PACHACUTEC', fechaNegocio: '2026-09-15', turno: turnoDe('turno-id-1') }]);
    expect(storage.subidas).toContainEqual({
      key: 'reportes-dia/cierre_turno_PACHACUTEC_2026-09-15_T1.pdf',
      contentType: 'application/pdf',
    });
  });

  it('no sube nada si, por una condición de carrera, el cierre recién publicado no aparece todavía en el repo', async () => {
    const repo = new RepoFake({});
    const renderer = new RendererFake();
    const storage = new StorageFake();
    const caso = new GenerarReporteTurnoDocumento(repo, renderer, storage);

    await caso.ejecutar({ estacionCodigo: 'PACHACUTEC', fechaNegocio: '2026-09-15', turno: 'TURNO1', cierreTurnoId: 'no-existe' });

    expect(storage.subidas).toHaveLength(0);
    expect(renderer.llamadas).toHaveLength(0);
  });
});
