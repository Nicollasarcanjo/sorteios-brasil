import React, {useState} from 'react';
import {X, Ticket, ArrowRight, ShieldCheck, Clock, Copy, Check} from 'lucide-react';
import {UserReservation, formatBRL} from '../data/raffles';
import {TicketChips} from './TicketChips';

interface MyTicketsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  reservations: UserReservation[];
  onGoToRaffle: (slug: string) => void;
}

export function MyTicketsDrawer({
  isOpen,
  onClose,
  reservations,
  onGoToRaffle,
}: MyTicketsDrawerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopyPix = async (reservationId: string, brCode: string) => {
    try {
      await navigator.clipboard.writeText(brCode);
      setCopiedId(reservationId);
      setTimeout(() => setCopiedId((prev) => (prev === reservationId ? null : prev)), 2500);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tickets-drawer-title"
    >
      <div className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#12101B] text-[#F5F3F7] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <h2 id="tickets-drawer-title" className="text-lg font-semibold text-white">
              Meus Bilhetes Reservados
            </h2>
            <p className="mt-0.5 text-xs text-[#A59FB8]">
              Comprovantes, pagamentos PIX AbacatePay e números da sua conta
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar meus bilhetes"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-[#B8B2C8] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4E8E]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {reservations.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-12 text-center">
              <Ticket className="mb-3 h-8 w-8 text-[#FF4E8E]/80" aria-hidden="true" />
              <p className="text-base font-semibold text-white">
                Nenhum bilhete reservado ainda
              </p>
              <p className="mt-2 max-w-xs text-sm text-[#A59FB8]">
                Escolha um sorteio na galeria para selecionar seus números da sorte ou reservar cotas populares.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-6 min-h-[40px] rounded-lg bg-white px-5 py-2 text-sm font-semibold text-[#0B0A10] transition-colors hover:bg-[#F3E8EE]"
              >
                Explorar Galeria
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {reservations.map((res) => {
                const isPending = res.status === 'pending_payment';
                const isExpired = res.status === 'expired';
                const isCancelled = res.status === 'cancelled';

                return (
                  <div
                    key={res.id}
                    className={`rounded-xl border p-4 ${
                      isPending
                        ? 'border-[#FFD166]/35 bg-[#1B1723]'
                        : isExpired || isCancelled
                          ? 'border-white/10 bg-[#15121D] opacity-75'
                          : 'border-white/10 bg-[#191526]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="font-mono text-xs text-[#FF7EB3]">
                          Reserva {res.id}
                        </span>
                        <h3 className="mt-1 text-sm font-semibold text-white">
                          {res.raffleTitle}
                        </h3>
                      </div>
                      <span className="font-mono text-sm font-semibold tabular-nums text-white">
                        {formatBRL(res.totalPaid)}
                      </span>
                    </div>

                    <div className="mt-3 text-xs text-[#A59FB8]">
                      <span>{res.buyerName}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{res.numbers.length} cota(s)</span>
                      {res.orderBumpApplied && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span className="text-[#FFD166]">Order Bump ativo</span>
                        </>
                      )}
                      {res.referralCode && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span className="font-mono text-emerald-300">Indicação: {res.referralCode}</span>
                        </>
                      )}
                    </div>

                    <div className="mt-3">
                      <TicketChips
                        numbers={res.numbers}
                        format={(num) => String(num).padStart(4, '0')}
                        maxHeightClass="max-h-36"
                        maxRendered={5000}
                        chipClassName={`rounded border px-2 py-0.5 font-mono text-xs font-medium tabular-nums ${
                          isPending
                            ? 'border-[#FFD166]/40 bg-[#FFD166]/10 text-[#FFE4A0]'
                            : isExpired || isCancelled
                              ? 'border-white/15 bg-white/[0.04] text-[#958FA8] line-through'
                              : 'border-[#FF4E8E]/35 bg-[#FF4E8E]/10 text-[#FFD0E3]'
                        }`}
                      />
                    </div>

                    {isPending && res.paymentBrCode && (
                      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-[#FFD166]/25 bg-[#0B0A10]/70 px-3 py-2">
                        <span className="truncate font-mono text-[11px] text-[#E8E2F0]">
                          {res.paymentBrCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyPix(res.id, res.paymentBrCode!)}
                          className="inline-flex shrink-0 items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
                        >
                          {copiedId === res.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                              <span>Copiado</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" aria-hidden="true" />
                              <span>Copiar PIX</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                      {isPending ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#FFD166]">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Aguardando PIX · AbacatePay</span>
                        </span>
                      ) : isExpired ? (
                        <span className="text-xs font-medium text-amber-300">
                          PIX Expirado
                        </span>
                      ) : isCancelled ? (
                        <span className="text-xs font-medium text-red-300">
                          Reserva Cancelada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Pago via AbacatePay PIX</span>
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onGoToRaffle(res.raffleSlug);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-white hover:text-[#FF7EB3]"
                      >
                        <span>{isPending ? 'Pagar / Verificar' : 'Abrir sorteio'}</span>
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {reservations.length > 0 && (
          <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
            <span className="inline-flex items-center gap-1.5 text-xs text-[#958FA8]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span>Isolamento RLS ativo · visível apenas nesta conta</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
