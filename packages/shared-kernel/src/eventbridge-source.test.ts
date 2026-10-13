// eventbridge-source.test.ts (v1.88)

import { fuenteEventBridgePara, SOURCE_FUELHUBCLOUD_PROD } from './eventbridge-source';

describe('fuenteEventBridgePara', () => {
  it('prod usa el valor histórico literal "FuelHubCloud", sin sufijo', () => {
    expect(fuenteEventBridgePara('prod')).toBe('FuelHubCloud');
    expect(fuenteEventBridgePara('prod')).toBe(SOURCE_FUELHUBCLOUD_PROD);
  });

  it('dev usa "FuelHubCloud-dev" -- distinto a prod, para que notificaciones-whatsapp lo ignore sin cambios de su lado', () => {
    expect(fuenteEventBridgePara('dev')).toBe('FuelHubCloud-dev');
  });

  it('dev nunca coincide por accidente con el valor de prod', () => {
    expect(fuenteEventBridgePara('dev')).not.toBe(fuenteEventBridgePara('prod'));
  });
});
