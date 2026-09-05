import { useState } from 'react';
import { api, setToken } from '../lib/api';
import { Field } from '../components/Ui';

export function Login(): JSX.Element {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ organizationName: '', name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register-organization';
      const payload = mode === 'login'
        ? { email: form.email, password: form.password }
        : form;
      const r = await api.post<{ token: string }>(path, payload);
      setToken(r.token);
      location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entrar.');
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="login">
      <form className="login__box" onSubmit={submit}>
        <h1>Cronograma</h1>
        <p className="sub">Planejamento de obras industriais eletromecanicas</p>

        {error && <div className="notice notice--danger"><p>{error}</p></div>}

        {mode === 'register' && (
          <>
            <Field label="Organizacao">
              <input value={form.organizationName} onChange={set('organizationName')} required minLength={2} />
            </Field>
            <Field label="Seu nome">
              <input value={form.name} onChange={set('name')} required minLength={2} />
            </Field>
          </>
        )}
        <Field label="E-mail">
          <input type="email" value={form.email} onChange={set('email')} required autoComplete="username" />
        </Field>
        <Field
          label="Senha"
          hint={mode === 'register' ? 'Minimo de 10 caracteres.' : undefined}
        >
          <input
            type="password" value={form.password} onChange={set('password')} required
            minLength={mode === 'register' ? 10 : 1}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
        </Field>

        <button className="primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar organizacao'}
        </button>

        <p className="small muted" style={{ marginTop: 12, textAlign: 'center' }}>
          {mode === 'login' ? (
            <>Primeira vez? <a href="#" onClick={(e) => { e.preventDefault(); setMode('register'); }}>Criar organizacao</a></>
          ) : (
            <>Ja tem conta? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); }}>Entrar</a></>
          )}
        </p>
      </form>
    </div>
  );
}
