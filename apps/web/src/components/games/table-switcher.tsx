'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GAME_CATALOG, type GameSlug, type RoomSummary } from '@akukulu/shared';
import { api } from '@/lib/api';

interface Active {
  rooms: RoomSummary[];
  matches: { id: string; gameSlug: GameSlug; roomId: string | null }[];
}

interface OtherTable {
  key: string;
  game: string;
  detail: string;
  href: string;
}

const gameName = (slug: GameSlug) => GAME_CATALOG.find((g) => g.slug === slug)?.name ?? slug;

function otherTables(active: Active, currentMatchId: string): OtherTable[] {
  const rooms = active.rooms
    .filter((r) => r.matchId !== currentMatchId && (r.status === 'in_progress' || r.status === 'waiting'))
    .map((r) => ({
      key: r.id,
      game: gameName(r.gameSlug),
      detail: `${r.status === 'waiting' ? 'Waiting for players' : 'In progress'} · ${r.players.length}/${r.maxPlayers} players`,
      href: `/room/${r.code}`,
    }));
  // Cash tables and tournaments have no room of their own.
  const tables = active.matches
    .filter((m) => m.roomId === null && m.id !== currentMatchId)
    .map((m) => ({ key: m.id, game: gameName(m.gameSlug), detail: 'At a table', href: `/poker/${m.id}` }));
  return [...rooms, ...tables];
}

/** Jump between tables you are playing at without going back to the lobby. Hidden when there's only this one. */
export function TableSwitcher({ matchId, size = 40 }: { matchId: string; size?: number }) {
  const router = useRouter();
  const [others, setOthers] = useState<OtherTable[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      api<Active>('/me/active')
        .then((a) => live && setOthers(otherTables(a, matchId)))
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [matchId]);

  if (others.length === 0) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Switch table. ${others.length} other ${others.length === 1 ? 'table' : 'tables'}`}
        className="relative grid shrink-0 place-items-center rounded-full bg-black/45 text-white shadow-[0_3px_8px_rgba(0,0,0,.45)]"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7h12M12 3.5 15.5 7 12 10.5M17 13H5M8 9.5 4.5 13 8 16.5" />
        </svg>
        <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-lime px-1 text-[11px] font-black text-[#05140a]">{others.length}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="Your other tables" onClick={() => setOpen(false)}>
          <div className="card m-3 grid w-full max-w-md gap-2 p-4 text-fg" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-base font-extrabold">Your other tables</h2>
            {others.map((t) => (
              <button
                key={t.key}
                className="flex items-center justify-between gap-3 rounded-xl bg-black/25 px-3 py-3 text-left"
                onClick={() => {
                  setOpen(false);
                  router.push(t.href);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{t.game}</span>
                  <span className="block truncate text-[13px] text-muted">{t.detail}</span>
                </span>
                <span className="btn-primary btn-sm shrink-0">Go</span>
              </button>
            ))}
            <button className="btn-ghost mt-1" onClick={() => setOpen(false)}>
              Stay at this table
            </button>
          </div>
        </div>
      )}
    </>
  );
}
