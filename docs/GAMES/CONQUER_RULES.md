# Ethiopian Conquer (ካርታ ኮንከር) — implemented rules

Engine: `packages/engines/src/conquer/conquer.engine.ts` · Rules module: `packages/engines/src/conquer/rules.ts` · Types and options: `packages/shared/src/games/conquer.ts` · Tests: `rules.test.ts`, `conquer.engine.test.ts`, plus API integration tests.

> **Status: playable beta.** Everything below is enforced by the server. The wildcard prediction mapping, blind prediction, base card under the deck and the 14/13 deal were confirmed by the project owner. The remaining open rules are named options with defaults, listed under [Rules awaiting confirmation](#rules-awaiting-confirmation).

This specification replaces the earlier 40-card Conquian draft. That draft was never implemented, so no logic was carried over.

## 1. Mode
- **1v1** (default) or **4 players** (owner-requested, room option `config.players: 4`, chosen in the lobby). See *4-player tables and ዶቤ* below.
- 1v1: a **54-card** deck: the standard 52 plus **two printed (false) jokers** (owner-confirmed). The **starter gets 14 cards, the predictor 13**; the starter opens the game by discarding. **41-point** opening.

## 2. Card values and Aces
| Card | Value |
|---|---|
| 2–10 | Face value |
| J, Q, K | 10 |
| Ace in a set, or at the top of a run (Q-K-A) | 11 |
| Ace at the bottom of a run (A-2-3) | 1 |

An Ace's value always comes from its **role in the meld** being validated; it never has a single global value. Run order is A-2-3-…-10-J-Q-K, with the Ace allowed low or high (`runs.aceHigh`). **No wrap-around**: K-A-2 is never a run.

**Ambiguity.** When a meld can be read more than one way (a wildcard that could extend a run at either end, or wildcards that could sit in different slots), **the player chooses** what each joker stands for (the table shows every option, e.g. 5♥ 6♥ + joker as 4♥ or 7♥; 9♠ 9♥ + joker as 9♦ or 9♣; a joker laid off at either end of a run). The choice is sent as `as`. Without a choice, the server picks the **highest-scoring valid reading**. Example from play: with 6s and 4s wild, `6♠ 7♠ 8♠ 10♠ 4♦` is read as 7-8-[6♠=9♠]-10-[4♦=J♠] = 44, not 6-7-8-[4♦=9♠]-10 = 40. Tests cover A-2-3 (6), Q-K-A (31), A-K-wild → Q-K-A, and the K-A-2 rejection.

## 3. Pre-game wildcard prediction (blind)
1. The deck is shuffled with `crypto.randomInt` and one **regular** card (never a printed joker) is drawn at random as the **base card** (the joker indicator).
2. The **predictor** chooses **ላይ እና ታች** (Up & Down), **ላይ** (Up), **ታች** (Down) or **ጎን** (Side) **without seeing the base card**. Nobody sees it until the choice is made.
3. The wildcards ("jokers") are computed from the base card and the choice, and are recorded in the event log.
4. The starter (non-predictor) is dealt **14** cards and the predictor **13**, alternating, from the other 53 cards.
5. The base card is placed **face-up at the bottom of the deck**, peeking out so both players can see what set the jokers. It is drawn last, like any other deck card.
6. The remaining 26 cards plus the base card form the deck (**27**). The discard pile starts **empty**.
7. The starter takes the first turn: they may meld or open, and must **discard** (no draw on this opening turn).

**Predictor rule:** chosen by the server's RNG for round 1, then **alternating** every rematch round.

### Joker mapping (confirmed by the owner; `rules.prediction.mapping`, implemented in `selectWildcards()`)
| Choice | Jokers | Example, base 5♣ |
|---|---|---|
| ላይ Up | One rank up, both suits of the base card's **colour** | 6♣ 6♠ |
| ታች Down | One rank down, both suits of the base card's colour | 4♣ 4♠ |
| ጎን Side | Same rank, both suits of the **opposite colour** | 5♦ 5♥ |
| ላይ እና ታች Up & Down | One rank up and one down, **same suit** | 6♣ 4♣ |

Boundaries (`prediction.boundary`, still unconfirmed): by default ranks **wrap** (K Up → A, A Down → K). With `clamp`, a step past the edge falls back to the base rank.
## 4. Wildcards
- The **jokers** are the cards selected by the prediction. A joker substitutes for **any rank and suit** that makes the meld valid; a joker that fits a meld as itself counts as a natural card there.
- **False (printed) jokers are not jokers** (owner-confirmed): each is a copy of one of this round's chosen joker cards and can only be played *as that card*. Example: base 5♦ + Up → the jokers are 6♦ and 6♥, so a false joker can only be 6♦ or 6♥ (e.g. in 5♦-6♦-7♦ or a set of 6s). It counts as a natural card, never substitutes for anything else, and never shares a meld with the real card it copies. On the table it shows the card it copies with a violet tint.
- **At most one joker per meld** (owner-confirmed, `wild.maxPerMeld: 1`): two jokers can never be used in the same set or run, but different melds may each have one. Every meld also needs at least 2 natural cards.
- A false joker left in hand scores as the highest card it may copy.
- **Opening value:** a substituting wildcard counts the value of the card it represents (`wild.openingValue: 'represented'`; a fixed number is supported).
- **Identity is fixed when laid down.** Lay-offs never re-interpret cards already on the table. Each meld stores `{ card, as }` for every card, which is how identities survive rearrangements.
- **A joker may stand for a card that is already on the table** (owner-confirmed, `wild.uniqueIdentities: false`). Example: the joker can be the 10♥ in 8♥ 9♥ [10♥] even though the real 10♥ is already melded. With `uniqueIdentities: true`, the old check applies: a wildcard cannot represent a card already represented on the table, and a natural card whose identity a wildcard already represents cannot be laid down ("swap it instead"). Games saved before the option existed keep that check.
- **Swap** (`wild.allowSwap`): an opened player may give the natural card a table wildcard represents and take that wildcard into hand. The swap is atomic. The wildcard must be melded or laid off **before that turn's discard** (`wild.swappedMustBeUsedSameTurn`).

## 5. Melds
- **Set:** 3–4 cards of one rank, all suits distinct, laid out in ♥ ♣ ♦ ♠ order with red and black alternating wherever the suits allow (♥ ♠ ♦, ♣ ♥ ♠; owner-confirmed).
- **Run:** 3 or more consecutive cards of one suit (A low or high; no wrap).
- Every proposed meld is validated on the server (`interpretMeld`, `extendMeld`). Claimed point totals from clients are ignored.

## 6. Going in (41 points)
- A player who has not gone in ("opened") lays down sets and runs **one at a time or together**; within one turn their values add up toward **41**. Only cards in those melds count.
- Reaching 41 means the player is in for the rest of the round. After that, melds of any value are allowed, and they may add cards to melds on the table (**"Open"** — lay-offs; `layoffRequiresOpen`, on either player's melds via `layoffOnOpponentMelds`).
- If melds were laid down this turn but the total is still under 41, **the player cannot discard**; when the timer runs out they lose the round.
## 7. Turn sequence
The starter's first turn skips the draw (14 cards, discard to start). Every other turn:

1. **Draw** — exactly one of:
   - `drawStock`: take the top stock card.
   - `takeDiscard`: take the top discard into hand (owner-confirmed). **Before going in**, this commits the player to reach 41 this turn using any of their cards — the picked-up card does not have to be part of the melds. Until they reach 41 they cannot discard, and running out of time loses the round. **After going in**, the discard can be taken freely with no obligation. The card underneath becomes the visible top of the pile.
   - `takeBase`: take the face-up **base card** from under the deck (after an "Are you sure you want to draw the base card?" confirmation). The player must then **go out this turn** — meld everything and discard the last card — or they lose when time runs out.
2. **Meld** (optional, repeatable): `meld`, `layoff`, `swapWild`.
3. **Discard** one card from hand. This ends the turn and the opponent is notified.
   - A **real joker** (a predicted wildcard; printed false jokers are not real jokers) and an **open card** (one that would fit a meld already on the table) **cannot be discarded** (owner-confirmed). They can only be melded, used to fill a meld, or kept. If every card in hand is protected, any card may be discarded; the last card when going out is never blocked. The view lists the blocked cards in `undiscardable`.
   - **Filling a meld commits you to going out** (owner-confirmed): after laying a card off on any table meld, the player must go out that same turn. They cannot discard to pass the turn, and they lose the round when the timer runs out (`mustFinishReason: 'fill'`).

The server rejects out-of-turn actions, a second draw, discards before drawing, cards not held, and a discard while a swapped wildcard is unused. Duplicate requests (same `clientActionId`) are applied once. Concurrent conflicting requests are serialised by a database row lock: exactly one wins and the other gets `WRONG_PHASE`.

## 8. Card accounting
The server tracks each player's hand, every table meld (with who contributed each card), the stock, the discard pile, the set-aside base card (prediction phase only) and the active wildcards. Tests assert after **every action** in simulated matches that these locations hold exactly the 54 physical cards, with none missing or duplicated.

**Card count:** the starter holds 14 for the opening discard. After that, at the end of every completed turn each player's **hand + the table cards they contributed = 13** (+1 drawn, −1 discarded; melding only moves cards to the table, and a swap keeps the table slot with its original owner). Simulations assert this before every draw.

## 9. Winning and stock exhaustion
- **Going out:** meld everything except one card, then discard it to leave an empty hand. Melds may never empty the hand (`mustDiscardToWin`), so a final discard is always required. The round ends immediately.
- **Deck runs out** (confirmed by the owner, `exhaustion: 'reshuffle'`): the last deck card may be drawn. When the deck is empty at the end of a turn, the discard pile **except its top card** is shuffled (`crypto.randomInt`) and becomes the new deck; play continues. The base card is no longer shown once it has been drawn or reshuffled.
- Alternative options kept for configuration: `'lowerPenaltyWins'` (reveal hands, lower penalty wins, equal is a draw; Ace = 11, joker in hand = natural value) and `'dead'` (exhausted round is a draw).
- **Penalties** are still computed for the `lowerPenaltyWins` option, but the round result no longer shows them (owner request).

## 4-player tables and ዶቤ
- **Two decks, 108 cards** (four printed jokers). Second-deck cards carry a `2` suffix (`Th2`, `X3`, `X4`) so each physical card is unique; rank and suit are still the first two characters (`cardIdentity`). Melds, joker identities, swaps and the on-table checks compare identities, so `Th` and `Th2` are the same card. A set still needs different suits.
- **Every player for themselves.** Both copies of each chosen joker card are jokers. The starter is the seat after the predictor and gets 14 cards; the others get 13. Turns go round the table, and the predictor moves one seat each round.
- All the 1v1 rules apply (41 to go in, pick-ups, protected discards, filling means finishing, base card, reshuffle).
- **Out of the round:** a timeout (after the grace popup), giving up or leaving takes only that player out of the round. Their hand goes under the deck, their melds stay, and the others play on. The last player in wins, as does the first to go out. A predictor who drops out passes the prediction on.
- **Seats:** a 4-seat table **starts with 2, 3 or 4 players** (owner-confirmed): as soon as everyone seated is ready (`playerLimits` = 2–4). It always uses both decks and the 4-seat rules (out of the round, ዶቤ). The deal is the same: the starter gets 14 and the others 13.
- **Stakes:** the winner takes every player's stake. Rematch needs everyone who started; if someone left, the table closes after the round.
- **ጆከር ለመሬት** also works at 4-player tables: each loser's held stake goes to the winner on a joker finish.

### ዶቤ (4-player option `config.dobe`, not together with ጆከር ለመሬት)
- A **whole hand** of **five pairs of identical cards** (same rank and suit, e.g. 2♥ 2♥) plus **one three-card meld** and one card to discard is laid down **at once** with the ዶቤ button (`{ type: 'dobe', discard }`).
- The **41 rule does not apply**: it works from an unopened hand, straight after drawing.
- A **real joker can stand in for one card of a pair** (never both; two copies of the same joker card are a natural pair). A false joker counts as a card it may copy.
- The winner **wins double**: everyone needed twice the stake, held for the round, and each loser's held stake goes to the winner. The result lists the pairs and the set (`roundResult.dobe`). The server finds the split (`findDobe`). The table only shows the ዶቤ button when the hand is one, and asks which card to discard if more than one works.
- **Table:** the three opponents sit in a row at the top, each with name, card count (or *out*) and a narrow fan of their melds and hidden cards. The player on turn is ringed; chips show *ጆከር ለመሬት ×2* or *ዶቤ ×2*.

## 10. Rounds, rematches and points
- An optional stake per player per round (room stake) is debited at the start of each round. The round winner receives both stakes; a draw refunds both. Ledger keys `match:<id>:r<n>:stake|payout|refund:<player>` make settlement idempotent.
- **ጆከር ለመሬት** (joker to the ground; owner-requested room option `config.jokerToGround`, a toggle in the lobby next to the create buttons):
  - Every player needs **twice the stake** to create, join or quick-play the table, and again for every rematch round (`conquerRequiredBalance`). A 50-point table needs 100.
  - At the start of every round each player puts in the stake **and a second, held stake** (`r<n>:stake` and `r<n>:hold`). The held stake is off their balance for the whole round, so it **cannot be spent in another game** (owner-confirmed).
  - The rules are otherwise the same. When a player goes out and their **last discarded card is a real joker** (a predicted wildcard; a printed false joker does not count, owner-confirmed), they win **double the stake**. They get the normal payout (both stakes), their own held stake back, and the loser's held stake (`r<n>:joker:<winner>`).
  - On any other ending (a normal finish, timeout, giving up, leaving or a draw), both held stakes are returned (`r<n>:release:<player>`). An admin void refunds them too, as it refunds each player's net for the match.
  - The round result has `jokerFinish: true` and `won` (points gained from the loser).
  - Quick play only matches tables with the same setting. Open tables show a ጆከር ለመሬት badge, and the table shows *ጆከር ለመሬት ×2* under the deck.
- After a round both players may choose **Rematch**; the predictor alternates. With no agreement within 60 s, or if a player leaves, the match closes.
- Match result: ranked by rounds won. Equal rounds is a draw, unless someone left (they lose).

## 11. Timeouts and disconnection
- **Running out of time loses the round** (confirmed by the owner, `timeoutLoses`): prediction 30 s, turn **60 s**, then a **30 s grace period** (`graceSeconds`): a "time is up · ጊዜዎ አልቋል" popup counts down and the player can return and finish the turn. The round is lost only when the grace runs out too (`turnDeadline`; the popup starts at `graceAt`). The opponent wins the round and its stakes; a rematch is still offered.
- **Give up** (`giveUp`, owner-requested): the time-up popup also has a *ተሸንፌያለሁ · Give up this round* button. The opponent wins the round straight away (reason `gaveUp`), and unlike leaving the table, the rematch is still offered.
- Leaving mid-round forfeits the round to the opponent and ends the match.
- (With `timeoutLoses: false` the server would instead auto-play timed-out turns and forfeit after `maxMissedTurns`.)
- Disconnected players keep their seat. The opponent sees an online/offline badge, and on reconnect the client re-subscribes and receives its private state. All state lives in PostgreSQL, and an integration test restarts the API mid-turn and continues the round.

## 12. Privacy
Each player receives only their own hand. Opponent hand sizes, the deck count and the discard top are public. The deck order and opponent cards are never sent; hands are revealed only at round end for scoring. The base card is hidden from everyone until the prediction, then shown under the deck.

## 13. Table controls
- Tap the **deck** to draw, the **discard** to take it into your hand (it glows gold), or the **base card** peeking under the deck (rank and suit visible) to take it after confirming.
- Progress toward 41 is shown as a pill (e.g. `ከመሬት ካርታ ወስደዋል — 30/41`).
- Table melds show each card's rank and suit. A joker keeps its own face (gold paper, ★) and a false joker its JOKER face, with a tag **above the card** naming the card it stands for, so you can see what to swap.
- **ውረድ** (Meld): select cards and press it; the app splits the selection into sets and runs (asking which card a joker stands for when there is a choice).
- **ጨምር** (Open): enabled only when the one selected card can be added to a meld on the table; only the melds it fits light up.
- **ጆከር መተካት** (swap joker): select the natural card a table joker stands for.
- **ጣል** (discard): select one card.
- **Animations:** both players see the deck shuffled and dealt when the prediction ends; the round winner (and the match winner) sees cards falling from the sky.
- Hand order: a new deal is sorted by suit and drawn cards go on the right; nothing reorders automatically.
- **ደርድር** (best order): rearranges the hand with the best melds first, jokers placed in the gaps they fill, then **near-melds**: run fragments (same suit, one or two apart) and same-rank pairs. Single cards come next, by suit and rank, with leftover jokers last (`arrangeHand()` / `nearMelds()`).
- **Cards** are drawn as realistic SVG faces (`card-face.tsx`): corner indices, traditional pips, framed court cards, a printed joker and a lattice back. Faces are kept flat and simple: a corner index and one large suit (or the court letter).
- **Deal animation:** after the prediction the cards slide off the table's deck one at a time, alternating from the starter. Each card appears in its player's fan as it lands.
- **Layout:** the hand, timer and buttons never scroll; card size follows the screen height and the buttons sit in one row. Only the table middle (deck and your melds) scrolls if it must.
- The **deck** is drawn as a 3D stack that thins as it empties. The opponent's name sits above their fan.
- The **opponent's melds** are shown face-up at the front of their fan at the top. Tap one (it glows green) to add the selected card to it.
- The **discard pile** shows the last four discards tossed at angles, with the top card the most visible.
- **ጣል** is disabled for a protected card (joker or open card), with a hint explaining why.

## In-app rules
Players read the rules in the game lobby (*How to play*, `conquer-rules.tsx`); the table itself stays uncluttered. Conquer is no longer marked Beta.

## Rules awaiting confirmation
| Option | Default | Question to confirm |
|---|---|---|
| `prediction.boundary` | Wrap K↔A | What happens at K (Up) and A (Down)? |
| False-joker penalty | Value of the card it copies | Penalty for a false joker left in hand? |
| `wild.openingValue` | Value represented | Do wildcards count toward 41, and at what value? |
| `wild.allowSwap` / `swappedMustBeUsedSameTurn` | Allowed / yes | Can a natural replace a table wildcard, and must the wildcard be used at once? |
| `wild.penalty` | Natural value | Penalty for a wildcard left in hand? |
| `runs.aceHigh` | Allowed (Q-K-A) | Is Q-K-A legal? |
| `layoffOnOpponentMelds` | Allowed | May you lay off on the opponent's melds? |
| `mustDiscardToWin` | Yes | Must the last card be discarded, or can you go out by melding? |

Changing an answer means editing `DEFAULT_CONQUER_RULES` (and `CONQUER_UNVERIFIED_RULES`) in `packages/shared/src/games/conquer.ts`; the rules module and engine read only these options. Rooms cannot override rules.

## Data representation
`matches.state` (jsonb) holds the full engine state: hands, stock order, discard pile, melds with `{card, as, wild, points, pos, ownerId}`, the wildcards, base card, prediction, round history and deadline. `match_events` logs every prediction, draw, meld, swap, discard and round result. `ledger_entries` holds stakes and payouts per round.
