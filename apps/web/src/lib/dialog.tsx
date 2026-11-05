'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface ConfirmOptions {
  message: string;
  confirmLabel?: string;
  /** Styles the confirm button as a warning, for actions that lose something. */
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  placeholder?: string;
  /** The confirm button stays disabled until something is typed. */
  required?: boolean;
}

interface DialogValue {
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** Resolves to the typed text, or null if cancelled. */
  prompt(options: PromptOptions): Promise<string | null>;
}

const DialogContext = createContext<DialogValue | null>(null);

type Open = PromptOptions & { input: boolean };

/**
 * In-app dialogs. The browser's own confirm() and prompt() show the site's address as a
 * title inside Telegram, so everything goes through here instead.
 */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [text, setText] = useState('');
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const show = useCallback((options: Open) => {
    resolver.current?.(null);
    setText('');
    setOpen(options);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const value = useMemo<DialogValue>(
    () => ({
      confirm: async (options) => (await show({ ...options, input: false })) !== null,
      prompt: (options) => show({ ...options, input: true }),
    }),
    [show],
  );

  const finish = (result: string | null) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpen(null);
  };

  return (
    <DialogContext.Provider value={value}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-labelledby="app-dialog-message" onClick={() => finish(null)}>
          <form
            className="card grid w-full max-w-sm gap-4 p-5"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              finish(open.input ? text.trim() : '');
            }}
          >
            <p id="app-dialog-message" className="text-[15px] font-semibold leading-snug">
              {open.message}
            </p>
            {open.input && <input autoFocus className="input" placeholder={open.placeholder} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost" onClick={() => finish(null)}>
                Cancel
              </button>
              <button className={open.danger ? 'btn-danger' : 'btn-primary'} disabled={open.input && !!open.required && !text.trim()}>
                {open.confirmLabel ?? 'OK'}
              </button>
            </div>
          </form>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogValue {
  const value = useContext(DialogContext);
  if (!value) throw new Error('useDialog must be used inside DialogProvider');
  return value;
}
