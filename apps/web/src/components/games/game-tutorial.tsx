'use client';

import { useEffect, useState } from 'react';
import type { GameSlug } from '@akukulu/shared';

interface Step {
  icon: string;
  title: string;
  body: string;
}

const SHARED_TABLES: Step = {
  icon: '🪑',
  title: 'Join or start a table',
  body: 'Open tables are at the top: tap Join to sit down with players already waiting. Or pick a stake and tap Quick play. A table starts when it is full, or after one minute if enough players have joined. If not, it closes and you pay nothing.',
};

const STAKE_NOTE = 'Choose Free to practise for nothing. With a stake, the winner takes the pot less a small house fee, shown in your Wallet.';

const STEPS: Record<GameSlug, Step[]> = {
  ludo: [
    { icon: '🎲', title: 'Welcome to Ludo', body: 'Race your four tokens around the board and bring them all home before anyone else does. 2 to 4 players.' },
    SHARED_TABLES,
    { icon: '💰', title: 'Stakes', body: STAKE_NOTE },
    { icon: '6️⃣', title: 'Get on the board', body: 'Tap the die on your turn. You need a 6 to bring a token out. Then tap the token you want to move.' },
    { icon: '💥', title: 'Capture', body: 'Land on an opponent to send them back home, except on star and start squares. A 6, a capture or reaching home gives you another roll, but three 6s in a row ends your turn.' },
    { icon: '🏁', title: 'Finish', body: 'You need the exact number to bring a token home. The first player with all four home wins.' },
  ],
  poker: [
    { icon: '♠️', title: "Welcome to Poker", body: 'Make the best five-card hand, or get everyone else to fold. Real money only, so learn the buttons before you sit down.' },
    { icon: '🗂️', title: 'Three ways to play', body: 'Cash games are always open: sit down and stand up when you like. Sit & Go starts as soon as a small table is ready. Tournaments run on a schedule with bigger prize pools.' },
    { icon: '🃏', title: 'The hand', body: "You get two private cards, and five shared cards are dealt in stages. Use the best five. In Omaha tournaments you get four cards and must use exactly two of them." },
    { icon: '👆', title: 'Your turn', body: 'Fold to give up, Check to pass, Call to match a bet, or Raise to bet more. Before your turn you can tick Fold, Check / Fold or Call any, and it plays for you once.' },
    { icon: '💰', title: 'Chips and fees', body: 'Cash games take 5% of each pot, up to a limit. Nothing is taken if the hand ends before the flop. Stand up from the menu to return your chips to your balance.' },
  ],
  blackjack: [
    { icon: '🂡', title: 'Welcome to Blackjack', body: 'Beat the dealer by getting closer to 21 without going over. Number cards are worth their number, J Q K are 10, and an Ace is 1 or 11.' },
    { icon: '👆', title: 'Your turn', body: 'Hit to take a card, Stand to stop. Double doubles your bet for exactly one more card. Split turns a pair into two hands.' },
    { icon: '🏆', title: 'Winning', body: 'Blackjack, an Ace with a 10-value card, pays 3 to 2. The dealer stands on 17.' },
  ],
  conquer: [
    { icon: '🃏', title: 'Welcome to Conquer', body: 'Win the round by laying down all your cards in melds and discarding your last one. Play 1 v 1, or up to 4 players with two decks.' },
    SHARED_TABLES,
    { icon: '💰', title: 'Stakes', body: 'Choose Free to practise for nothing. With a stake, everyone pays each round and the round winner takes the pot less a small house fee.' },
    { icon: '★', title: 'Choosing the jokers', body: 'Before the deal one player calls ላይ, ታች, ጎን or ላይና ታች. The base card is then turned over, and that call decides which cards are this round’s jokers.' },
    { icon: '🧩', title: 'Melds', body: 'A set is 3 or 4 cards of the same rank in different suits. A run is 3 or more in a row of one suit. Each meld can use only one joker.' },
    { icon: '4️⃣', title: 'Go in with 41', body: 'To go in, lay down melds worth 41 points or more in one turn. After that you can lay down any melds and add cards to melds on the table.' },
    { icon: '👆', title: 'Each turn', body: 'Draw from the deck or take the top discard, meld if you can, then discard one card. ውረድ lays down, ጨምር adds to a meld, ጣል discards, and ደርድር sorts your hand.' },
  ],
  crazy: [
    { icon: '🎴', title: 'Welcome to Crazy', body: 'Be the first to get rid of all your cards. 2 to 5 players with one deck.' },
    SHARED_TABLES,
    { icon: '💰', title: 'Stakes', body: STAKE_NOTE },
    { icon: '👆', title: 'Your turn', body: 'Play a card that matches the top card by suit or by rank. If you cannot, or would rather not, tap the deck to draw one.' },
    { icon: '★', title: 'Wild cards', body: '8 and J are wild: play one on anything and choose the next suit.' },
    { icon: '⚡', title: 'Special cards', body: '2 makes the next player pick up two, and A♠ makes them pick up five. 5 skips the next player. 7 lets you drop more cards of its suit in one go.' },
  ],
  penalty: [
    { icon: '⚽', title: 'Welcome to Penalty Shootout', body: 'One against one. You take turns shooting and saving, and whoever scores more wins.' },
    SHARED_TABLES,
    { icon: '💰', title: 'Stakes', body: STAKE_NOTE },
    { icon: '🎯', title: 'When you shoot', body: 'Tap Left, Middle or Right to pick where to aim. Your opponent cannot see your choice. If they dive the other way, it is a goal.' },
    { icon: '🧤', title: 'When you are in goal', body: 'Tap the side you think the shot is going. Pick the same side and you save it.' },
    { icon: '⏱️', title: 'Winning', body: 'Five kicks each, stopping early if someone cannot be caught. Level after five goes to sudden death. You have 15 seconds per pick, and missing three in a row loses the match.' },
  ],
  rps: [
    { icon: '✊', title: 'Welcome to Rock Paper Scissors', body: 'One against one. Rock beats scissors, scissors beats paper, and paper beats rock.' },
    SHARED_TABLES,
    { icon: '💰', title: 'Stakes', body: STAKE_NOTE },
    { icon: '🤫', title: 'Throw in secret', body: 'Tap Rock, Paper or Scissors. Your opponent cannot see your pick, and both hands are shown at the same moment.' },
    { icon: '🏆', title: 'First to 3', body: 'Win 3 rounds to win the match. A draw does not count, you just throw again. You have 10 seconds per throw, and missing three in a row loses the match.' },
  ],
  bingo: [
    { icon: '🎱', title: 'Welcome to Bingo', body: 'Classic 75-ball Bingo for 2 to 10 players. Everyone buys one card, and the first to complete a line takes the pot.' },
    SHARED_TABLES,
    { icon: '💰', title: 'Card price', body: STAKE_NOTE },
    { icon: '🔄', title: 'Your card', body: 'You get a card when the game starts. Before the first number is called you can change it up to 3 times.' },
    { icon: '🔔', title: 'Numbers are called', body: 'A new number comes out every 4 seconds. If it is on your card, it is marked for you. You do not need to tap anything.' },
    { icon: '🏆', title: 'Winning', body: 'Complete any row, column, diagonal or the four corners. The win is spotted automatically. If two players finish on the same number, they share the pot.' },
  ],
};

