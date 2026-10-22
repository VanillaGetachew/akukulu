'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PokerTournamentSummary } from '@akukulu/shared';
import { api } from '@/lib/api';

interface Form {
  name: string;
  startsAt: string;
  buyIn: string;
  guarantee: string;
  startingStack: string;
  levelMinutes: string;
  lateRegLevels: string;
  maxEntrants: string;
  tableSize: string;
}

/** datetime-local value for a date, in the admin's local time. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

const blank = (): Form => ({
  name: '',
  startsAt: localInput(new Date(Date.now() + 60 * 60_000)),
  buyIn: '100',
  guarantee: '0',
  startingStack: '3000',
  levelMinutes: '8',
  lateRegLevels: '3',
  maxEntrants: '90',
  tableSize: '9',
});

const FIELDS: { key: keyof Form; label: string; hint?: string }[] = [
  { key: 'buyIn', label: 'Buy-in', hint: '0 = freeroll' },
  { key: 'guarantee', label: 'Guaranteed prize pool', hint: 'the house tops up' },
  { key: 'startingStack', label: 'Starting stack' },
  { key: 'levelMinutes', label: 'Minutes per level' },
  { key: 'lateRegLevels', label: 'Late registration (levels)' },
  { key: 'maxEntrants', label: 'Max entrants' },
  { key: 'tableSize', label: 'Players per table (2–9)' },
];

/** Admin: schedule, edit and cancel poker tournaments. */
export function AdminTournaments({ onDone }: { onDone: (message: string) => void }) {
  const [list, setList] = useState<PokerTournamentSummary[]>([]);
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PokerTournamentSummary[]>('/admin/tournaments')
      .then(setList)
      .catch((err) => setError((err as Error).message));
  }, []);
  useEffect(load, [load]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        startsAt: new Date(form.startsAt).toISOString(),
        ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key])])),
      };
      if (editing) await api(`/admin/tournaments/${editing}`, { method: 'PATCH', body });
      else await api('/admin/tournaments', { body });
      onDone(editing ? 'Tournament updated' : 'Tournament scheduled');
      setForm(blank());
      setEditing(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const edit = (t: PokerTournamentSummary) => {
    setEditing(t.id);
    setForm({
      name: t.name,
      startsAt: localInput(new Date(t.startsAt)),
      buyIn: String(t.buyIn),
      guarantee: String(t.guarantee),
      startingStack: String(t.startingStack),
      levelMinutes: String(t.levelMinutes),
      lateRegLevels: String(t.lateRegLevels),
      maxEntrants: String(t.maxEntrants),
      tableSize: String(t.tableSize),
    });
  };

  const cancel = async (t: PokerTournamentSummary) => {
    if (!confirm(`Cancel ${t.name}? Every buy-in is returned.`)) return;
    try {
      await api(`/admin/tournaments/${t.id}/cancel`, { body: {} });
      onDone('Tournament cancelled and buy-ins returned');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="card p-4">
      <h2 className="mb-1 font-display text-base font-extrabold">Poker tournaments</h2>
      <p className="mb-3 text-xs text-muted">Players register from the poker lobby. A tournament starts on time if two or more registered; otherwise it is cancelled and refunded.</p>
      <div className="grid gap-2">
        <input className="input py-2" placeholder="Name (e.g. Sunday Million)" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label className="grid gap-1 text-xs font-bold text-muted">
          Starts at
          <input className="input py-2" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="grid gap-1 text-xs font-bold text-muted">
              <span>
                {f.label} {f.hint && <span className="font-normal">· {f.hint}</span>}
              </span>
              <input className="input py-2" inputMode="numeric" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value.replace(/[^0-9]/g, '').slice(0, 9) })} />
            </label>
          ))}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={busy || !form.name.trim()} onClick={submit}>
            {editing ? 'Save changes' : 'Schedule tournament'}
          </button>
          {editing && (
            <button className="btn-ghost" onClick={() => (setEditing(null), setForm(blank()))}>
              Cancel edit
            </button>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {list.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-bold">
                {t.name} <span className="text-xs font-normal text-muted">· {t.status}</span>
              </div>
              <div className="text-xs text-muted">
                {new Date(t.startsAt).toLocaleString()} · buy-in {t.buyIn.toLocaleString()} · {t.registered}/{t.maxEntrants} · pool {t.prizePool.toLocaleString()}
              </div>
            </div>
            {(t.status === 'scheduled' || t.status === 'running') && (
              <div className="flex gap-2">
                {t.status === 'scheduled' && (
                  <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => edit(t)}>
                    Edit
                  </button>
                )}
                <button className="btn-ghost px-3 py-1.5 text-xs text-danger" onClick={() => void cancel(t)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
