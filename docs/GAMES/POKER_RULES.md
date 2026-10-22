# Poker — No-Limit Texas Hold'em (implemented rules)

Engine: `packages/engines/src/poker/poker.engine.ts` (one table) and `poker-mtt.ts` (scheduled multi-table tournaments) · Evaluator: `hand-evaluator.ts` · Lobby service: `apps/api/src/poker/poker.service.ts` · Tests alongside.

The lobby follows the big online rooms (Stake Poker, PokerStars, GGPoker): **Cash games** — always-open tables at fixed stakes plus private tables — and **Tournaments** — scheduled tournaments created by the administrators plus Sit & Gos. What we took from each, with sources, is in *Research* at the end.

## Format
- **Private / quick-play cash table** (default, `mode: 'cash'`) for 2–9 players (`maxSeats`, default 6). The always-open tables are described under *Cash tables* below, tournaments under *Tournaments*.
- Every player buys in for the room's stake (default 500 points; minimum 100) and receives that many chips (1 point = 1 chip).
- Blinds: big blind = buy-in ÷ 50 (min 2) unless configured; small blind = half the big blind. Buy-in must be ≥ 10 big blinds. Blinds do not increase.
- The table plays hands until one player holds every chip, or `maxHands` is reached (0 = unlimited), or fewer than two players remain.
- When a player leaves, busts or the table closes, their remaining chips are cashed out to their balance (ledger key `match:<id>:cashout:<player>`). Points are never created or destroyed by play: the total of buy-ins equals the total cashed out.

## Positions
- The first button is chosen with the server's secure RNG and moves one active seat clockwise each hand.
- 3+ players: small blind left of the button, big blind next; first to act pre-flop is left of the big blind; post-flop the first active player left of the button acts first.
- **Heads-up**: the button posts the small blind and acts first pre-flop and last post-flop.
- A player who cannot cover a blind posts what they have and is all-in.
- **Antes** (`config.ante`, used by scheduled tournaments): every player dealt in puts the ante into the pot before the blinds. Antes are dead money — they do not count towards calling the big blind.

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
- After `maxMissedTurns` (default 3) consecutive timeouts the player is removed at the end of the hand and cashed out. In a scheduled tournament they stay seated and keep being checked/folded (blinded away), as on the big sites.
- `leave` folds the player's hand (out of turn if necessary) and cashes them out at the end of the hand, or immediately between hands.
- A 5-second pause (`handPauseMs`) separates hands so results are visible.

## Results
- Placements rank players by final chips (ties broken by who stayed longer). The unique chip leader is the winner; tied leaders get a draw; everyone else a loss. `pointsDelta` is the player's net ledger total for the match.

## Cash tables (always open)
- At boot and after every sit-down the API makes sure each stake level in `POKER_CASH_STAKES` — **5/10, 25/50, 100/200, 500/1000** — has a 9-seat table with a free seat (`Addis 5/10`, `Lalibela 25/50`, `Gondar 100/200`, `Axum 500/1000`; a full table gets a sister table "… II"). These are matches without a room (`config.permanent: true`) that **never finish**.
- **Sit down** at any free seat (`POST /poker/tables/:matchId/sit {buyIn, seat?}`) with **40–100 big blinds** (`POKER_CASH_MIN_BB`/`POKER_CASH_MAX_BB`), capped by your balance. The buy-in is debited at once (ledger key `buyin:<player>:<sit n>`).
- You are dealt in from the next hand. If a game is already running you **post one big blind** with your first hand (unless you are in the blinds anyway), so nobody saves the blinds by sitting down late.
- **Stand up** any time (`leave`): between hands you are cashed out at once; during a hand your cards are folded and you are cashed out when it ends (`cashout:<player>:<sit n>`). Running out of chips also frees the seat. Players who stand up drop off the match roster and keep watching as spectators; they can sit down again with a new buy-in.
- With fewer than two players the table **waits** (`phase: 'waiting'`); the next hand is dealt a moment after a second player sits.
- Anyone can open a table and watch before sitting (`/poker/<matchId>` in the web app).

