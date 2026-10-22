'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { pokerMttLevel, type PokerCashTableSummary, type PokerTournamentSummary } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Coin, EmptyState, LoadingState, Toast } from '@/components/ui';

const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

const until = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

function useTick(every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** The always-open cash tables: one per stake level (more open as tables fill up). */
function CashTables() {
  const router = useRouter();
  const [tables, setTables] = useState<PokerCashTableSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<PokerCashTableSummary[]>('/poker/tables')
      .then((t) => (setTables(t), setError(null)))
      .catch((err) => setError((err as Error).message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);
  if (error && !tables) return <p className="text-sm text-danger">{error}</p>;
  if (!tables) return <LoadingState />;
  if (!tables.length) return <EmptyState title="No cash tables" body="Tables open automatically — try again in a moment." />;
  return (
    <div className="grid gap-2">
      {tables.map((t) => (
        <button key={t.matchId} className="card flex items-center gap-3 px-4 py-3 text-left" onClick={() => router.push(`/poker/${t.matchId}`)}>
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle,#3b82c9,#184a85)] text-[11px] font-black ring-2 ring-[#e8762c]">
            {t.bigBlind >= 1000 ? `${t.bigBlind / 1000}K` : t.bigBlind}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-extrabold">
              <span className="truncate">{t.name}</span>
              {t.seatedHere && <span className="rounded-full bg-lime/15 px-1.5 text-[10px] font-bold text-lime">Seated</span>}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              Blinds {t.smallBlind}/{t.bigBlind} · Buy-in <Coin className="h-3 w-3" /> {t.minBuyIn.toLocaleString()}–{t.maxBuyIn.toLocaleString()}
            </div>
            <div className="mt-1 flex gap-0.5" aria-label={`${t.seated} of ${t.maxSeats} seats taken`}>
              {Array.from({ length: t.maxSeats }, (_, i) => (
                <span key={i} className={`h-1.5 w-3 rounded-full ${i < t.seated ? 'bg-lime' : 'bg-white/15'}`} />
              ))}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-black">
              {t.seated}/{t.maxSeats}
            </div>
            <div className="text-[11px] font-bold text-lime">{t.seatedHere ? 'Back to table' : t.seated < t.maxSeats ? 'Sit down' : 'Watch'}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

/** A ring that empties over the last hour before a tournament starts. */
function StartRing({ ms, status }: { ms: number; status: PokerTournamentSummary['status'] }) {
  const R = 17;
  const C = 2 * Math.PI * R;
  const ratio = status === 'scheduled' ? Math.max(0, Math.min(1, ms / 3_600_000)) : 0;
  const color = status === 'running' ? '#3b82f6' : status === 'scheduled' ? '#22c55e' : '#6b7280';
  return (
    <div className="relative grid h-11 w-11 shrink-0 place-items-center">
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
        <circle cx="20" cy="20" r={R} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="3.5" />
        <circle cx="20" cy="20" r={R} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={status === 'scheduled' ? C * (1 - ratio) : 0} />
      </svg>
      <span className="text-[9px] font-black leading-tight">{status === 'scheduled' ? (ms < 3_600_000 ? until(ms) : 'Soon') : status === 'running' ? 'Live' : 'End'}</span>
    </div>
  );
}

const STATUS_STYLE: Record<PokerTournamentSummary['status'], { strip: string; label: string }> = {
  scheduled: { strip: 'bg-lime', label: 'Registering' },
  running: { strip: 'bg-[#3b82f6]', label: 'Running' },
  finished: { strip: 'bg-white/30', label: 'Finished' },
  cancelled: { strip: 'bg-danger', label: 'Cancelled' },
};

function Badge({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'gold' }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${tone === 'gold' ? 'bg-gold/20 text-gold' : 'bg-white/10 text-white/80'}`}>{children}</span>;
}

/** Tournament details: prizes, structure and the blind schedule. */
function TournamentDrawer({ t, onClose, action }: { t: PokerTournamentSummary; onClose: () => void; action: ReactNode }) {
  const [tab, setTab] = useState<'info' | 'prizes' | 'blinds'>('info');
  const row = (label: string, value: ReactNode) => (
    <div className="flex items-center justify-between border-b border-white/[0.06] py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-black tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/60 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-modal="true" aria-label={t.name}>
      <div className="max-h-[85vh] w-full max-w-[560px] animate-pop overflow-y-auto rounded-t-3xl bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap gap-1">
              <Badge>NL Hold&apos;em</Badge>
              <Badge>{t.tableSize}-max</Badge>
              {t.guarantee > 0 && <Badge tone="gold">GTD</Badge>}
            </div>
            <h2 className="mt-1 font-display text-xl font-extrabold">{t.name}</h2>
          </div>
          <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="my-3 grid grid-cols-3 gap-1 rounded-xl bg-black/25 p-1 text-sm font-bold">
          {(['info', 'prizes', 'blinds'] as const).map((k) => (
            <button key={k} className={`rounded-lg py-1.5 capitalize ${tab === k ? 'bg-white/15' : 'text-muted'}`} onClick={() => setTab(k)}>
              {k}
            </button>
          ))}
        </div>
        {tab === 'info' && (
          <div>
            {row('Starts', new Date(t.startsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }))}
            {row('Prize pool', <span className="text-gold">{t.prizePool.toLocaleString()}</span>)}
            {t.guarantee > 0 && row('Guaranteed', t.guarantee.toLocaleString())}
            {row('1st prize', (t.payouts[0] ?? 0).toLocaleString())}
            {row('Places paid', t.payouts.length)}
            {row('Buy-in', t.buyIn ? t.buyIn.toLocaleString() : 'Free')}
            {row('Registered', `${t.registered} / ${t.maxEntrants}`)}
            {t.playersLeft != null && row('Players left', t.playersLeft)}
            {row('Starting stack', t.startingStack.toLocaleString())}
            {row('Levels', `${t.levelMinutes} min`)}
            {row('Late registration', t.lateRegLevels ? `${t.lateRegLevels} level${t.lateRegLevels === 1 ? '' : 's'}` : 'None')}
          </div>
        )}
        {tab === 'prizes' && (
          <div>
            <p className="mb-2 text-xs text-muted">With {Math.max(2, t.registered)} players. The prize pool grows with every entry{t.guarantee ? ' and never drops below the guarantee' : ''}.</p>
            {t.payouts.map((p, i) => row(`${ordinal(i + 1)} place`, <span className={i === 0 ? 'text-gold' : ''}>{p.toLocaleString()}</span>))}
          </div>
        )}
        {tab === 'blinds' && (
          <div>
            {Array.from({ length: 12 }, (_, i) => {
              const l = pokerMttLevel(i);
              return row(`Level ${i + 1} · ${t.levelMinutes * i}–${t.levelMinutes * (i + 1)} min`, `${l.smallBlind}/${l.bigBlind}${l.ante ? ` · ante ${l.ante}` : ''}`);
            })}
          </div>
        )}
        <div className="mt-4">{action}</div>
      </div>
    </div>
  );
}

/** Scheduled tournaments created by the administrators. */
function Tournaments() {
  const router = useRouter();
  const { user, refreshUser } = useSession();
  const now = useTick();
  const [list, setList] = useState<PokerTournamentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    api<PokerTournamentSummary[]>('/poker/tournaments')
      .then((l) => (setList(l), setError(null)))
      .catch((err) => setError((err as Error).message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const call = async (t: PokerTournamentSummary, path: 'register' | 'unregister') => {
    setBusy(t.id);
    try {
      const updated = await api<PokerTournamentSummary>(`/poker/tournaments/${t.id}/${path}`, { body: {} });
      setList((l) => l?.map((x) => (x.id === t.id ? updated : x)) ?? l);
      void refreshUser();
      if (path === 'register' && updated.status === 'running' && updated.matchId) router.push(`/poker/${updated.matchId}`);
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const actionFor = (t: PokerTournamentSummary, full = false) => {
    const cls = `${full ? 'w-full py-3' : 'px-3 py-1.5'} rounded-xl text-xs font-black disabled:opacity-50`;
    if (t.isRegistered && t.status === 'running' && t.matchId)
      return (
        <button className={`${cls} bg-[#3b82f6] text-white`} onClick={() => router.push(`/poker/${t.matchId}`)}>
          Open table
        </button>
      );
    if (t.isRegistered && t.status === 'scheduled')
      return (
        <button className={`${cls} bg-white/10 text-white`} disabled={busy === t.id} onClick={() => void call(t, 'unregister')}>
          Unregister
        </button>
      );
    if (t.canRegister)
      return (
        <button className={`${cls} bg-lime text-[#07071a]`} disabled={busy === t.id || (user?.balance ?? 0) < t.buyIn} onClick={() => void call(t, 'register')}>
          {t.status === 'running' ? 'Late reg' : 'Register'}
        </button>
      );
    if (t.status === 'running' && t.matchId)
      return (
        <button className={`${cls} bg-white/10 text-white`} onClick={() => router.push(`/poker/${t.matchId}`)}>
          Watch
        </button>
      );
    return <span className={`${cls} bg-white/5 text-muted`}>{STATUS_STYLE[t.status].label}</span>;
  };

  if (error && !list) return <p className="text-sm text-danger">{error}</p>;
  if (!list) return <LoadingState />;
  const current = list.find((t) => t.id === open) ?? null;
  return (
    <>
      {list.length === 0 ? (
        <EmptyState title="No tournaments scheduled" body="New tournaments are announced here. Meanwhile, start a Sit & Go below." />
      ) : (
        <div className="grid gap-2">
          {list.map((t) => {
            const start = new Date(t.startsAt).getTime();
            return (
              <div key={t.id} className="card relative flex items-center gap-3 overflow-hidden py-3 pl-4 pr-3">
                <span className={`absolute inset-y-0 left-0 w-1 ${STATUS_STYLE[t.status].strip}`} />
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(t.id)}>
                  <StartRing ms={start - now} status={t.status} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1 text-[11px] font-bold text-muted">
                      <span>{new Date(t.startsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <Badge>NL Hold&apos;em</Badge>
                      <Badge>{t.tableSize}-max</Badge>
                    </div>
                    <div className="truncate text-sm font-extrabold">{t.name}</div>
                    <div className="flex items-center gap-1 text-xs text-muted">
                      <span className="font-black text-gold">{t.prizePool.toLocaleString()}</span>
                      {t.guarantee > 0 && t.prizePool <= t.guarantee && <span className="text-[10px] font-bold">GTD</span>}
                      <span>
                        · {t.registered}/{t.maxEntrants} {t.status === 'running' && t.playersLeft != null ? `· ${t.playersLeft} left` : ''}
                      </span>
                    </div>
                  </div>
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="flex items-center gap-1 text-xs font-black">{t.buyIn ? (<><Coin className="h-3 w-3" />{t.buyIn.toLocaleString()}</>) : 'Free'}</span>
                  {actionFor(t)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {current && <TournamentDrawer t={current} onClose={() => setOpen(null)} action={actionFor(current, true)} />}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
}

/** The poker lobby lists: permanent cash tables, or scheduled tournaments. */
export function PokerLobby({ mode }: { mode: 'cash' | 'tournament' }) {
  return (
    <section className="mb-4">
      <h2 className="mb-2 font-display text-base font-extrabold">{mode === 'cash' ? 'Cash tables · always open' : 'Scheduled tournaments'}</h2>
      {mode === 'cash' ? <CashTables /> : <Tournaments />}
    </section>
  );
}
