import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Database, Download, LogOut, ShieldAlert, Smartphone, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { Button, Card, ConfirmModal, Input, Modal, PageHeader, SectionTitle, Toggle } from '../components/ui';
import { ApiError, IS_LOCAL, api, saveBlob } from '../lib/api';
import { IS_NATIVE } from '../lib/native';
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

  useEffect(() => { if (!IS_LOCAL) currentPushState().then(setPush); }, []);

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
      {IS_LOCAL && <LocalDataCard />}

      <SectionTitle>Notificações</SectionTitle>
      <Card>
        <Toggle checked={profile.data?.inAppReminders ?? true} onChange={(v) => setInApp.mutate(v)} label="Lembretes dentro do app" description="Avisos na tela enquanto o FlagTrack estiver aberto." />
        {IS_LOCAL ? (
          <LocalNotifications />
        ) : (
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
        )}
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

      {!IS_LOCAL && <SectionTitle>Conta</SectionTitle>}
      {!IS_LOCAL && <Card className="space-y-3">
        <Button variant="soft" className="w-full" icon={LogOut} onClick={logout}>Sair</Button>
        <Button variant="danger" className="w-full" icon={ShieldAlert} onClick={() => setDelOpen(true)}>Excluir conta e dados</Button>
      </Card>}

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

/** Offline mode: notifications are shown while the app is open (no server to push). */
function LocalNotifications() {
  const toast = useToast();
  const [perm, setPerm] = useState<string>(IS_NATIVE ? 'prompt' : typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  useEffect(() => {
    if (IS_NATIVE) import('../lib/nativeReminders').then((m) => m.notificationPermission()).then(setPerm);
  }, []);
  const ask = async () => {
    if (IS_NATIVE) {
      const { requestNotificationPermission } = await import('../lib/nativeReminders');
      const granted = await requestNotificationPermission();
      setPerm(granted ? 'granted' : 'denied');
      if (granted) toast.success('Notificações permitidas. Os lembretes chegam mesmo com o app fechado.');
      return;
    }
    const r = await Notification.requestPermission();
    setPerm(r);
    if (r === 'granted') toast.success('Notificações permitidas.');
  };
  return (
    <div className="mb-4">
      <div className="text-[15px] font-medium">Notificações do sistema</div>
      <p className="mt-0.5 text-sm text-muted">
        {IS_NATIVE
          ? 'Os lembretes das atividades planejadas (próximos 30 dias) são agendados no Android e chegam mesmo com o app fechado.'
          : 'No modo local não há servidor para enviar push: os lembretes aparecem enquanto o app estiver aberto ou em segundo plano recente.'}
      </p>
      {perm === 'granted' ? <p className="mt-2 text-sm text-accent">Permitidas ✓</p>
        : perm === 'unsupported' ? <p className="mt-2 text-sm text-muted">Não suportado neste navegador.</p>
        : perm === 'denied' ? <p className="mt-2 text-sm text-muted">{IS_NATIVE ? 'Bloqueadas — libere em Configurações do Android › Apps › FlagTrack › Notificações.' : 'Bloqueadas — libere nas configurações do site no Chrome.'}</p>
        : <Button variant="outline" size="sm" className="mt-2" onClick={ask}>Permitir notificações</Button>}
    </div>
  );
}

/** Offline mode: the data exists only on this phone, so backups matter. */
function LocalDataCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    const { exportBackup } = await import('../local/backend');
    const { blob, name } = await exportBackup();
    await saveBlob(blob, name);
    toast.success(`Backup gerado: ${name}`);
  };
  const doImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const { importBackup } = await import('../local/backend');
      const r = await importBackup(pending);
      await qc.resetQueries();
      toast.success(`Backup restaurado: ${r.activities} atividades, ${r.games} jogos, ${r.attempts} tentativas.`);
      setPending(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao restaurar.');
    } finally {
      setBusy(false);
    }
  };
  const doReset = async () => {
    setBusy(true);
    const { resetAll } = await import('../local/backend');
    await resetAll();
    await qc.resetQueries();
    setBusy(false);
    setResetOpen(false);
  };
  return (
    <>
      <SectionTitle>Dados neste aparelho</SectionTitle>
      <Card>
        <div className="mb-4 flex items-start gap-3 text-sm">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <p className="text-muted">
            Modo local: sem conta e sem internet. Tudo fica salvo só neste celular. Se o app for desinstalado ou os dados do site forem limpos,
            os registros se perdem — faça backups com frequência.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="outline" icon={Download} onClick={doExport}>Fazer backup</Button>
          <Button variant="soft" icon={Upload} onClick={() => fileRef.current?.click()}>Restaurar</Button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { setPending(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        <Button variant="danger" className="mt-3 w-full" icon={Trash2} onClick={() => setResetOpen(true)}>Apagar todos os dados</Button>
      </Card>
      <ConfirmModal open={!!pending} onClose={() => setPending(null)} onConfirm={doImport} title="Restaurar backup?" confirmLabel="Restaurar" loading={busy}>
        Os dados atuais deste aparelho serão substituídos pelos do arquivo “{pending?.name}”.
      </ConfirmModal>
      <ConfirmModal open={resetOpen} onClose={() => setResetOpen(false)} onConfirm={doReset} title="Apagar todos os dados?" danger confirmLabel="Apagar tudo" loading={busy}>
        Perfil, atividades, campeonatos, desafios, coletivos, peso, XP e conquistas serão apagados deste aparelho. Não é possível desfazer — faça um backup antes.
      </ConfirmModal>
    </>
  );
}
