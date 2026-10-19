# Ethiopian Conquer (ካርታ ኮንከር) — implemented rules

Engine: `packages/engines/src/conquer/conquer.engine.ts` · Rules module: `packages/engines/src/conquer/rules.ts` · Types and options: `packages/shared/src/games/conquer.ts` · Tests: `rules.test.ts`, `conquer.engine.test.ts`, plus API integration tests.

> **Status: playable beta.** Everything below is enforced by the server. The wildcard prediction mapping, blind prediction, base card under the deck and the 14/13 deal were confirmed by the project owner. The remaining open rules are named options with defaults, listed under [Rules awaiting confirmation](#rules-awaiting-confirmation).

This specification replaces the earlier 40-card Conquian draft. That draft was never implemented, so no logic was carried over.

## 1. Mode
- Strictly **1v1**: two human players.
- Standard **52-card** deck. The **starter gets 14 cards, the predictor 13**; the starter opens the game by discarding. **41-point** opening.

## 2. Card values and Aces
| Card | Value |
|---|---|
| 2–10 | Face value |
| J, Q, K | 10 |
| Ace in a set, or at the top of a run (Q-K-A) | 11 |
| Ace at the bottom of a run (A-2-3) | 1 |

An Ace's value always comes from its **role in the meld** being validated; it never has a single global value. Run order is A-2-3-…-10-J-Q-K, with the Ace allowed low or high (`runs.aceHigh`). **No wrap-around**: K-A-2 is never a run.

**Ambiguity.** When a meld can be read more than one way (a wildcard that could extend a run at either end, or wildcards that could sit in different slots), the client may pin each wildcard's identity with `as`. Without a pin, the server picks the **highest-scoring valid reading**. Example from play: with 6s and 4s wild, `6♠ 7♠ 8♠ 10♠ 4♦` is read as 7-8-[6♠=9♠]-10-[4♦=J♠] = 44, not 6-7-8-[4♦=9♠]-10 = 40. Tests cover A-2-3 (6), Q-K-A (31), A-K-wild → Q-K-A, and the K-A-2 rejection.

## 3. Pre-game wildcard prediction (blind)
1. The deck is shuffled with `crypto.randomInt` and one card is drawn at random as the **base card** (the joker indicator).
2. The **predictor** chooses **ላይ እና ታች** (Up & Down), **ላይ** (Up), **ታች** (Down) or **ጎን** (Side) **without seeing the base card**. Nobody sees it until the choice is made.
3. The wildcards ("jokers") are computed from the base card and the choice, and are recorded in the event log.
4. The starter (non-predictor) is dealt **14** cards and the predictor **13**, alternating, from the other 51 cards.
5. The base card is placed **face-up at the bottom of the deck**, peeking out so both players can see what set the jokers. It is drawn last, like any other deck card.
6. The remaining 24 cards plus the base card form the deck (**25**). The discard pile starts **empty**.
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
- A wildcard substitutes for **any rank and suit** that makes the meld valid. A wildcard that fits a meld as itself counts as a natural card there.
- Several wildcards may appear in one meld, but every meld needs at least **2 natural cards** (`wild.minNaturalPerMeld`).
- **Opening value:** a substituting wildcard counts the value of the card it represents (`wild.openingValue: 'represented'`; a fixed number is supported).
- **Identity is fixed when laid down.** Lay-offs never re-interpret cards already on the table. Each meld stores `{ card, as }` for every card, which is how identities survive rearrangements.
- **No duplicate identities.** A wildcard cannot represent a card that is already represented on the table. A player cannot lay down or lay off a natural card whose identity a wildcard already represents; the server answers "swap it instead".
- **Swap** (`wild.allowSwap`): an opened player may give the natural card a table wildcard represents and take that wildcard into hand. The swap is atomic. The wildcard must be melded or laid off **before that turn's discard** (`wild.swappedMustBeUsedSameTurn`).

## 5. Melds
- **Set:** 3–4 cards of one rank, all suits distinct.
- **Run:** 3 or more consecutive cards of one suit (A low or high; no wrap).
- Every proposed meld is validated on the server (`interpretMeld`, `extendMeld`). Claimed point totals from clients are ignored.

## 6. Opening (41 points)
- One action may lay down one or more melds. If the player has not opened, their combined value must be **≥ 41**. Only the cards in those melds count.
- Opening state is stored per player. After opening, melds of any value and lay-offs are allowed.
- Lay-offs require having opened (`layoffRequiresOpen`). Opened players may lay off on either player's melds (`layoffOnOpponentMelds`).

## 7. Turn sequence
The starter's first turn skips the draw (14 cards, discard to start). Every other turn:

1. **Draw** — exactly one of:
   - `drawStock`: take the top stock card.
   - `takeDiscard`: take the top discard **together with** melds and/or lay-offs that use it. The server validates the whole package before the card moves. A player who has not opened must use it in an opening of 41+. The card underneath then becomes the visible top of the pile.
2. **Meld** (optional, repeatable): `meld`, `layoff`, `swapWild`.
3. **Discard** one card from hand. This ends the turn and the opponent is notified.

The server rejects out-of-turn actions, a second draw, discards before drawing, cards not held, and a discard while a swapped wildcard is unused. Duplicate requests (same `clientActionId`) are applied once. Concurrent conflicting requests are serialised by a database row lock: exactly one wins and the other gets `WRONG_PHASE`.

## 8. Card accounting
The server tracks each player's hand, every table meld (with who contributed each card), the stock, the discard pile, the set-aside base card (prediction phase only) and the active wildcards. Tests assert after **every action** in simulated matches that these locations hold exactly the 52 physical cards, with none missing or duplicated.

**Card count:** the starter holds 14 for the opening discard. After that, at the end of every completed turn each player's **hand + the table cards they contributed = 13** (+1 drawn, −1 discarded; melding only moves cards to the table, and a swap keeps the table slot with its original owner). Simulations assert this before every draw.

## 9. Winning and stock exhaustion
- **Going out:** meld everything except one card, then discard it to leave an empty hand. Melds may never empty the hand (`mustDiscardToWin`), so a final discard is always required. The round ends immediately.
- **Stock exhaustion:** the last stock card may be drawn. If the stock is empty when a turn ends and nobody went out, the round ends (`exhaustion: 'lowerPenaltyWins'`):
  - Both hands are revealed and scored. Penalty values are as in section 2, with Ace = 11 (`acePenalty`) and a wildcard in hand = its natural value (`wild.penalty`).
  - The **lower penalty wins**; equal penalties are a **draw**. The `'dead'` option makes every exhausted round a draw.
- The discard pile is **never reshuffled**.

## 10. Rounds, rematches and points
- An optional stake per player per round (room stake) is debited at the start of each round. The round winner receives both stakes; a draw refunds both. Ledger keys `match:<id>:r<n>:stake|payout|refund:<player>` make settlement idempotent.
- After a round both players may choose **Rematch**; the predictor alternates. With no agreement within 60 s, or if a player leaves, the match closes.
- Match result: ranked by rounds won. Equal rounds is a draw, unless someone left (they lose).

## 11. Timeouts and disconnection
- Prediction: 30 s. On timeout the server predicts **Up** and counts a missed turn.
- Turn: 60 s. On timeout the server draws from the stock if needed and discards the highest-penalty non-wild card; any pending swap obligation is released. This counts as a missed turn.
- 3 consecutive missed turns, or leaving mid-round, forfeits the round to the opponent and ends the match.
- Disconnected players keep their seat. The opponent sees an online/offline badge, and on reconnect the client re-subscribes and receives its private state. All state lives in PostgreSQL, and an integration test restarts the API mid-turn and continues the round.

## 12. Privacy
Each player receives only their own hand. Opponent hand sizes, the deck count and the discard top are public. The deck order and opponent cards are never sent; hands are revealed only at round end for scoring. The base card is hidden from everyone until the prediction, then shown under the deck.

## 13. Table controls
- Tap the **deck** to draw. Tap the **discard** to take it, then select the hand cards that meld with it and press **ገቢ**, or tap a meld to lay it off there.
- **ገቢ** (meld / open): select cards and press it; the app splits the selection into sets and runs, and the server validates them (41+ to open).
- **ጆከር መተካት** (swap joker): select the natural card a table joker stands for.
- **ጣል** (discard): select one card.
- **ደርድር** (best order): rearranges the hand with the best melds first, jokers placed in the gaps they fill, then the rest by suit and rank (`arrangeHand()`).

## Rules awaiting confirmation
| Option | Default | Question to confirm |
|---|---|---|
| `prediction.boundary` | Wrap K↔A | What happens at K (Up) and A (Down)? |
| `wild.minNaturalPerMeld` | 2 | How many wildcards may a meld contain? |
| `wild.openingValue` | Value represented | Do wildcards count toward 41, and at what value? |
| `wild.allowSwap` / `swappedMustBeUsedSameTurn` | Allowed / yes | Can a natural replace a table wildcard, and must the wildcard be used at once? |
| `wild.penalty` | Natural value | Penalty for a wildcard left in hand? |
| `runs.aceHigh` | Allowed (Q-K-A) | Is Q-K-A legal? |
| `layoffOnOpponentMelds` | Allowed | May you lay off on the opponent's melds? |
| `mustDiscardToWin` | Yes | Must the last card be discarded, or can you go out by melding? |
| `exhaustion` | Lower penalty wins | Or is an exhausted round void? |

Changing an answer means editing `DEFAULT_CONQUER_RULES` (and `CONQUER_UNVERIFIED_RULES`) in `packages/shared/src/games/conquer.ts`; the rules module and engine read only these options. Rooms cannot override rules.

## Data representation
`matches.state` (jsonb) holds the full engine state: hands, stock order, discard pile, melds with `{card, as, wild, points, pos, ownerId}`, the wildcards, base card, prediction, round history and deadline. `match_events` logs every prediction, draw, meld, swap, discard and round result. `ledger_entries` holds stakes and payouts per round.
