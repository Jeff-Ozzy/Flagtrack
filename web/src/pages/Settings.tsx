import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Database, LogOut, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { Button, Card, ConfirmModal, Input, Modal, PageHeader, SectionTitle, Toggle } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAction, useProfile } from '../lib/hooks';
import { currentPushState, disablePush, enablePush } from '../lib/push';

export default function Settings() {
  const toast = useToast();
  const qc = useQueryClient();
  const profile = useProfile();
  const demo = useQuery({ queryKey: ['demo'], queryFn: () => api<{ active: boolean }>('/demo') });
  const [push, setPush] = useState<'unsupported' | 'denied' | 'on' | 'off' | null>(null);
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [demoDel, setDemoDel] = useState(false);

  useEffect(() => { currentPushState().then(setPush); }, []);

  const setInApp = useAction((v: boolean) => {
    const p = profile.data!;
    return api('/profile', { method: 'PUT', body: { fullName: p.fullName, positions: p.positions, jerseyNumber: p.jerseyNumber, birthDate: p.birthDate, heightCm: p.heightCm, timezone: p.timezone, inAppReminders: v } });
  }, { success: 'Preferência salva.' });
  const loadDemo = useAction(() => api('/demo', { method: 'POST' }), { success: 'Dados de demonstração carregados (marcados como DEMO).' });
  const removeDemo = useAction(() => api('/demo', { method: 'DELETE' }), { success: 'Dados de demonstração removidos.', onSuccess: () => setDemoDel(false) });

  const togglePush = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        await enablePush();
        const r = await api<{ sent: number }>('/push/test', { method: 'POST' });
        toast.success(r.sent ? 'Notificações ativadas! Enviamos uma notificação de teste.' : 'Inscrição salva, mas o envio de teste falhou.');
      } else {
        await disablePush();
        toast.success('Notificações push desativadas.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao configurar notificações.');
    } finally {
      setPush(await currentPushState());
      setBusy(false);
    }
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    await qc.resetQueries();
    window.location.href = '/login';
  };

  const deleteAccount = async () => {
    setPwError('');
    try {
      await api('/auth/account', { method: 'DELETE', body: { password } });
      window.location.href = '/login';
    } catch (e) {
      setPwError(e instanceof ApiError ? e.message : 'Falha ao excluir a conta.');
    }
  };

  return (
    <>
      <PageHeader title="Configurações" back />
      <SectionTitle>Notificações</SectionTitle>
      <Card>
        <Toggle checked={profile.data?.inAppReminders ?? true} onChange={(v) => setInApp.mutate(v)} label="Lembretes dentro do app" description="Avisos na tela enquanto o FlagTrack estiver aberto." />
        <Toggle
          checked={push === 'on'}
          onChange={(v) => !busy && push !== 'unsupported' && togglePush(v)}
          label="Notificações push"
          description={
            push === 'unsupported' ? 'Este navegador não suporta push. No iPhone, instale o app na tela de início (iOS 16.4+).'
              : push === 'denied' ? 'Permissão bloqueada no navegador. Libere nas configurações do site para ativar.'
              : 'Receba lembretes mesmo com o app fechado. Requer permissão explícita do navegador.'
          }
        />
        <p className="flex items-start gap-2 text-xs text-muted"><BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />Lembretes nunca são enviados para atividades canceladas, concluídas ou excluídas. O fuso usado é {profile.data?.timezone ?? '—'} (<Link to="/profile/edit" className="text-accent">alterar</Link>).</p>
      </Card>

      <SectionTitle>Dados de demonstração</SectionTitle>
      <Card>
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 h-5 w-5 text-warn" />
          <div className="flex-1 text-sm">
            {demo.data?.active
              ? 'Os dados de demonstração estão ativos e aparecem com o selo DEMO. Eles afetam ofensiva, XP e gráficos até serem removidos.'
              : 'Carregue treinos, jogos, desafios e coletivos fictícios para explorar o app. Tudo fica marcado como DEMO e pode ser removido.'}
          </div>
        </div>
        <div className="mt-4">
          {demo.data?.active
            ? <Button variant="danger" className="w-full" icon={Trash2} onClick={() => setDemoDel(true)}>Remover dados de demonstração</Button>
            : <Button variant="outline" className="w-full" loading={loadDemo.isPending} onClick={() => loadDemo.mutate()}>Carregar dados de demonstração</Button>}
        </div>
      </Card>

      <SectionTitle>Conta</SectionTitle>
      <Card className="space-y-3">
        <Button variant="soft" className="w-full" icon={LogOut} onClick={logout}>Sair</Button>
        <Button variant="danger" className="w-full" icon={ShieldAlert} onClick={() => setDelOpen(true)}>Excluir conta e dados</Button>
      </Card>

      <ConfirmModal open={demoDel} onClose={() => setDemoDel(false)} onConfirm={() => removeDemo.mutate()} title="Remover demonstração?" danger confirmLabel="Remover" loading={removeDemo.isPending}>
        Somente os registros marcados como DEMO serão excluídos. Seus dados reais são preservados e as conquistas serão recalculadas a partir deles.
      </ConfirmModal>
      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Excluir conta">
        <p className="mb-4 text-sm text-muted">Esta ação remove permanentemente seu perfil, atividades, campeonatos, desafios, coletivos, histórico de peso, XP e conquistas. Não é possível desfazer.</p>
        <Input label="Confirme sua senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={pwError} />
        <div className="flex gap-3">
          <Button variant="soft" className="flex-1" onClick={() => setDelOpen(false)}>Voltar</Button>
          <Button variant="danger" className="flex-1" disabled={!password} onClick={deleteAccount}>Excluir tudo</Button>
        </div>
      </Modal>
    </>
  );
}
