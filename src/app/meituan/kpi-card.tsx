'use client';

import { TrendingUp, TrendingDown, Minus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  label: string;
  value: string;
  delta: number | null;
  icon: LucideIcon;
  accent: 'violet' | 'cyan' | 'emerald' | 'amber' | 'rose' | 'sky';
  sub?: string;
}

const ACCENTS: Record<KpiCardProps['accent'], { text: string; glow: string; iconBg: string }> = {
  violet: {
    text: 'text-[#b8a8ff]',
    glow: 'from-[#7C5CFF]/25 to-transparent border-[#7C5CFF]/30',
    iconBg: 'bg-[#7C5CFF]/20 text-[#b8a8ff]',
  },
  cyan: {
    text: 'text-[#9feeff]',
    glow: 'from-[#69E7FF]/20 to-transparent border-[#69E7FF]/25',
    iconBg: 'bg-[#69E7FF]/15 text-[#9feeff]',
  },
  emerald: {
    text: 'text-[#9af5dc]',
    glow: 'from-[#62FAD3]/20 to-transparent border-[#62FAD3]/25',
    iconBg: 'bg-[#62FAD3]/15 text-[#9af5dc]',
  },
  amber: {
    text: 'text-[#ffd99a]',
    glow: 'from-amber-400/20 to-transparent border-amber-400/25',
    iconBg: 'bg-amber-400/15 text-[#ffd99a]',
  },
  rose: {
    text: 'text-[#ffb0b8]',
    glow: 'from-rose-400/20 to-transparent border-rose-400/25',
    iconBg: 'bg-rose-400/15 text-[#ffb0b8]',
  },
  sky: {
    text: 'text-[#a9d4ff]',
    glow: 'from-sky-400/20 to-transparent border-sky-400/25',
    iconBg: 'bg-sky-400/15 text-[#a9d4ff]',
  },
};

function formatDelta(delta: number | null): { text: string; positive: boolean | null } {
  if (delta === null || !Number.isFinite(delta)) return { text: '—', positive: null };
  const pct = (delta * 100).toFixed(1);
  return {
    text: `${delta >= 0 ? '+' : ''}${pct}%`,
    positive: delta >= 0,
  };
}

export function KpiCard({ label, value, delta, icon: Icon, accent, sub }: KpiCardProps) {
  const a = ACCENTS[accent];
  const d = formatDelta(delta);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 backdrop-blur-xl',
        'bg-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.35)]',
        a.glow
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[#9AA7C7]">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-white tabular-nums">{value}</p>
          {sub && <p className="mt-1 text-xs text-[#9AA7C7]">{sub}</p>}
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', a.iconBg)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        {d.positive === null ? (
          <Minus className="h-4 w-4 text-[#9AA7C7]" />
        ) : d.positive ? (
          <TrendingUp className="h-4 w-4 text-[#62FAD3]" />
        ) : (
          <TrendingDown className="h-4 w-4 text-rose-400" />
        )}
        <span
          className={cn(
            'text-xs font-medium tabular-nums',
            d.positive === null
              ? 'text-[#9AA7C7]'
              : d.positive
                ? 'text-[#62FAD3]'
                : 'text-rose-400'
          )}
        >
          {d.text}
        </span>
        <span className="text-xs text-[#9AA7C7]">环比上一周期</span>
      </div>
    </div>
  );
}
