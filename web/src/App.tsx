import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { ErrorState, PageLoading } from './components/ui';
import { ApiError, api } from './lib/api';
import ActivityDetail from './pages/ActivityDetail';
import ActivityForm from './pages/ActivityForm';
import Analytics from './pages/Analytics';
import { AuthPage } from './pages/Auth';
import Calendar from './pages/Calendar';
import { AttemptEdit, ChallengeDetail, ChallengeForm, ChallengesList } from './pages/Challenges';
import { ChampionshipDetail, ChampionshipForm, ChampionshipsList, GameDetail, GameForm, GamesList, StageForm } from './pages/Championships';
import { CollectiveDetail, CollectiveForm, CollectivesList } from './pages/Collectives';
import Compare from './pages/Compare';
import Dashboard from './pages/Dashboard';
import Evolution from './pages/Evolution';
import Goals from './pages/Goals';
import { Onboarding, ProfileEdit, ProfilePage, WeightPage } from './pages/Profile';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

type Me = { user: { id: string; email: string }; hasProfile: boolean };

export default function App() {
  const loc = useLocation();
  // Only a real 401 means "logged out"; network/server hiccups are retried instead.
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 4,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    staleTime: Infinity,
  });

  useEffect(() => {
    const onUnauthorized = () => me.refetch();
    window.addEventListener('ft:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ft:unauthorized', onUnauthorized);
  }, [me]);

  if (me.isLoading) return <div className="mx-auto max-w-lg p-6"><PageLoading /></div>;
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  if (me.isError && !unauthenticated && !me.data) {
    return <div className="mx-auto max-w-lg p-6"><ErrorState error={me.error} retry={() => me.refetch()} /></div>;
  }
  const authed = !!me.data && !unauthenticated;
  const isAuthRoute = loc.pathname === '/login' || loc.pathname === '/register';

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  if (!me.data!.hasProfile) {
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }
  if (isAuthRoute || loc.pathname === '/onboarding') return <Navigate to="/" replace />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="activities/new" element={<ActivityForm />} />
        <Route path="activities/:id" element={<ActivityDetail />} />
        <Route path="activities/:id/edit" element={<ActivityForm />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="analytics/championships" element={<ChampionshipsList />} />
        <Route path="analytics/championships/new" element={<ChampionshipForm />} />
        <Route path="analytics/championships/:id" element={<ChampionshipDetail />} />
        <Route path="analytics/championships/:id/edit" element={<ChampionshipForm />} />
        <Route path="analytics/championships/:id/stages/new" element={<StageForm />} />
        <Route path="analytics/championships/:id/stages/:stageId/edit" element={<StageForm />} />
        <Route path="analytics/games" element={<GamesList />} />
        <Route path="analytics/games/new" element={<GameForm />} />
        <Route path="analytics/games/:id" element={<GameDetail />} />
        <Route path="analytics/games/:id/edit" element={<GameForm />} />
        <Route path="analytics/challenges" element={<ChallengesList />} />
        <Route path="analytics/challenges/new" element={<ChallengeForm />} />
        <Route path="analytics/challenges/:id" element={<ChallengeDetail />} />
        <Route path="analytics/challenges/:id/edit" element={<ChallengeForm />} />
        <Route path="analytics/attempts/:id/edit" element={<AttemptEdit />} />
        <Route path="analytics/collectives" element={<CollectivesList />} />
        <Route path="analytics/collectives/new" element={<CollectiveForm />} />
        <Route path="analytics/collectives/:id" element={<CollectiveDetail />} />
        <Route path="analytics/collectives/:id/edit" element={<CollectiveForm />} />
        <Route path="evolution" element={<Evolution />} />
        <Route path="evolution/compare" element={<Compare />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="profile/edit" element={<ProfileEdit />} />
        <Route path="profile/weight" element={<WeightPage />} />
        <Route path="goals" element={<Goals />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
