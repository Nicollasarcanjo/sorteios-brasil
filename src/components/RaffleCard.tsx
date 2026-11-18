import React from 'react';
import {ArrowUpRight, Award, Flame} from 'lucide-react';
import {RaffleItem, formatBRL, padTicketNumber} from '../data/raffles';
import {MediaFrame} from './MediaFrame';
import {CountdownTimer} from './CountdownTimer';

interface RaffleCardProps {
  raffle: RaffleItem;
  onSelectRaffle: (slug: string) => void;
}

export function RaffleCard({raffle, onSelectRaffle}: RaffleCardProps) {
  const remaining = Math.max(0, raffle.totalTickets - raffle.soldCount);
  const progressPct = Math.min(
    100,
    Math.round((raffle.soldCount / raffle.totalTickets) * 100),
  );
  const isFinalized = raffle.status === 'finalized';
  const isScarce = !isFinalized && (progressPct >= 75 || remaining <= 25);

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#151220] transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:border-[#FF4E8E]/70 hover:shadow-[0_20px_48px_-16px_rgba(255,78,142,0.22)]">
      <button
        type="button"
        onClick={() => onSelectRaffle(raffle.slug)}
        className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FF4E8E]"
      >
        <MediaFrame src={raffle.image} alt={raffle.title} aspectClass="aspect-[4/3]">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#151220] via-[#151220]/45 to-transparent" />
        </MediaFrame>
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
              <span className="block text-xs text-[#958FA8]">
                Prêmio {formatBRL(raffle.productsTotalValue)}
              </span>
              <span className="font-mono text-sm font-medium tabular-nums text-[#E2DCEB]">
                {raffle.totalTickets.toLocaleString('pt-BR')} cotas
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
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span
                    className={`inline-flex items-center gap-1 font-medium tabular-nums ${
                      isScarce ? 'text-[#FFD166]' : 'text-[#A59FB8]'
                    }`}
                  >
                    {isScarce && <Flame className="h-3.5 w-3.5 text-[#FF4E8E]" aria-hidden="true" />}
                    <span>
                      {isScarce
                        ? `Últimas ${remaining.toLocaleString('pt-BR')} cotas`
                        : `${remaining.toLocaleString('pt-BR')} disponíveis`}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-[#E2DCEB]">{progressPct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="vice-sunset-bar h-full rounded-full transition-all duration-300"
                    style={{width: `${progressPct}%`}}
                  />
                </div>
              </div>

              <CountdownTimer targetDate={raffle.drawTimestamp} variant="card" />
            </>
          )}

          <button
            type="button"
            onClick={() => onSelectRaffle(raffle.slug)}
            className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#0B0A10] transition-colors hover:bg-[#F3E8EE] group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-[#FFE4EF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4E8E]"
          >
            <span>
              {isFinalized ? 'Ver Resultado do Sorteio' : 'Participar e Escolher Números'}
            </span>
            <ArrowUpRight className="h-4 w-4 text-[#C81E65]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}
