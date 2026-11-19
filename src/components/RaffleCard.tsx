import React from 'react';
import {ArrowUpRight, Award, Flame} from 'lucide-react';
import {RaffleItem, formatBRL, isRaffleNearSellout, padTicketNumber} from '../data/raffles';
import {MediaFrame} from './MediaFrame';
import {CountdownTimer} from './CountdownTimer';

interface RaffleCardProps {
  raffle: RaffleItem;
  onSelectRaffle: (slug: string) => void;
}

export function RaffleCard({raffle, onSelectRaffle}: RaffleCardProps) {
  const isFinalized = raffle.status === 'finalized';
  const isScarce = isRaffleNearSellout(raffle);

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#151220] transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:border-[#FF4E8E]/70 hover:shadow-[0_20px_48px_-16px_rgba(255,78,142,0.22)]">
      <button
        type="button"
        onClick={() => onSelectRaffle(raffle.slug)}
        className="relative block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FF4E8E]"
      >
        <div className={isFinalized ? 'grayscale opacity-75 transition duration-300 group-hover:opacity-90' : undefined}>
          <MediaFrame src={raffle.image} alt={raffle.title} aspectClass="aspect-[4/3]">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#151220] via-[#151220]/45 to-transparent" />
          </MediaFrame>
        </div>
        {isFinalized && (
          <span className="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white ring-1 ring-white/20 backdrop-blur">
            <Award className="h-3.5 w-3.5 text-[#FFD166]" aria-hidden="true" />
            Finalizado
          </span>
        )}
        {!isFinalized && isScarce && (
          <span className="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-[#B91C42]/95 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-white shadow-lg shadow-[#FF4E8E]/30 ring-1 ring-white/30 backdrop-blur">
            <Flame className="h-3.5 w-3.5 text-[#FFD166]" aria-hidden="true" />
            Poucas cotas disponíveis
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col justify-between p-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-[#B8B2C8]">
            <span className="text-[#FF7EB3]">{raffle.categoryLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{raffle.poolLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{raffle.region}</span>
          </div>

          <h3 className="text-xl font-semibold leading-snug text-white">
            <button
              type="button"
              onClick={() => onSelectRaffle(raffle.slug)}
              className="text-left transition-colors hover:text-[#FF7EB3] focus-visible:outline-none focus-visible:underline"
            >
              {raffle.title}
            </button>
          </h3>

          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#A59FB8]">
            {raffle.subtitle}
          </p>
        </div>

        <div className="mt-6 space-y-4 border-t border-white/10 pt-4">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <span className="block text-xs text-[#958FA8]">Valor por cota</span>
              <span className="font-mono text-2xl font-bold tabular-nums text-white">
                {formatBRL(raffle.ticketPrice)}
              </span>
            </div>
            <div className="text-right">
              <span className="block text-xs text-[#958FA8]">Valor do prêmio</span>
              <span className="font-mono text-sm font-medium tabular-nums text-[#E2DCEB]">
                {formatBRL(raffle.productsTotalValue)}
              </span>
            </div>
          </div>

          {isFinalized ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-[#FFD166]/40 bg-[#FFD166]/10 px-3.5 py-2.5 text-xs text-white">
              <Award className="h-4 w-4 shrink-0 text-[#FFD166]" aria-hidden="true" />
              <span>
                {raffle.winner
                  ? `Ganhador #${padTicketNumber(raffle.winner.winningNumber, raffle.totalTickets)} · ${raffle.winner.buyerDisplayName}`
                  : 'Sorteio encerrado · Apuração em andamento'}
              </span>
            </div>
          ) : (
            <>
              <p
                className={`flex min-h-9 items-center gap-2 text-sm font-semibold ${
                  isScarce ? 'text-[#FFD166]' : 'text-[#B8B2C8]'
                }`}
                role="status"
              >
                {isScarce && <Flame className="h-4 w-4 shrink-0 text-[#FF8B62]" aria-hidden="true" />}
                {isScarce ? 'Reta final · participe agora' : 'Participe antes do encerramento'}
              </p>

              <CountdownTimer targetDate={raffle.drawTimestamp} variant="card" />
            </>
          )}

          <button
            type="button"
            onClick={() => onSelectRaffle(raffle.slug)}
            className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#0B0A10] transition-colors hover:bg-[#F3E8EE] group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-[#FFE4EF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4E8E]"
          >
            <span>
              {isFinalized ? 'Ver Resultado do Sorteio' : 'Escolher quantidade e participar'}
            </span>
            <ArrowUpRight className="h-4 w-4 text-[#C81E65]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}
