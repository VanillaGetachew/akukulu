import type { ActionAck, MatchStatePayload } from '@akukulu/shared';

export interface TableProps<V> {
  state: MatchStatePayload;
  view: V;
  act: (action: Record<string, unknown>) => Promise<ActionAck>;
  pending: boolean;
  serverNow: () => number;
}

export function nameOf(state: MatchStatePayload, userId: string | null | undefined): string {
  return state.players.find((p) => p.userId === userId)?.displayName ?? 'Player';
}
