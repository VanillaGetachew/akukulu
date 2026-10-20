import type { Card, Rank, Suit } from '../cards';

/** Pre-deal wildcard prediction choices. */
export const CONQUER_PREDICTIONS = ['up', 'down', 'side', 'upDown'] as const;
export type ConquerPrediction = (typeof CONQUER_PREDICTIONS)[number];

export const CONQUER_PREDICTION_LABEL: Record<ConquerPrediction, { en: string; am: string }> = {
  up: { en: 'Up', am: 'ላይ' },
  down: { en: 'Down', am: 'ታች' },
  side: { en: 'Side', am: 'ጎን' },
  upDown: { en: 'Up & Down', am: 'ላይ እና ታች' },
};

/**
 * Every rule that the supplied specification leaves open is a named option.
 * Defaults are documented in docs/GAMES/CONQUER_RULES.md and marked
 * "requires confirmation" until verified against the Ethiopian rules.
 */
/** Suits of the selected rank(s) that become wild, relative to the base card. */
export type ConquerWildSuits = 'sameSuit' | 'sameColor' | 'otherColor' | 'all';

export interface ConquerRules {
  /** Cards dealt to the starting player; the predictor receives one fewer and the starter opens by discarding. */
  handSize: number;
  openingThreshold: number;
  prediction: {
    /** For each choice: rank steps from the base card (A,2…10,J,Q,K order) and which suits become wild. */
    mapping: Record<ConquerPrediction, { steps: number[]; suits: ConquerWildSuits }>;
    /** A step past K or A: wrap around the rank cycle, or fall back to the base rank. */
    boundary: 'wrap' | 'clamp';
  };
  wild: {
    /** Minimum natural (non-substituting) cards in every meld. */
    minNaturalPerMeld: number;
    /** Maximum jokers substituting in one meld (owner-confirmed: two jokers never share a meld). */
    maxPerMeld: number;
    /** The deck includes the two printed jokers, which are always wild (54 cards). */
    printedJokers: boolean;
    /** Penalty for a printed joker left in hand. */
    printedJokerPenalty: number;
    /** Opening value of a substituting wildcard: the card it represents, or a fixed number. */
    openingValue: 'represented' | number;
    /** An opened player may give the natural card a wildcard represents and take the wildcard. */
    allowSwap: boolean;
    /** A wildcard taken by swap must be melded or laid off before the turn's discard. */
    swappedMustBeUsedSameTurn: boolean;
    /** Penalty for a wildcard left in hand: its natural value, or a fixed number. */
    penalty: 'natural' | number;
  };
  runs: {
    /** Ace may end a run high (Q-K-A). Ace-low (A-2-3) is always allowed. */
    aceHigh: boolean;
  };
  /** A taken discard goes to hand and must be melded or laid off before the player may discard. */
  discardPickup: 'mustMeldBeforeDiscard';
  /** Only opened players may lay off. */
  layoffRequiresOpen: boolean;
  /** Opened players may lay off onto the opponent's melds too. */
  layoffOnOpponentMelds: boolean;
  /** Going out requires a final discard (melds may never empty the hand). */
  mustDiscardToWin: boolean;
  /**
   * When the deck runs out: 'reshuffle' shuffles the discard pile (all but its top card) back
   * into the deck; 'lowerPenaltyWins' / 'dead' end the round instead.
   */
  exhaustion: 'reshuffle' | 'lowerPenaltyWins' | 'dead';
  /** A player whose turn timer runs out loses the round. */
  timeoutLoses: boolean;
  /** Penalty value of an Ace left in hand. */
  acePenalty: number;
}

export const DEFAULT_CONQUER_RULES: ConquerRules = {
  handSize: 14,
  openingThreshold: 41,
  prediction: {
    // Confirmed by the project owner (base 5♣): Up → 6♣ 6♠, Down → 4♣ 4♠, Side → 5♦ 5♥, Up & Down → 4♣ 6♣.
    mapping: {
      up: { steps: [1], suits: 'sameColor' },
      down: { steps: [-1], suits: 'sameColor' },
      side: { steps: [0], suits: 'otherColor' },
      upDown: { steps: [1, -1], suits: 'sameSuit' },
    },
    boundary: 'wrap',
  },
  wild: {
    minNaturalPerMeld: 2,
    maxPerMeld: 1,
    printedJokers: true,
    printedJokerPenalty: 20,
    openingValue: 'represented',
    allowSwap: true,
    swappedMustBeUsedSameTurn: true,
    penalty: 'natural',
  },
  runs: { aceHigh: true },
  discardPickup: 'mustMeldBeforeDiscard',
  layoffRequiresOpen: true,
  layoffOnOpponentMelds: true,
  mustDiscardToWin: true,
  exhaustion: 'reshuffle',
  timeoutLoses: true,
  acePenalty: 11,
};

/** Rule options not yet verified against authoritative Ethiopian rules. */
export const CONQUER_UNVERIFIED_RULES: readonly string[] = [
  'prediction.boundary',
  'wild.printedJokerPenalty',
  'wild.openingValue',
  'wild.allowSwap',
  'wild.swappedMustBeUsedSameTurn',
  'wild.penalty',
  'runs.aceHigh',
  'layoffOnOpponentMelds',
  'mustDiscardToWin',
];