## Tournaments (scheduled, multi-table)
Created, edited and cancelled by administrators (`ADMIN_TELEGRAM_IDS`) in the admin page: name, start time, buy-in (0 = freeroll), guaranteed prize pool, starting stack, minutes per level, late registration (levels), maximum entrants, players per table.
- **Registration** (`POST /poker/tournaments/:id/register`) takes the buy-in at once (`tournament:<id>:buyin:<entry>`); **unregistering** before the start returns it (`…:refund:<entry>`). Cancelling a tournament returns every buy-in (`…:cancel:<entry>`) and voids a running match.
- **Start**: the API sweep starts the tournament at its start time with everyone registered (two or more; otherwise it is cancelled and refunded). Players are shuffled to tables of `tableSize` (2–9) and the first hand is dealt after 3 seconds.
- **Late registration** stays open for `lateRegLevels` levels: a late player gets the starting stack at the table with the fewest players (a new table if all are full).
- **Blinds rise by the clock** every `levelMinutes` (`pokerMttLevel`): the Sit & Go ladder 10/20, 15/30, 25/50, 50/100, … with an **ante of a tenth of the big blind from level 4**. A table moves to the new level with its next hand.
- **Table balancing** between hands: when the field fits on fewer tables, the smallest table that is between hands is broken and its players spread to the shortest tables; otherwise a player moves from the fullest table to the shortest whenever they differ by two or more (the player due to post the next big blind moves). Moved players keep their stack and sit out until the next deal.
- Busted players are out; those who bust in the same round of hands are ranked by the stack they started the hand with. The last player with chips wins.
- **Prize pool** = the larger of the guarantee and buy-in × entrants (the house adds any overlay). **Payouts** (`pokerMttPayouts`): up to 9 entrants as for Sit & Gos; bigger fields pay **about 15%** of entrants, with shares falling as 1/place^0.8 — the winner of 100 entrants takes about 24%. Prizes are paid once at the end (`prize:<player>`).
- The lobby shows each tournament with a status strip, a countdown ring to the start, start time, NL HOLD'EM and table-size badges, name, prize pool, registered count, buy-in and a **Register / Unregister / Late reg / Open table** button; tapping it opens an info drawer (prize pool, 1st prize, places paid, buy-in, stacks, levels, late registration), a **Prizes** tab and a **Blinds** tab.

