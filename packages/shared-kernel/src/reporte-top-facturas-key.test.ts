import { construirKeyReporteTopFacturasJson, construirKeyReporteTopFacturasExcel } from './reporte-top-facturas-key';
import { ParametrosInvalidosError } from './errors';

describe('construirKeyReporteTopFacturasJson/Excel', () => {
  it('arma la key del JSON', () => {
    expect(construirKeyReporteTopFacturasJson('CHANCAYLLO', '2026-10-06')).toBe(
      'top-facturas/reporte_top_facturas_CHANCAYLLO_2026-10-06.json'
    );
  });

  it('arma la key del Excel, mismo prefijo/nombre base que el JSON', () => {
    expect(construirKeyReporteTopFacturasExcel('CHANCAYLLO', '2026-10-06')).toBe(
      'top-facturas/reporte_top_facturas_CHANCAYLLO_2026-10-06.xlsx'
    );
  });

  it('rechaza semanaInicio con formato invalido', () => {
    expect(() => construirKeyReporteTopFacturasJson('CHANCAYLLO', '06/10/2026')).toThrow(ParametrosInvalidosError);
    expect(() => construirKeyReporteTopFacturasExcel('CHANCAYLLO', '06/10/2026')).toThrow(ParametrosInvalidosError);
  });
});
