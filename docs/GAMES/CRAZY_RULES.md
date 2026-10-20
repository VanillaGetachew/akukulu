# Crazy (ክሬዚ · Crazy Eights) — implemented rules

Crazy is the classic shedding game Crazy Eights, with the stacking draw-two that is the most common house addition. Sources used: [Bicycle Cards](https://bicyclecards.com/how-to-play/crazy-eights), [Wikipedia](https://en.wikipedia.org/wiki/Crazy_Eights) and common house-rule summaries. The engine is `packages/engines/src/crazy/crazy.engine.ts` and the types are in `packages/shared/src/games/crazy.ts`. Every house rule is a configurable option (`CrazyRules`).

## 1. Players and deal
- **2–5 players**, one standard 52-card deck (no jokers).
- **7 cards each** with 2 players and **5 each** with 3 or more (`handSizeTwoPlayers`, `handSizeMorePlayers`), dealt one at a time.
- The next card is turned face-up to start the pile. **An 8 is buried** back at a random place in the deck and another card is turned. Any other starter, a 2 included, has no special effect.
- The first player is chosen at random, and play goes around in seat order.

## 2. A turn
1. **Play** one card that matches the top card's **suit** (or the suit named with an 8) or its **rank**.
2. Or **draw** from the deck. A drawn card that fits may be played straight away. A player may draw even when holding a playable card.
3. Up to **3 draws per turn** (`maxDraws`; 0 means draw until you can play). After that the player may **pass**.
4. When the deck is empty, the pile **except its top card** is shuffled into a new deck (`crypto.randomInt`). If there is nothing left to draw at all, the player may pass at once.

## 3. Special cards
| Card | Effect | Option |
|---|---|---|
| 8 | Wild: can be played on anything. The player names the next suit, and the next player must follow it or play another 8. | `eightsWild` |
| 2 | Draw two: the next player draws 2 and loses their turn. | `drawTwo` |
| 2 on a 2 | Stacking: a player facing a draw-two may answer with any 2, and the penalty grows by 2 (4, 6, 8). While a penalty is pending, only a 2 can be played. Drawing takes the whole penalty and ends the turn. | `stackDrawTwo` |

## 4. Winning and points
- The game ends the moment a player plays their **last card** (an 8 may be the last card). The winner takes the **pot** (every player's entry stake).
- **Blocked game:** if nothing is left to draw and every active player passes in a row, the **lowest hand** wins.
- Cards left in hand score **8 = 50, K Q J 10 = 10, A = 1, others face value**. They rank the remaining players (placements) and decide a blocked game. Ties go to the lower seat.

## 5. Timeouts and leaving
- **30 s per turn** (`turnSeconds`). When time runs out the server plays for the player:
  1. It takes a pending penalty, or answers it with a 2.
  2. Otherwise it plays a card, shedding the highest-scoring card first and keeping 8s for last, with an 8 naming the suit the player holds most.
  3. Otherwise it draws until a card fits or the draw limit is reached, then passes.
- **3 timeouts in a row** (`maxMissedTurns`) forfeit the game. Leaving forfeits too. A forfeited hand goes under the deck. When only one player is left, they win the pot.

## 6. Privacy and integrity
- Each player receives only their own hand. Others see hand sizes, the last four discards, the deck count, the suit to follow and any pending draw. All hands are revealed only when the game ends.
- Every play is validated on the server, and the client's list of legal cards is only a hint. Tests check that after every action the hands, deck and pile hold exactly the 52 cards. The tests include 300 simulated 2–5 player games, and an integration test plays a full 3-player game over Socket.IO with one payout.

## 7. Table
- Opponents sit along the top in turn order, with name, card count and a small fan of backs. The current player is ringed in green. At the end each opponent's cards are shown face-up with their points.
- The middle shows the 3D deck (tap to draw), the tossed pile, a **+N** badge for a pending draw-two, and a **Follow ♥ or 7** chip. The chip turns gold with *Suit changed to ♠* after an 8.
- Your hand fans across the bottom, and cards you cannot play are dimmed on your turn. Tap a card to lift it, then tap it again (or press **ጣል**) to play it. An 8 opens the suit chooser.
- Buttons: **ጣል** play, **ውሰድ** draw (shows *draw 4* when 2s are pending), **እለፍ** pass, **ደርድር** sort.
- The deal animation reveals each card as it lands. Card faces, the deck and the pile are shared with Conquer (`card-face.tsx`, `card-table.tsx`).

## Not implemented (possible options later)
- A multi-round score race (first to 100 points). Each table plays one game, and players use *Play again* for the next one.
- Other house cards (A = skip, Q = reverse, J = draw), "last card" calls, and drawing until you can play by default.
