import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { loginSchema, registerSchema } from '@flagtrack/shared';
import { Logo } from '../components/Layout';
import { Button, Input } from '../components/ui';
import { ApiError, api } from '../lib/api';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const isLogin = mode === 'login';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const r = (isLogin ? loginSchema : registerSchema).safeParse({ email, password });
    if (!r.success) {
      setErrors(Object.fromEntries(Object.entries(r.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? ''])));
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await api(`/auth/${isLogin ? 'login' : 'register'}`, { body: r.data });
      await qc.resetQueries();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setFormError(err.message);
      } else setFormError('Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10">
      {/* Field lines backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 72px)' }} />
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-10 text-center">
          <img src={`${import.meta.env.BASE_URL}icon-512.png`} alt="" width={120} height={120} className="mx-auto mb-4 h-[120px] w-[120px] drop-shadow-2xl" />
          <Logo className="text-[clamp(2.6rem,13vw,3.75rem)]" />
          <p className="mt-2 font-display text-xl font-semibold uppercase tracking-[.2em] text-text/80">Analise. Evolua. Conquiste.</p>
        </div>
        <form onSubmit={submit} noValidate className="card p-6">
          <h1 className="mb-5 text-3xl font-bold">{isLogin ? 'Entrar' : 'Criar conta'}</h1>
          <Input label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
          <Input
            label="Senha"
            type="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint={isLogin ? undefined : 'Mínimo de 8 caracteres.'}
          />
          {formError && !Object.keys(errors).length && <p className="mb-3 text-sm text-danger" role="alert">{formError}</p>}
          <Button type="submit" size="lg" className="w-full" loading={loading}>{isLogin ? 'Entrar' : 'Criar conta'}</Button>
          <Link to={isLogin ? '/register' : '/login'} className="mt-3 block rounded-xl border border-accent py-3 text-center font-semibold text-accent hover:bg-accent/10">
            {isLogin ? 'Criar conta' : 'Já tenho conta'}
          </Link>
        </form>
        <p className="mt-6 text-center text-sm text-muted">Sua jornada no Flag Football, com dados de verdade.</p>
      </div>
    </div>
  );
}
