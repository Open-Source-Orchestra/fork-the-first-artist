/**
 * Confirm settlement before either paid endpoint records spend or returns proof.
 *
 * A transport failure or a success response without a transaction id is
 * ambiguous: the facilitator may have accepted the transfer. Those cases return
 * `settled: null` and require reconciliation rather than claiming either success
 * or that no payment occurred.
 */
import type { Gate, SettleResult } from './gate/index.ts';

export type SettlementResult =
  | { ok: true; settlement: SettleResult; txId: string }
  | {
      ok: false;
      body: {
        error: 'SETTLEMENT_FAILED' | 'SETTLEMENT_UNCONFIRMED';
        message: string;
        settled: false | null;
        proof: null;
        reconciliationRequired?: true;
      };
    };

export async function settleConfirmed(
  gate: Gate,
  input: Parameters<Gate['settle']>[0],
): Promise<SettlementResult> {
  let settlement: SettleResult;
  try {
    settlement = await gate.settle(input);
  } catch {
    return {
      ok: false,
      body: {
        error: 'SETTLEMENT_UNCONFIRMED',
        message:
          'Payment settlement could not be confirmed. Reconcile with the facilitator before retrying; no paid response or ledger entry was produced.',
        settled: null,
        proof: null,
        reconciliationRequired: true,
      },
    };
  }

  if (!settlement.success) {
    return {
      ok: false,
      body: {
        error: 'SETTLEMENT_FAILED',
        message: settlement.errorReason ?? 'The facilitator did not settle the payment.',
        settled: false,
        proof: null,
      },
    };
  }

  const txId = typeof settlement.txId === 'string' ? settlement.txId.trim() : '';
  if (!txId) {
    return {
      ok: false,
      body: {
        error: 'SETTLEMENT_UNCONFIRMED',
        message:
          'The facilitator reported success without a transaction id. Payment status is unknown; reconcile before retrying. No paid response or ledger entry was produced.',
        settled: null,
        proof: null,
        reconciliationRequired: true,
      },
    };
  }

  return { ok: true, settlement, txId };
}
