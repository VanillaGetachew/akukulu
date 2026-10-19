# Poker — No-Limit Texas Hold'em (implemented rules)

Engine: `packages/engines/src/poker/poker.engine.ts` · Evaluator: `hand-evaluator.ts` · Tests alongside.

## Format
- **Sit-and-go table** for 2–9 players (`maxSeats`, default 6).
- Every player buys in for the room's stake (default 500 points; minimum 100) and receives that many chips (1 point = 1 chip).
- Blinds: big blind = buy-in ÷ 50 (min 2) unless configured; small blind = half the big blind. Buy-in must be ≥ 10 big blinds. Blinds do not increase.
- The table plays hands until one player holds every chip, or `maxHands` is reached (0 = unlimited), or fewer than two players remain.
- When a player leaves, busts or the table closes, their remaining chips are cashed out to their balance (ledger key `match:<id>:cashout:<player>`). Points are never created or destroyed by play: the total of buy-ins equals the total cashed out.

## Positions
- The first button is chosen with the server's secure RNG and moves one active seat clockwise each hand.
- 3+ players: small blind left of the button, big blind next; first to act pre-flop is left of the big blind; post-flop the first active player left of the button acts first.
- **Heads-up**: the button posts the small blind and acts first pre-flop and last post-flop.
- A player who cannot cover a blind posts what they have and is all-in.

## Dealing
- Fresh 52-card deck shuffled with Fisher–Yates using `crypto.randomInt` every hand.
- Two private hole cards each, then flop (3), turn (1), river (1), each preceded by a burn card.

## Betting
- Actions: `fold`, `check`, `call`, `bet {amount}`, `raise {amount}`, `allIn`, `leave`. Amounts are **"to" amounts** — the player's total commitment for the current street.
- Minimum opening bet: one big blind. Minimum raise: the size of the last full bet/raise on the street.
- A player may always go all-in for less than a minimum bet/raise.
- **Short all-in rule**: an all-in raise smaller than a full raise does not reopen betting for players who already acted — they may only call or fold.
- A street ends when every player who can still act has acted since the last full raise and matched the current bet.
- If at most one player can still act (the rest are all-in), the remaining board is dealt out automatically.

## Pots and showdown
- Side pots are built from each player's total commitment; each pot is contested only by non-folded players who contributed to that level. Uncalled excess forms a pot only its owner can win (i.e. it is returned).
- Hands are evaluated as the best five of seven cards. Ranking: high card < one pair < two pair < three of a kind < straight < flush < full house < four of a kind < straight flush (royal flush = ace-high straight flush). A-2-3-4-5 is the lowest straight; there is no wrap-around.
- Ties split the pot equally. Odd chips go one at a time to the tied winners closest to the left of the button.
- At showdown all non-folded hands are revealed to the table (no mucking). Hands won uncontested are never revealed.

## Privacy
- The deck and every player's hole cards live only in the server-side state.
- Each socket/REST view contains the viewer's own hole cards; opponents' cards are sent as `"??"` until revealed at showdown. Spectators see no hole cards.

## Timers and disconnection
- Each decision has a deadline (`turnSeconds`, default 25 s). On timeout the server checks if possible, otherwise folds.
- After `maxMissedTurns` (default 3) consecutive timeouts the player is removed at the end of the hand and cashed out.
- `leave` folds the player's hand (out of turn if necessary) and cashes them out at the end of the hand, or immediately between hands.
- A 5-second pause (`handPauseMs`) separates hands so results are visible.

## Results
- Placements rank players by final chips (ties broken by who stayed longer). The unique chip leader is the winner; tied leaders get a draw; everyone else a loss. `pointsDelta` is the player's net ledger total for the match.
