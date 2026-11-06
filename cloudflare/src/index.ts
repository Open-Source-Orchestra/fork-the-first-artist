import { createPayer, type Payer } from '../../agent/src/rails/payer.ts';
import type { Config } from '../../payments/src/config.ts';
import { createHederaGate } from '../../payments/src/gate/hedera.ts';
import { createApp } from './app.ts';
import { loadConfig, type Env, type WorkerConfig } from './config.ts';
import { errorBody, json, withCommonHeaders } from './http.ts';
import { DurablePaymentReplayGuard } from './replay-guard.ts';

let cachedApp: ((request: Request) => Promise<Response>) | undefined;

function productionApp(env: Env) {
  if (cachedApp) return cachedApp;
  const cfg = loadConfig(env);

  // createHederaGate reads only these three fields. Reuse its canonical live
  // facilitator behavior rather than copying the challenge/verify/settle wire code.
  const gateConfig = {
    network: cfg.network,
    facilitatorUrl: cfg.facilitatorUrl,
    asset: { id: cfg.assetId, decimals: cfg.assetDecimals },
  } as Config;
  const gate = createHederaGate(gateConfig);

  let fanPayer: Promise<Payer> | undefined;
  const createFanPayer = () => {
    fanPayer ??= createPayer({
      accountId: cfg.fanAccountId,
      privateKey: cfg.fanPrivateKey,
      network: cfg.network,
      maxAmountPerPayment: cfg.maxPaymentUsd,
      allowMock: false,
    });
    return fanPayer;
  };

  if (!env.PAYMENT_REPLAY_GUARD) throw new Error('PAYMENT_REPLAY_GUARD binding is required');
  cachedApp = createApp({
    config: cfg,
    gate,
    createFanPayer,
    replayGuard: new DurablePaymentReplayGuard(env.PAYMENT_REPLAY_GUARD),
  });
  return cachedApp;
}

export { createApp } from './app.ts';
export { PaymentReplayDurableObject } from './replay-guard.ts';
export { createHederaGate } from '../../payments/src/gate/hedera.ts';
export type { AppDependencies } from './app.ts';
export type { WorkerConfig } from './config.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await productionApp(env)(request);
    } catch {
      return withCommonHeaders(
        json(
          503,
          errorBody(
            'NOT_CONFIGURED',
            'the live demo is not configured; see docs/HOSTING.md for required variables',
          ),
        ),
        request,
      );
    }
  },
};
