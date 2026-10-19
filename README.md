# Agents on Open Rails: Seña

An autonomous agent that takes deposits ("señas") for appointments and bookings
in wARS (Ripio's Argentine peso stablecoin) on Celo mainnet, and decides what to
do with each cancellation on its own.

Built for the Agents on Open Rails hackathon (Celo x Loops House).
Track: Stable Agents: LatAm.

> Status: work in progress. Code is written during the hackathon window.

## What it does

1. A business with bookings asks for a deposit to confirm a slot.
2. The customer pays the deposit in wARS from Telegram. Amounts always show in pesos.
3. The agent confirms the slot and applies the cancellation policy:
   refund if cancelled in time, keep the deposit if late, and offer the freed
   slot to a waiting list.
4. Every decision is logged with its reason.

Money rules (refund limits, spending caps, idempotency) are fixed code,
not model decisions.

## Rails used

- wARS on Celo mainnet (chain 42220), charged over x402 through Celo's hosted facilitator
  (wARS settles via Permit2, 18 decimals)
- ERC-8004 agent identity, registered from the agent wallet
- ERC-8021 attribution tag on every transaction the agent wallet sends

## Hackathon entry data

| Item | Value |
| --- | --- |
| Agent wallet | TODO |
| ERC-8004 agent ID | TODO |
| Attribution tag | TODO |
| x402 PayTo address | TODO |

## Declared limits

- The demo merchant is a demonstration business, not an independent shop.
- Early buyers are people I know. Where users or volume come from is noted here as the project grows.
- Cash-out from wARS to pesos is manual through Ripio's public ramp.
- Anything not tested on mainnet is marked as such.

## Run locally

TODO. Never commit real keys. Copy `.env.example` to `.env` and fill it in.

## License

TODO
