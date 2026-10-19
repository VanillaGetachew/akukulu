# Blackjack — implemented rules

Engine: `packages/engines/src/blackjack/blackjack.engine.ts` · Tests: `blackjack.engine.test.ts`

## Table
- One player against the dealer. A "match" is a **session** of any number of rounds at one table.
- Shoe: 6 standard decks by default (`decks` 1–8), shuffled server-side with `crypto.randomInt`. The shoe is reshuffled before a round once 75 % has been dealt (`penetration`). If a tiny shoe runs out mid-round a fresh shoe is used.
- Bets: whole points between `minBet` (the room stake, default 10) and `maxBet` (default 500), never more than the current balance.

## Rule set (defaults)
| Rule | Setting |
|---|---|
| Dealer on soft 17 | **Stands** (S17). Configurable to hit (`dealerHitsSoft17`). |
| Natural blackjack pays | **3:2** (`blackjackPayout` 1.5; 6:5 = 1.2 available). Payouts are rounded down to whole points. |
| Ordinary win | 1:1 |
| Push | Stake returned |
| Dealer peek | Dealer checks for blackjack when the up-card is an Ace or ten-value card. A dealer natural ends the round at once: player naturals push, everything else loses only the original bet. |
| Double down | On **any first two cards** (`doubleOn`: `any` · `9-11` · `10-11`); one card is dealt, then the hand stands. |
| Double after split | Allowed (`doubleAfterSplit`). |
| Split | Any two cards of **equal value** (e.g. K+Q). Up to **4 hands** (`maxHands`). |
| Split aces | One card each, then stand automatically. Aces cannot be re-split (`resplitAces`). |
| 21 after a split | Counts as 21, **not** a natural; pays 1:1. |
| Insurance / even money / surrender | **Not offered.** |

## Round flow
1. **Bet** — the stake is debited (ledger `match:<id>:r<n>:bet`).
2. Deal: player, dealer up-card, player, dealer hole card (face down).
3. Peek / naturals resolved immediately if either side has blackjack.
4. Player acts on each hand in order: `hit`, `stand`, `double`, `split`. A hand reaching 21 or busting completes automatically.
5. Dealer reveals the hole card and draws to 17 (per the soft-17 rule). The dealer does not draw if every player hand busted.
6. Each hand is settled: bust → lose; dealer bust → win; otherwise higher total wins, equal totals push. The total return is credited once per round (`match:<id>:r<n>:payout`). Extra stakes for doubles/splits are separate debits (`:double:<hand>`, `:split:<k>`).

## Privacy
The hole card is sent as `"??"` until the dealer reveals it; the shoe order is never sent to clients — only the remaining count.

## Timers and leaving
- Decision timer `turnSeconds` (30 s): on timeout the active hand stands.
- Idle timer `idleSeconds` (180 s) between rounds closes the session.
- `leave` between rounds closes the session. Leaving mid-round stands all remaining hands and settles the round first.
- Session outcome for statistics: net > 0 win, < 0 loss, 0 draw.
