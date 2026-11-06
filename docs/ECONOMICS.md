# Compute economics — actual arithmetic, not slogans

The intended **3.69%** is a transparent compute allocation, not an OSO fee or a guarantee of unlimited inference. Actual model/tool cost, network/facilitator cost, and the number of model calls per fan answer must be reconciled.

## Current example prices

At a meter price of **\$0.002 per model call**:

| Fan payment | 96.31% to artist | 3.69% compute allocation | Model calls funded before other costs |
|---:|---:|---:|---:|
| \$0.05 | \$0.048155 | \$0.001845 | 0.9225 |
| \$0.10 | \$0.096310 | \$0.003690 | 1.845 |
| \$1.00 | \$0.963100 | \$0.036900 | 18.45 |

Minimum fan revenue before other costs:

- One model call: $0.002 / 0.0369 \approx \mathbf{\$0.0542}$.
- Two model calls: $0.004 / 0.0369 \approx \mathbf{\$0.1084}$.
- Three model calls: $0.006 / 0.0369 \approx \mathbf{\$0.1626}$.

Therefore a \$0.10 tip does **not** fund twenty answers. It funds fewer than two model calls, and fewer after network/facilitator costs. A tool-using or schema-repair answer can make multiple paid calls; every call needs its own proof and budget reservation.

## Bootstrap and sequencing

The first question cannot be funded by its own later-settling compute share. A demo needs an explicitly disclosed pre-funded meter/0G balance, a sponsor credit, or a different sequencing/credit arrangement. That is **not** proof of an autonomous self-funding loop.

The Mumbai narrow demo uses one artist-grounded inference path and discloses pre-funding. It does not claim the 0G **Agents That Pay for Themselves** prize. That requires money in → automatic credit in the agent's own 0G Compute account → inference paid from that balance, with transaction/request evidence and no manual top-up.

## Required production policy

1. Quote from the actual route: expected model calls × current compute price + network/facilitator costs. Do not use a hard-coded estimate that can be bypassed by tools/repairs.
2. Reserve each call before execution, reconcile actual cost immediately, and retain earlier spend on later failure. Coordinate across processes/hosts, not only one in-memory budget.
3. Show artist revenue, compute allocation, actual compute spend, fees, and remaining balance separately. Fan revenue is not compute spend.
4. Define what happens to unspent compute allocations (for example, return to artist or a transparent shared compute pool). This needs an explicit artist/community decision; no silent retained margin.
5. Preserve a free/degraded path without charging fans. Sponsored compute needs limits and a graduation path, not a hidden permanent subsidy.
6. Prefer reviewed direct-stablecoin atomic splits or a supported multi-recipient mechanism. Do not launch a fan-facing token merely to implement fees; the current custom-token script is disabled and the product promise is **no token**.

A healthy target is not “the agent always thinks.” It is **the artist gets paid, the fan knows the price, and the steward never spends more than its transparent, actual-cost compute budget.**
