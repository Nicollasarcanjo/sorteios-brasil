import React, {useEffect, useState} from 'react';
import {Clock} from 'lucide-react';

interface CountdownTimerProps {
  targetDate: string;
  variant?: 'card' | 'detail';
}

interface TimeRemaining {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calculateRemaining(targetIso: string): TimeRemaining {
  const diff = new Date(targetIso).getTime() - Date.now();
  if (Number.isNaN(diff) || diff <= 0) {
    return {totalMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0};
  }
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {totalMs: diff, days, hours, minutes, seconds};
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function CountdownTimer({
  targetDate,
  variant = 'card',
}: CountdownTimerProps) {
  const [remaining, setRemaining] = useState<TimeRemaining>(() =>
    calculateRemaining(targetDate),
  );

  useEffect(() => {
    setRemaining(calculateRemaining(targetDate));
    const timer = window.setInterval(() => {
      setRemaining(calculateRemaining(targetDate));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [targetDate]);

  const isUrgent = remaining.totalMs > 0 && remaining.totalMs < 24 * 60 * 60 * 1000;
  const isLastDays = remaining.totalMs > 0 && remaining.totalMs < 3 * 24 * 60 * 60 * 1000;
  const isClosed = remaining.totalMs <= 0;

  if (variant === 'detail') {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0B0A10]/80 p-3.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-[#B8B2C8]">
            <Clock
              className={`h-3.5 w-3.5 ${isUrgent ? 'text-[#FF4E8E]' : 'text-[#FFD166]'}`}
              aria-hidden="true"
            />
            <span>Encerramento das cotas</span>
          </span>
          {isLastDays && (
            <span className="font-semibold text-[#FF7EB3]">
              {isUrgent ? 'Últimas horas' : 'Últimos dias'}
            </span>
          )}
        </div>

        {isClosed ? (
          <p className="mt-2 font-mono text-sm font-semibold text-[#958FA8]">
            Prazo encerrado
          </p>
        ) : (
          <div className="mt-2.5 grid grid-cols-4 gap-2 text-center">
            {[
              {value: remaining.days, label: 'dias'},
              {value: remaining.hours, label: 'horas'},
              {value: remaining.minutes, label: 'min'},
              {value: remaining.seconds, label: 'seg'},
            ].map((unit) => (
              <div
                key={unit.label}
                className="rounded-lg border border-white/10 bg-[#171422] py-1.5"
              >
                <span className="block font-mono text-base font-bold tabular-nums text-white">
                  {pad2(unit.value)}
                </span>
                <span className="block text-[10px] text-[#958FA8]">{unit.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0B0A10]/70 px-3 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5 text-[#A59FB8]">
        <Clock
          className={`h-3.5 w-3.5 shrink-0 ${isUrgent ? 'text-[#FF4E8E]' : 'text-[#FFD166]'}`}
          aria-hidden="true"
        />
        <span>Encerra em</span>
      </span>

      {isClosed ? (
        <span className="font-mono font-semibold text-[#958FA8]">Encerrado</span>
      ) : (
        <div className="flex flex-col items-end">
          {isLastDays && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#FF7EB3]">
              {isUrgent ? 'Últimas horas' : 'Últimos dias'}
            </span>
          )}
          <span
            className={`font-mono font-semibold tabular-nums ${
              isUrgent ? 'text-[#FF7EB3]' : 'text-white'
            }`}
          >
            {remaining.days > 0 ? `${pad2(remaining.days)}d ` : ''}
            {pad2(remaining.hours)}h {pad2(remaining.minutes)}m {pad2(remaining.seconds)}s
          </span>
        </div>
      )}
    </div>
  );
}
