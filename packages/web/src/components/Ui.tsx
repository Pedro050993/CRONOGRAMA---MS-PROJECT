import type { ReactNode } from 'react';

export function Card({ title, actions, children, flush }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean;
}): JSX.Element {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card__head">
          {title && <h3>{title}</h3>}
          <span className="spacer" />
          {actions}
        </header>
      )}
      <div className={flush ? 'card__body card__body--flush' : 'card__body'}>{children}</div>
    </section>
  );
}

export function Notice({ tone = 'info', title, children }: {
  tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: ReactNode; children?: ReactNode;
}): JSX.Element {
  return (
    <div className={`notice notice--${tone}`}>
      {title && <h4>{title}</h4>}
      {children && <p>{children}</p>}
    </div>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }): JSX.Element {
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      {hint && <div className="kpi__hint">{hint}</div>}
    </div>
  );
}

/** Estados obrigatorios de lista (§15): carregando, erro e vazio explicito. */
export function AsyncBoundary({ loading, error, empty, emptyTitle, emptyHint, children }: {
  loading: boolean;
  error: Error | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  if (loading) return <div className="loading">Carregando…</div>;
  if (error) {
    return (
      <Notice tone="danger" title="Nao foi possivel carregar">
        {error.message}
      </Notice>
    );
  }
  if (empty) {
    return (
      <div className="empty">
        <strong>{emptyTitle ?? 'Nada aqui ainda'}</strong>
        {emptyHint}
      </div>
    );
  }
  return <>{children}</>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
