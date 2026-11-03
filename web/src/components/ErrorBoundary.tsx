import { Component, type ReactNode } from 'react';

/** Shows a recoverable message instead of a blank screen when a page crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error('[FlagTrack] Erro na tela', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card mx-auto max-w-md p-6 text-center">
        <p className="font-display text-2xl font-bold">Algo deu errado nesta tela</p>
        <p className="mt-2 text-sm text-muted">Seus dados estão salvos. Tente novamente ou volte para o início.</p>
        <p className="mt-3 break-words rounded-lg bg-surface2 p-2 text-left text-xs text-muted">{this.state.error.message}</p>
        <div className="mt-5 flex justify-center gap-3">
          <button className="rounded-xl bg-surface2 px-4 py-2.5 font-semibold" onClick={() => this.setState({ error: null })}>Tentar novamente</button>
          <a className="rounded-xl bg-accent px-4 py-2.5 font-semibold text-accent-ink" href={import.meta.env.BASE_URL}>Início</a>
        </div>
      </div>
    );
  }
}
