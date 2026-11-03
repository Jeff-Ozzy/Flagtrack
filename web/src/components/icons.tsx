import {
  Activity as ActivityIcon, BedDouble, Dumbbell, Footprints, HeartPulse, Shield, Sparkles, Target, Trophy, Users, Zap,
} from 'lucide-react';

const MAP = {
  TECNICO: Zap,
  FISICO: HeartPulse,
  ACADEMIA: Dumbbell,
  CORRIDA: Footprints,
  MOBILIDADE: Sparkles,
  COLETIVO: Users,
  DESAFIO: Target,
  JOGO: Shield,
  CAMPEONATO: Trophy,
  DESCANSO: BedDouble,
  OUTRA: ActivityIcon,
} as const;

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = MAP[category as keyof typeof MAP] ?? ActivityIcon;
  return <Icon className={className} />;
}