const key = (slug: GameSlug) => `akukulu.tutorial.v1.${slug}`;

/** False only when we know it hasn't been shown. If storage is blocked we don't nag on every visit. */
export function tutorialSeen(slug: GameSlug): boolean {
  try {
    return window.localStorage.getItem(key(slug)) !== null;
  } catch {
    return true;
  }
}

function markSeen(slug: GameSlug) {
  try {
    window.localStorage.setItem(key(slug), '1');
  } catch {
    /* storage unavailable */
  }
}

/** A step-by-step introduction to one game. */
export function GameTutorial({ slug, onClose }: { slug: GameSlug; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const steps = STEPS[slug];
  const step = steps[index];
  const last = index === steps.length - 1;

  // Counted as seen once opened, so closing the app part-way doesn't bring it back.
  useEffect(() => markSeen(slug), [slug]);

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div className="card grid w-full max-w-sm gap-3 border-gold/40 p-5">
        <div className="flex justify-center gap-1.5" aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <span key={s.title} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-gold' : 'w-1.5 bg-white/20'}`} />
          ))}
        </div>
        <div className="text-center text-4xl leading-none" aria-hidden>
          {step.icon}
        </div>
        <h2 id="tutorial-title" className="text-center font-display text-lg font-extrabold">
          {step.title}
        </h2>
        <p className="min-h-[96px] text-[15px] leading-relaxed text-muted">{step.body}</p>
        <div className="flex items-center justify-between gap-2">
          <button className="text-sm font-semibold text-muted underline underline-offset-4" onClick={onClose}>
            Skip
          </button>
          <div className="flex gap-2">
            {index > 0 && (
              <button className="btn-ghost btn-sm" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            <button className="btn-gold btn-sm" onClick={() => (last ? onClose() : setIndex(index + 1))}>
              {last ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