export interface ConquerConfig {
  rules: ConquerRules;
  /** Entry stake per player per round; the round winner takes both. */
  stake: number;
  turnSeconds: number;
  predictSeconds: number;
  /** Time to agree on a rematch before the match closes. */
  rematchSeconds: number;
  maxMissedTurns: number;
}

export const DEFAULT_CONQUER_CONFIG: ConquerConfig = {
  rules: DEFAULT_CONQUER_RULES,
  stake: 0,
  turnSeconds: 90,
  predictSeconds: 30,
  rematchSeconds: 60,
  maxMissedTurns: 3,
};

/** A meld proposed by a client. `as` optionally pins what each substituting wildcard represents. */
export interface ConquerMeldSpec {
  cards: Card[];
  as?: Record<Card, Card>;
}

export interface ConquerLayoffSpec {
  meldId: string;
  card: Card;
  as?: Card;
}

export type ConquerAction =
  | { type: 'predict'; choice: ConquerPrediction }
  | { type: 'drawStock' }
  /** Draw the face-up base card from under the deck; the player must then go out this turn. */
  | { type: 'takeBase' }
  /** Take the top discard; it must appear in the melds/lay-offs submitted with it. */
  | { type: 'takeDiscard'; melds?: ConquerMeldSpec[]; layoffs?: ConquerLayoffSpec[] }
  /** Lay down melds (an opening when not yet open). */
  | { type: 'meld'; melds: ConquerMeldSpec[] }
  | { type: 'layoff'; layoffs: ConquerLayoffSpec[] }
  /** Give `card` (the natural a table wildcard represents) and take that wildcard into hand. */
  | { type: 'swapWild'; meldId: string; card: Card }
  | { type: 'discard'; card: Card }
  | { type: 'rematch' }
  | { type: 'leave' };

export interface ConquerPlacedCard {
  /** The physical card. */
  card: Card;
  /** The card identity it stands for in the meld (equal to `card` for naturals). */
  as: Card;
  wild: boolean;
  /** Points this card contributes in its role. */
  points: number;
  ownerId: string;
  /** Position in a run (A low = 1 … K = 13, A high = 14). */
  pos?: number;
}

export interface ConquerMeldView {
  id: string;
  ownerId: string;
  kind: 'set' | 'run';
  cards: ConquerPlacedCard[];
  points: number;
}

export type ConquerPhase = 'predict' | 'draw' | 'meld' | 'roundOver' | 'finished';

export interface ConquerPlayerView {
  playerId: string;
  seat: number;
  handCount: number;
  opened: boolean;
  roundsWon: number;
  missedTurns: number;
  wantsRematch: boolean;
  /** Cards on the table contributed by this player (melds + lay-offs). */
  tableCount: number;
  /** Revealed at the end of a round for penalty scoring. */
  revealedHand: Card[] | null;
  penalty: number | null;
  status: 'active' | 'left';
}

export interface ConquerLastEvent {
  playerId: string | null;
  kind: string;
  text: string;
}

export interface ConquerRoundResult {
  round: number;
  winnerId: string | null;
  reason: 'out' | 'exhaustion' | 'forfeit' | 'timeout';
  penalties: Record<string, number>;
}

export interface ConquerView {
  game: 'conquer';
  config: ConquerConfig;
  unverifiedRules: readonly string[];
  round: number;
  phase: ConquerPhase;
  predictorId: string | null;
  /** Hidden from everyone until the prediction (the choice is blind); then shown face-up under the stock. */
  baseCard: Card | null;
  /** True while the base card still lies face-up at the bottom of the stock. */
  baseInStock: boolean;
  prediction: ConquerPrediction | null;
  wildCards: Card[];
  wildRanks: Rank[];
  wildSuits: Suit[] | null;
  players: ConquerPlayerView[];
  /** The viewer's private hand (empty for spectators). */
  hand: Card[];
  pendingWild: Card | null;
  /** The discard the current player took this turn (public; shown highlighted). */
  pendingPickup: Card | null;
  /** Points the current, not-yet-open player has laid down this turn toward the opening threshold. */
  openingProgress: number;
  /** The current player took the discard before opening and must reach the threshold this turn. */
  mustOpen: boolean;
  /** The current player must go out this turn: they took the base card or filled a meld. */
  mustFinish: boolean;
  mustFinishReason: 'base' | 'fill' | null;
  /** Cards in the viewer's hand that may not be discarded now (jokers and cards that fit a table meld). */
  undiscardable: Card[];
  /** The most recent discards, oldest first (top card last) — for drawing the pile. */
  discardRecent: Card[];
  melds: ConquerMeldView[];
  stockCount: number;
  discardTop: Card | null;
  discardCount: number;
  currentPlayerId: string | null;
  turnDeadline: number | null;
  lastEvent: ConquerLastEvent | null;
  roundResult: ConquerRoundResult | null;
  legal: {
    predict: boolean;
    drawStock: boolean;
    takeDiscard: boolean;
    takeBase: boolean;
    meld: boolean;
    layoff: boolean;
    swapWild: boolean;
    discard: boolean;
    rematch: boolean;
  };
}