## Tournaments (Sit & Go)
Single-table tournaments that start when the table is ready. Sources for the format: [VIP-Grinders Sit & Go guide](https://www.vip-grinders.com/poker-strategy/tournaments/sit-and-go-poker/), [PokerNews Sit & Go strategy](https://www.pokernews.com/strategy/how-to-develop-a-winning-sit-and-go-tournament-strategy-23865.htm).

- Room option `config.mode: 'tournament'`. The room stake is the **buy-in**, which may be free. Every buy-in goes into the **prize pool** (`buyIn × entrants`).
- Everyone starts with **1,500 tournament chips** (`POKER_TOURNAMENT_STACK`). Chips are not points: there is no cash-out, and a player who leaves forfeits their chips.
- **Blinds** start at 10/20 and rise every **6 hands** (`levelHands`, 2–20) through `POKER_TOURNAMENT_BIG_BLINDS` (20, 30, 50, 100, 150, 200, 300, 400, 600, 800, 1000, …), with the small blind always half the big blind.
- A player who busts is out. Players who bust in the same hand are ranked by the stack they started that hand with. The table plays on until one player holds every chip.
- **Payouts** by finishing place (`pokerPayouts`): winner takes all with 2–3 entrants, **65 / 35** with 4–6, **50 / 30 / 20** with 7–9. Rounding leftovers go to the winner. Prizes are paid once at the end (ledger keys `prize:<player>`), and placements follow the finishing order.
- A Sit & Go starts as soon as everyone seated is ready (2–9 seats). Quick play only matches tables of the same mode.

## Hand history
- Every finished hand is recorded as a `hand_summary` match event: blinds and ante, board, button, every player dealt in with starting stack, net result and hole cards, the action street by street, the pots and winners, and the hands shown down (with their names).
- `GET /poker/hands?matchId=&limit=` returns the caller's hands. **Your own cards are always shown; opponents' only if they were shown down** — like GGPoker's PokerCraft. The replay endpoint `/matches/:id/events` hides the same cards.
- Open it from the table (bottom-left button or the menu) or from your profile.

## Table
- Stake-style: a dark maroon room with a faint fleur-de-lis pattern, and an **oval blue felt with an orange rail**. On a phone the oval stands upright; on wide screens it lies flat. You sit at the bottom centre; at cash tables every seat keeps its place round the rail and free seats show a **Sit** button for someone watching.
- Top bar: menu (lobby, hand history, tournament info, stand up / leave), the table tab, a lobby link and the table id. Bottom corners: **hand history** and **settings** (auto check / fold, stand up / leave). The app has no table chat yet.
- Each seat: round avatar, name and a stack tag below. The player to act has a **purple name and a countdown ring** with the seconds left. Opponents' card backs are tucked behind their avatar; shown-down cards sit beside the seat with the hand's name. Tags show **Fold**, **All-in**, **Next hand** (just sat down) and tournament places.
- In the middle: a small grey **info line** ("Lalibela 25/50, Blinds 25/50 (5)", or the tournament name, blinds and ante), **Pot: X** with a chip stack, and the board. Bets sit as chip stacks in front of each seat and a **D** button marks the dealer. Winners get a gold outline and a result line ("You won 7,300 · Full House, Nines over Sevens").
- Your hole cards are face up beside your seat, and your **best hand so far** is named under your stack, updated street by street ("Ace High" → "Pair of Kings" → "Two Pair, Aces & Kings").
- Actions: **Fold**, **Check / Call**, **Bet / Raise to** with a slider and **Min, ½ pot, ¾ pot, Pot, All-in** presets (pot-sized raises count the call). Out of turn, a **Check / fold** box acts for you automatically.
- Tournament bar: level, next blinds (and when they rise), prize pool, players left; tap it for the tournament drawer — prize pool, 1st prize, places paid, level clock, blinds and antes, players left, **my position**, smallest / average / largest stack, tables, late registration — and a **Prizes** tab. "You finished 3rd — prize …" appears when you are out.

## Research
What the big rooms do, and what Akukulu adopted (virtual points only — nothing here involves real money):
- **Always-open cash tables at fixed stakes, NL Hold'em 6- and 9-max** — Stake Poker runs NL Hold'em and PLO ring games 6-max and 9-max with hourly MTTs ([VIP-Grinders Stake review](https://www.vip-grinders.com/rakeback-deals/stake-poker-review/), [pokerfuse Stake review](https://pokerfuse.com/online-poker/international/stake-poker-review/), [PokerListings Stake](https://www.pokerlistings.com/poker-sites/stake-com-poker)). Adopted: four stake levels, 9-max, sister tables when full.
- **Buy-in range** — online cash games usually allow a maximum of 100 big blinds and a minimum of 20–40 ([Table stakes — Wikipedia](https://en.wikipedia.org/wiki/Table_stakes), [PokerListings: buy-in](https://www.pokerlistings.com/poker-terms/buy-in)). Adopted: 40–100 big blinds.
- **New players and the blinds** — a player joining a game either waits for the big blind or posts one to be dealt in at once ([PokerZone: buttons and blinds](https://www.pokerzone.com/rules/buttons-and-blinds/), [CardPlayer: buttons and blinds](https://cardplayer.com/rules-of-poker/buttons-and-blinds), [PokerListings: button and blind use](https://www.pokerlistings.com/poker-guides/button-and-blind-use)). Adopted: post one big blind with the first hand.
- **Late registration** — PokerStars keeps late registration open for hours in its big tournaments ([PokerNews: Jet Set finale](https://www.pokernews.com/news/2026/07/dont-miss-350k-guaranteed-pokerstars-jet-set-seat-finale-51791.htm), [PokerListings: Sunday Million](https://www.pokerlistings.com/news/16th-anniversary-sunday-million-10m-guaranteed-on-march-20th), [PokerSkill: late registration](https://www.pokerskill.com/poker-glossary/late-registration/)). Adopted: a configurable number of levels; no re-entries yet.
- **Payout structure** — roughly 15% of the field is paid and the winner takes about 20–25% in large fields ([PokerStrategy: payout structure](https://www.pokerstrategy.com/glossary/Payout-Structure/), [VIP-Grinders: tournament payouts](https://www.vip-grinders.com/?p=132867)). Adopted: `pokerMttPayoutPercents`.
- **Table balancing** — move a player from the fullest table to the shortest, keep tables within one player, break tables as the field shrinks ([BetArabia: table balancing in MTTs](https://betarabia.ladesk.com/392943-30-Table-Balancing-in-MTTsTO-CHECK-), [PokerChipForum: keeping tables balanced](https://pokerchipforum.com/threads/how-to-move-players-keeping-tables-balanced-in-a-tournament.184)). Adopted as described above (moves happen between hands; the next big blind moves).
- **Hand history** — GGPoker's PokerCraft keeps every hand with a replayer; opponents' cards stay hidden unless they were shown ([WorldPokerDeals: PokerCraft review](https://worldpokerdeals.com/blog/ggpoker-pokercraft-review)). Adopted: per-hand summaries with the same privacy rule.
- Not adopted yet: table chat, re-entries and add-ons, rabbit hunting, run-it-twice, rake (there is none — points are virtual).
