// handler.test.ts
import { handler } from './handler';
import type { PreTokenGenerationV3TriggerEvent } from 'aws-lambda';

function eventoDe(
  scopes: string[] | undefined,
  overrides: { triggerSource?: string; clientId?: string } = {}
): PreTokenGenerationV3TriggerEvent {
  return {
    version: '3',
    triggerSource: (overrides.triggerSource ?? 'TokenGeneration_ClientCredentials') as never,
    region: 'us-east-2',
    userPoolId: 'us-east-2_nQ1gjcb0j',
    userName: '',
    callerContext: { clientId: overrides.clientId ?? 'test-client-id' } as never,
    request: { scopes } as never,
    response: {} as never,
  } as PreTokenGenerationV3TriggerEvent;
}

describe('auth-pre-token-generation handler', () => {
  it('no toca el evento si triggerSource no es TokenGeneration_ClientCredentials', async () => {
    const event = eventoDe(['fuelhub-api/cierres.write'], { triggerSource: 'TokenGeneration_HostedAuth' });
    const resultado = await handler(event, {} as never, () => undefined);
    expect(resultado).toBe(event);
    expect((resultado as PreTokenGenerationV3TriggerEvent).response.claimsAndScopeOverrideDetails).toBeUndefined();
  });

  it('rechaza explícitamente cuando no hay ningún scope station.* ni son todos exentos', async () => {
    const event = eventoDe(['fuelhub-api/cierres.write']);
    await expect(handler(event, {} as never, () => undefined)).rejects.toThrow(/station_scope/);
  });

  it('rechaza cuando la lista de scopes viene vacía', async () => {
    const event = eventoDe([]);
    await expect(handler(event, {} as never, () => undefined)).rejects.toThrow(/station_scope/);
  });

  it('agrega custom:role/custom:station_scope cuando hay un scope station.<CODIGO>', async () => {
    const event = eventoDe(['fuelhub-api/cierres.write', 'fuelhub-api/cierres.read', 'fuelhub-api/station.CHANCAYLLO']);
    const resultado = (await handler(event, {} as never, () => undefined)) as PreTokenGenerationV3TriggerEvent;

    expect(resultado.response.claimsAndScopeOverrideDetails).toEqual({
      accessTokenGeneration: {
        claimsToAddOrOverride: {
          'custom:role': 'SISTEMA_GRIFO',
          'custom:station_scope': 'CHANCAYLLO',
        },
      },
    });
  });

  it('soporta el wildcard station.* (custom:station_scope = "*")', async () => {
    const event = eventoDe(['fuelhub-api/cierres.read', 'fuelhub-api/station.*']);
    const resultado = (await handler(event, {} as never, () => undefined)) as PreTokenGenerationV3TriggerEvent;

    expect(resultado.response.claimsAndScopeOverrideDetails?.accessTokenGeneration?.claimsToAddOrOverride).toEqual({
      'custom:role': 'SISTEMA_GRIFO',
      'custom:station_scope': '*',
    });
  });

  it('v1.72: no lanza y no agrega claims cuando el único scope solicitado es comprobantes.read', async () => {
    const event = eventoDe(['fuelhub-api/comprobantes.read']);
    const resultado = (await handler(event, {} as never, () => undefined)) as PreTokenGenerationV3TriggerEvent;

    expect(resultado).toBe(event);
    expect(resultado.response.claimsAndScopeOverrideDetails).toBeUndefined();
  });

  it('v1.72: si comprobantes.read viene MEZCLADO con otro scope no exento, sigue exigiendo station.*', async () => {
    const sinStation = eventoDe(['fuelhub-api/comprobantes.read', 'fuelhub-api/cierres.write']);
    await expect(handler(sinStation, {} as never, () => undefined)).rejects.toThrow(/station_scope/);

    const conStation = eventoDe(['fuelhub-api/comprobantes.read', 'fuelhub-api/cierres.write', 'fuelhub-api/station.MALA']);
    const resultado = (await handler(conStation, {} as never, () => undefined)) as PreTokenGenerationV3TriggerEvent;
    expect(resultado.response.claimsAndScopeOverrideDetails?.accessTokenGeneration?.claimsToAddOrOverride).toEqual({
      'custom:role': 'SISTEMA_GRIFO',
      'custom:station_scope': 'MALA',
    });
  });
});
