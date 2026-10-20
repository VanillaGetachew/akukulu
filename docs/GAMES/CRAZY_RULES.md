# Crazy (ክሬዚ · Crazy Eights) — implemented rules

Crazy is the classic shedding game Crazy Eights with the Akukulu table rules (owner-confirmed): 8 and J are wild, 7 carries cards of its suit, 5 skips, and 2s are stacking draw-twos. Sources used: [Bicycle Cards](https://bicyclecards.com/how-to-play/crazy-eights), [Wikipedia](https://en.wikipedia.org/wiki/Crazy_Eights) and common house-rule summaries. The engine is `packages/engines/src/crazy/crazy.engine.ts` and the types are in `packages/shared/src/games/crazy.ts`. Every house rule is a configurable option (`CrazyRules`).

## 1. Players and deal
- **2–5 players**, one standard 52-card deck (no jokers).
- **7 cards each** with 2 players and **5 each** with 3 or more (`handSizeTwoPlayers`, `handSizeMorePlayers`), dealt one at a time.
- The next card is turned face-up to start the pile. **A wild card (8 or J) is buried** back at a random place in the deck and another card is turned. Any other starter, a 2, 5 or 7 included, has no special effect.
- The first player is chosen at random, and play goes around in seat order.

## 2. A turn
1. **Play** one card that matches the top card's **suit** (or the suit named with a wild card) or its **rank**. A 7 may carry more cards (see below).
2. Or **draw** by tapping the deck. A drawn card that fits may be played straight away. A player may draw even when holding a playable card.
3. After **one draw** the player may **pass** (`passAfterDraws: 1`, owner-confirmed). Up to **3 draws per turn** (`maxDraws`; 0 means draw until you can play).
4. When the deck is empty, the pile **except its top card** is shuffled into a new deck (`crypto.randomInt`). If there is nothing left to draw at all, the player may pass at once.

## 3. Special cards
| Card | Effect | Option |
|---|---|---|
| 8 and J | Wild: can be played on anything. The player names the next suit, and the next player must follow it or play another wild card. | `wildRanks: ['8', 'J']` |
| 7 | Carry: the 7 (played normally) may carry any number of other cards of **its own suit**, dropped together in the order chosen (`carry`). The last card dropped becomes the top card, and its effect applies: a wild names the suit, a 2 adds two to draw, a 5 skips. A 7 may carry the player's last cards to win. | `carryRank: '7'` |
| 5 | Skip: the next player loses their turn. With two players, the player who played the 5 goes again. | `skipRank: '5'` |
| 2 | Draw two: the next player draws 2 and loses their turn. | `drawTwo` |
| 2 on a 2 | Stacking: a player facing a draw-two may answer with any 2, and the penalty grows by 2 (4, 6, 8). While a penalty is pending, only a 2 can be played. Drawing takes the whole penalty and ends the turn. | `stackDrawTwo` |

## 4. Winning and points
- The game ends the moment a player plays their **last card** (a wild card, or a 7 carrying the rest, may be the last play). The winner takes the **pot** (every player's entry stake).
- **Blocked game:** if nothing is left to draw and every active player passes in a row, the **lowest hand** wins.
- Cards left in hand score **wild 8 / J = 50, K Q 10 = 10, A = 1, others face value**. They rank the remaining players (placements) and decide a blocked game. Ties go to the lower seat.

## 5. Timeouts and leaving
- **30 s per turn** (`turnSeconds`). When time runs out the server plays for the player:
  1. It takes a pending penalty, or answers it with a 2.
  2. Otherwise it plays one card (no carrying), shedding the highest-scoring card first and keeping wild cards for last; a wild card names the suit the player holds most.
  3. Otherwise it draws until a card fits or the draw limit is reached, then passes.
- **3 timeouts in a row** (`maxMissedTurns`) forfeit the game. Leaving forfeits too. A forfeited hand goes under the deck. When only one player is left, they win the pot.

## 6. Privacy and integrity
- Each player receives only their own hand. Others see hand sizes, the last four discards, the deck count, the suit to follow and any pending draw. All hands are revealed only when the game ends.
- Every play is validated on the server, and the client's list of legal cards is only a hint. Tests check that after every action the hands, deck and pile hold exactly the 52 cards. The tests include 300 simulated 2–5 player games, and an integration test plays a full 3-player game over Socket.IO with one payout.

## 7. Table
- Opponents sit along the top in turn order, with name, card count and a small fan of backs. The current player is ringed in green. At the end each opponent's cards are shown face-up with their points.
- The middle shows the 3D deck (tap to draw), the tossed pile, a **+N** badge for a pending draw-two, and a **Follow ♥ or 7** chip. The chip turns gold with *Suit changed to ♠* after an 8.
- Your hand fans across the bottom, and cards you cannot play are dimmed on your turn. Tap a card to lift it, then tap it again (or press **ጣል**) to play it. A wild card opens the suit chooser.
- With a playable 7 lifted, tapping cards of its suit adds them with a number showing the drop order. Tap one again to take it back.
- There is no draw button: **tap the deck** (it pulses, and *tap to draw* shows under it). A pending draw-two shows *ውሰድ 4* on the deck.
- Buttons: **ጣል** play (*play 3* for a carry), **እለፍ** pass, **ደርድር** sort.
- The deal animation reveals each card as it lands. Card faces, the deck and the pile are shared with Conquer (`card-face.tsx`, `card-table.tsx`).

## Not implemented (possible options later)
- A multi-round score race (first to 100 points). Each table plays one game, and players use *Play again* for the next one.
- Other house cards (A = skip, Q = reverse), "last card" calls, and drawing until you can play by default.
