'use client';

import { useParams } from 'next/navigation';
import type { PokerView } from '@akukulu/shared';
import { useMatch } from '@/lib/use-match';
import { ErrorState, LoadingState, Page, Toast } from '@/components/ui';
import { PokerTable } from '@/components/games/poker-table';

/** A poker table that is not tied to a room: the always-open cash tables and scheduled tournaments. */
export default function PokerTablePage() {
  const { id } = useParams<{ id: string }>();
  const match = useMatch(id);
  if (!match.state) {
    return <Page nav={false}>{match.error ? <ErrorState message={match.error} /> : <LoadingState label="Opening the table…" />}</Page>;
  }
  return (
    <Page nav={false}>
      <PokerTable state={match.state} view={match.state.view as PokerView} act={match.act} pending={match.pending} serverNow={match.serverNow} />
      <Toast message={match.error} onClose={() => match.setError(null)} />
    </Page>
  );
}
