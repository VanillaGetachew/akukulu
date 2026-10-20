# Ethiopian Conquer (ካርታ ኮንከር) — implemented rules

Engine: `packages/engines/src/conquer/conquer.engine.ts` · Rules module: `packages/engines/src/conquer/rules.ts` · Types and options: `packages/shared/src/games/conquer.ts` · Tests: `rules.test.ts`, `conquer.engine.test.ts`, plus API integration tests.

> **Status: playable beta.** Everything below is enforced by the server. The wildcard prediction mapping, blind prediction, base card under the deck and the 14/13 deal were confirmed by the project owner. The remaining open rules are named options with defaults, listed under [Rules awaiting confirmation](#rules-awaiting-confirmation).

This specification replaces the earlier 40-card Conquian draft. That draft was never implemented, so no logic was carried over.

## 1. Mode
- Strictly **1v1**: two human players.
- A **54-card** deck: the standard 52 plus **two printed jokers** (owner-confirmed), which are always wild. The **starter gets 14 cards, the predictor 13**; the starter opens the game by discarding. **41-point** opening.

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
- Jokers are the cards selected by the prediction **plus the two printed jokers**. A joker substitutes for **any rank and suit** that makes the meld valid. A predicted joker that fits a meld as itself counts as a natural card there.
- **At most one joker per meld** (owner-confirmed, `wild.maxPerMeld: 1`): two jokers can never be used in the same set or run, but different melds may each have one. Every meld also needs at least 2 natural cards.
- A printed joker left in hand at the end of a round scores `wild.printedJokerPenalty` (20, unconfirmed).
- **Opening value:** a substituting wildcard counts the value of the card it represents (`wild.openingValue: 'represented'`; a fixed number is supported).
- **Identity is fixed when laid down.** Lay-offs never re-interpret cards already on the table. Each meld stores `{ card, as }` for every card, which is how identities survive rearrangements.
- **No duplicate identities.** A wildcard cannot represent a card that is already represented on the table. A player cannot lay down or lay off a natural card whose identity a wildcard already represents; the server answers "swap it instead".
- **Swap** (`wild.allowSwap`): an opened player may give the natural card a table wildcard represents and take that wildcard into hand. The swap is atomic. The wildcard must be melded or laid off **before that turn's discard** (`wild.swappedMustBeUsedSameTurn`).

## 5. Melds
- **Set:** 3–4 cards of one rank, all suits distinct.
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
   - `takeBase`: take the face-up **base card** from under the deck (after an "Are you sure you want to draw the base card?" confirmation). The player must then **go out this turn** — meld everything and discard the last card — or they lose when time runs out.2. **Meld** (optional, repeatable): `meld`, `layoff`, `swapWild`.
3. **Discard** one card from hand. This ends the turn and the opponent is notified.

The server rejects out-of-turn actions, a second draw, discards before drawing, cards not held, and a discard while a swapped wildcard is unused. Duplicate requests (same `clientActionId`) are applied once. Concurrent conflicting requests are serialised by a database row lock: exactly one wins and the other gets `WRONG_PHASE`.

## 8. Card accounting
The server tracks each player's hand, every table meld (with who contributed each card), the stock, the discard pile, the set-aside base card (prediction phase only) and the active wildcards. Tests assert after **every action** in simulated matches that these locations hold exactly the 54 physical cards, with none missing or duplicated.

**Card count:** the starter holds 14 for the opening discard. After that, at the end of every completed turn each player's **hand + the table cards they contributed = 13** (+1 drawn, −1 discarded; melding only moves cards to the table, and a swap keeps the table slot with its original owner). Simulations assert this before every draw.

## 9. Winning and stock exhaustion
- **Going out:** meld everything except one card, then discard it to leave an empty hand. Melds may never empty the hand (`mustDiscardToWin`), so a final discard is always required. The round ends immediately.
- **Deck runs out** (confirmed by the owner, `exhaustion: 'reshuffle'`): the last deck card may be drawn. When the deck is empty at the end of a turn, the discard pile **except its top card** is shuffled (`crypto.randomInt`) and becomes the new deck; play continues. The base card is no longer shown once it has been drawn or reshuffled.
- Alternative options kept for configuration: `'lowerPenaltyWins'` (reveal hands, lower penalty wins, equal is a draw; Ace = 11, joker in hand = natural value) and `'dead'` (exhausted round is a draw).
- **Penalties** are still computed and shown for every round result.

## 10. Rounds, rematches and points
- An optional stake per player per round (room stake) is debited at the start of each round. The round winner receives both stakes; a draw refunds both. Ledger keys `match:<id>:r<n>:stake|payout|refund:<player>` make settlement idempotent.
- After a round both players may choose **Rematch**; the predictor alternates. With no agreement within 60 s, or if a player leaves, the match closes.
- Match result: ranked by rounds won. Equal rounds is a draw, unless someone left (they lose).

## 11. Timeouts and disconnection
- **Running out of time loses the round** (confirmed by the owner, `timeoutLoses`): prediction 30 s, turn 60 s. The opponent wins the round and its stakes; a rematch is still offered.
- Leaving mid-round forfeits the round to the opponent and ends the match.
- (With `timeoutLoses: false` the server would instead auto-play timed-out turns and forfeit after `maxMissedTurns`.)
- Disconnected players keep their seat. The opponent sees an online/offline badge, and on reconnect the client re-subscribes and receives its private state. All state lives in PostgreSQL, and an integration test restarts the API mid-turn and continues the round.

## 12. Privacy
Each player receives only their own hand. Opponent hand sizes, the deck count and the discard top are public. The deck order and opponent cards are never sent; hands are revealed only at round end for scoring. The base card is hidden from everyone until the prediction, then shown under the deck.

## 13. Table controls
- Tap the **deck** to draw, the **discard** to take it into your hand (it glows gold), or the **base card** peeking under the deck (rank and suit visible) to take it after confirming.
- Progress toward 41 is shown as a pill (e.g. `ከመሬት ካርታ ወስደዋል — 30/41`).
- Table melds show each card's rank and suit; a joker shows the card it stands for in gold, so you can see what to swap.
- **ገቢ** (Meld): select cards and press it; the app splits the selection into sets and runs (asking which card a joker stands for when there is a choice).
- **ጨምር** (Open): select one card to add it to the meld on the table it fits (or tap the meld directly).
- **ጆከር መተካት** (swap joker): select the natural card a table joker stands for.
- **ጣል** (discard): select one card.
- **Animations:** both players see the deck shuffled and dealt when the prediction ends; the round winner (and the match winner) sees cards falling from the sky.
- Hand order: a new deal is sorted by suit and drawn cards go on the right; nothing reorders automatically.
- **ደርድር** (best order): rearranges the hand with the best melds first, jokers placed in the gaps they fill, then the rest by suit and rank (`arrangeHand()`).

## Rules awaiting confirmation
| Option | Default | Question to confirm |
|---|---|---|
| `prediction.boundary` | Wrap K↔A | What happens at K (Up) and A (Down)? |
| `wild.printedJokerPenalty` | 20 | Penalty for a printed joker left in hand? |
| `wild.openingValue` | Value represented | Do wildcards count toward 41, and at what value? |
| `wild.allowSwap` / `swappedMustBeUsedSameTurn` | Allowed / yes | Can a natural replace a table wildcard, and must the wildcard be used at once? |
| `wild.penalty` | Natural value | Penalty for a wildcard left in hand? |
| `runs.aceHigh` | Allowed (Q-K-A) | Is Q-K-A legal? |
| `layoffOnOpponentMelds` | Allowed | May you lay off on the opponent's melds? |
| `mustDiscardToWin` | Yes | Must the last card be discarded, or can you go out by melding? |

Changing an answer means editing `DEFAULT_CONQUER_RULES` (and `CONQUER_UNVERIFIED_RULES`) in `packages/shared/src/games/conquer.ts`; the rules module and engine read only these options. Rooms cannot override rules.

## Data representation
`matches.state` (jsonb) holds the full engine state: hands, stock order, discard pile, melds with `{card, as, wild, points, pos, ownerId}`, the wildcards, base card, prediction, round history and deadline. `match_events` logs every prediction, draw, meld, swap, discard and round result. `ledger_entries` holds stakes and payouts per round.
