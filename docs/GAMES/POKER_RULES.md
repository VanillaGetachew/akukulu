# Poker — No-Limit Texas Hold'em (implemented rules)

Engine: `packages/engines/src/poker/poker.engine.ts` · Evaluator: `hand-evaluator.ts` · Tests alongside.

## Format
- **Cash game** (default, `mode: 'cash'`) for 2–9 players (`maxSeats`, default 6). Tournaments are described under *Tournaments (Sit & Go)* below.
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

## Tournaments (Sit & Go)
The lobby has two sections, **Cash games** and **Tournaments**, like the big poker sites. Sources for the format: [VIP-Grinders Sit & Go guide](https://www.vip-grinders.com/poker-strategy/tournaments/sit-and-go-poker/), [PokerNews Sit & Go strategy](https://www.pokernews.com/strategy/how-to-develop-a-winning-sit-and-go-tournament-strategy-23865.htm).

- Room option `config.mode: 'tournament'`. The room stake is the **buy-in**, which may be free. Every buy-in goes into the **prize pool** (`buyIn × entrants`).
- Everyone starts with **1,500 tournament chips** (`POKER_TOURNAMENT_STACK`). Chips are not points: there is no cash-out, and a player who leaves forfeits their chips.
- **Blinds** start at 10/20 and rise every **6 hands** (`levelHands`, 2–20) through `POKER_TOURNAMENT_BIG_BLINDS` (20, 30, 50, 100, 150, 200, 300, 400, 600, 800, 1000, …), with the small blind always half the big blind.
- A player who busts is out. Players who bust in the same hand are ranked by the stack they started that hand with. The table plays on until one player holds every chip.
- **Payouts** by finishing place (`pokerPayouts`): winner takes all with 2–3 entrants, **65 / 35** with 4–6, **50 / 30 / 20** with 7–9. Rounding leftovers go to the winner. Prizes are paid once at the end (ledger keys `prize:<player>`), and placements follow the finishing order.
- A Sit & Go starts as soon as everyone seated is ready (2–9 seats). Quick play only matches tables of the same mode.

## Table
- Dark room with an oval green felt and a dark rail. On a phone the oval stands upright; on wide screens it lies flat. You sit at the bottom centre and the other seats spread round the rail.
- Each seat shows an avatar, a name and stack tag, the opponent's two cards tucked at the avatar, and the last action (Fold, All-in, call, …). The player to act has a **yellow countdown ring** with the seconds left. Bets sit as chip stacks in front of each seat, the pot is in the middle above the board, and a **D** button marks the dealer.
- Your hole cards are face up next to your seat. Winners get a gold outline and a result line ("You won 640 with Two Pair").
- Actions: **Fold**, **Check / Call**, **Bet / Raise to** with a slider and **Min, ½ pot, ¾ pot, Pot, All-in** presets (pot-sized raises count the call). Out of turn, a **Check / fold** box acts for you automatically.
- Tournament bar: level, next blinds and how many hands until they rise, prize pool, players left, and "You finished 3rd — prize …" when you are out.
