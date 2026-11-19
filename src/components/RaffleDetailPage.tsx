import React, {useCallback, useEffect, useState} from 'react';
import {
  ArrowLeft,
  Award,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Flame,
  RefreshCw,
  Tag,
  Trash2,
  UserCheck,
} from 'lucide-react';
import {
  PublicLivePartner,
  RaffleItem,
  UserReservation,
  formatBRL,
  isRaffleNearSellout,
  padTicketNumber,
  sortRafflesUnfinalizedFirst,
} from '../data/raffles';
import {
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  normalizeSocialHandle,
  socialPlatformLabel,
} from '../../shared/social.ts';
import {MediaFrame} from './MediaFrame';
import {WinnerProfile} from './WinnerProfile';
import {PartnerLivesTicker} from './PartnerLivesBar';
import {TicketChips} from './TicketChips';
import {CountdownTimer} from './CountdownTimer';

interface RaffleDetailPageProps {
  raffle: RaffleItem;
  allRaffles: RaffleItem[];
  initialPendingReservation?: UserReservation | null;
  onBackToGallery: () => void;
  onSelectOtherRaffle: (slug: string) => void;
  onReservationCreated: (reservation: UserReservation, updatedRaffle?: RaffleItem | null) => void;
  onOpenMyTickets: () => void;
  /** Parceiros ao vivo, exibidos no topo da página (mesma lista da home). */
  livePartners?: PublicLivePartner[];
}

function formatCpfInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

export function RaffleDetailPage({
  raffle,
  allRaffles,
  initialPendingReservation = null,
  onBackToGallery,
  onSelectOtherRaffle,
  onReservationCreated,
  onOpenMyTickets,
  livePartners = [],
}: RaffleDetailPageProps) {
  const [selectedQuantity, setSelectedQuantity] = useState(0);
  const [selectionFeedback, setSelectionFeedback] = useState<string | null>(null);
  const [orderBumpSelected, setOrderBumpSelected] = useState(false);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerTaxId, setBuyerTaxId] = useState('');
  const [buyerSocialPlatform, setBuyerSocialPlatform] = useState<SocialPlatform>('instagram');
  const [buyerSocialHandle, setBuyerSocialHandle] = useState('');
  const [referralInput, setReferralInput] = useState('');
  const [appliedReferral, setAppliedReferral] = useState<{
    code: string;
    promoterLabel: string;
  } | null>(null);
  const [referralStatus, setReferralStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [validatingReferral, setValidatingReferral] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeReservation, setActiveReservation] = useState<UserReservation | null>(
    initialPendingReservation,
  );
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [simulatingPayment, setSimulatingPayment] = useState(false);
  const [paymentActionMessage, setPaymentActionMessage] = useState<string | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);
  const [pixRemainingSec, setPixRemainingSec] = useState<number | null>(null);

  const validateAndApplyReferral = async (rawCode: string) => {
    const clean = rawCode.trim().toUpperCase();
    if (!clean) {
      setAppliedReferral(null);
      setReferralStatus(null);
      return;
    }
    setValidatingReferral(true);
    setReferralStatus(null);
    try {
      const res = await fetch(`/api/referrals/validate?code=${encodeURIComponent(clean)}`);
      const data = await res.json();
      if (data.valid && data.code) {
        setAppliedReferral({
          code: data.code,
          promoterLabel: data.promoterLabel || 'Parceiro Lucky Sorteios',
        });
        setReferralInput(data.code);
        setReferralStatus({
          ok: true,
          message: `Código ${data.code} aplicado · Indicação de ${data.promoterLabel || 'Parceiro'}.`,
        });
      } else {
        setAppliedReferral(null);
        setReferralStatus({
          ok: false,
          message: 'Código de indicação não encontrado ou inativo.',
        });
      }
    } catch {
      setReferralStatus({
        ok: false,
        message: 'Não foi possível validar o código agora.',
      });
    } finally {
      setValidatingReferral(false);
    }
  };

  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const hashQuery = window.location.hash.includes('?')
        ? new URLSearchParams(window.location.hash.split('?')[1])
        : null;
      const refParam = searchParams.get('ref') || hashQuery?.get('ref');
      if (refParam && refParam.trim().length >= 3) {
        void validateAndApplyReferral(refParam);
      }
    } catch {
      // Ignore URL parse errors
    }
  }, []);

  const totalSold = raffle.soldCount;
  const remainingCount = Math.max(0, raffle.totalTickets - totalSold);
  const isScarce = isRaffleNearSellout(raffle);
  const isCentPricedHighVolume = raffle.ticketPrice < 1 && raffle.totalTickets >= 1_000;
  const quantityOptions = isCentPricedHighVolume
    ? [10, 50, 100, 500, 1_000]
    : [1, 5, 10, 50, 100];
  const isFinalized = raffle.status === 'finalized';

  const remainingAfterSelection = Math.max(0, remainingCount - selectedQuantity);
  const effectiveBumpCount = Math.min(raffle.orderBumpCount, remainingAfterSelection);
  const canApplyOrderBump = selectedQuantity > 0 && effectiveBumpCount > 0;
  const activeBumpCount = canApplyOrderBump && orderBumpSelected ? effectiveBumpCount : 0;

  const bumpOriginalPrice = effectiveBumpCount * raffle.ticketPrice;
  const bumpDiscountedPrice =
    bumpOriginalPrice * (1 - raffle.orderBumpDiscountPct / 100);

  const addRandomNumbers = (qty: number) => {
    if (isFinalized) return;
    setSelectionFeedback(null);
    const quantityToAdd = Math.min(qty, Math.max(0, remainingCount - selectedQuantity));
    if (quantityToAdd === 0) {
      setSelectionFeedback('Não há novas cotas para adicionar.');
      return;
    }
    setSelectedQuantity((prev) => prev + quantityToAdd);
  };

  const minTickets = Math.max(1, raffle.minTicketsPerPurchase ?? 1);
  const belowMinimum = selectedQuantity < minTickets;
  const baseCost = selectedQuantity * raffle.ticketPrice;
  const bumpCost = activeBumpCount > 0 ? bumpDiscountedPrice : 0;
  const totalCost = baseCost + bumpCost;
  const totalSelectedWithBump = selectedQuantity + activeBumpCount;

  const getBuyerHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {};
    try {
      const token = window.localStorage.getItem('leonida_buyer_bearer_v1') || '';
      if (token) headers['X-Buyer-Token'] = token;
    } catch {
      // Ignore
    }
    return headers;
  }, []);

  const checkPaymentStatus = useCallback(
    async (reservationId: string, manual = false) => {
      if (manual) setCheckingPayment(true);
      try {
        const res = await fetch(`/api/payments/${encodeURIComponent(reservationId)}/status`, {
          credentials: 'include',
          headers: getBuyerHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.reservation) {
          setActiveReservation(data.reservation as UserReservation);
          onReservationCreated(
            data.reservation as UserReservation,
            (data.raffle as RaffleItem | null) ?? undefined,
          );
          if (manual && !data.confirmed) {
            setPaymentActionMessage(
              'Pagamento ainda pendente na AbacatePay. Assim que o PIX compensar, confirmaremos automaticamente.',
            );
          } else if (data.confirmed) {
            setPaymentActionMessage(null);
          }
        }
      } catch {
        // Ignore transient poll errors
      } finally {
        if (manual) setCheckingPayment(false);
      }
    },
    [getBuyerHeaders, onReservationCreated],
  );

  useEffect(() => {
    if (!activeReservation && initialPendingReservation) {
      setActiveReservation(initialPendingReservation);
    }
  }, [activeReservation, initialPendingReservation]);

  // Assim que a cobrança PIX aparece, rola a tela até ela (QR + copia e cola sempre à vista).
  const pendingPixId =
    activeReservation?.status === 'pending_payment' ? activeReservation.id : null;
  useEffect(() => {
    if (!pendingPixId) return;
    const t = window.setTimeout(() => {
      document.getElementById('pix-payment')?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }, 80);
    return () => window.clearTimeout(t);
  }, [pendingPixId]);

  useEffect(() => {
    if (
      !activeReservation ||
      activeReservation.status !== 'pending_payment' ||
      !activeReservation.paymentExpiresAt
    ) {
      setPixRemainingSec(null);
      return;
    }
    const updateCountdown = () => {
      const diffMs = Date.parse(activeReservation.paymentExpiresAt!) - Date.now();
      setPixRemainingSec(Math.max(0, Math.floor(diffMs / 1000)));
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [activeReservation]);

  useEffect(() => {
    if (!activeReservation || activeReservation.status !== 'pending_payment') return;
    void checkPaymentStatus(activeReservation.id, false);
    const interval = window.setInterval(() => {
      void checkPaymentStatus(activeReservation.id, false);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [activeReservation, checkPaymentStatus]);

  const handleSimulateSandboxPayment = async () => {
    if (!activeReservation) return;
    setSimulatingPayment(true);
    setPaymentActionMessage(null);
    try {
      const res = await fetch(
        `/api/payments/${encodeURIComponent(activeReservation.id)}/simulate`,
        {
          method: 'POST',
          credentials: 'include',
          headers: getBuyerHeaders(),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setPaymentActionMessage(data.error || 'Erro ao simular pagamento no Modo Teste.');
        return;
      }
      if (data.reservation) {
        setActiveReservation(data.reservation as UserReservation);
        onReservationCreated(
          data.reservation as UserReservation,
          (data.raffle as RaffleItem | null) ?? undefined,
        );
      }
    } catch {
      setPaymentActionMessage('Erro de conexão ao simular pagamento.');
    } finally {
      setSimulatingPayment(false);
    }
  };

  const handleConfirmCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (buyerName.trim().length < 3) {
      setFormError('Informe seu nome completo para registrar os bilhetes.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) {
      setFormError('Informe um e-mail válido para emissão do pagamento AbacatePay.');
      return;
    }
    if (buyerPhone.replace(/\D/g, '').length < 10) {
      setFormError('Informe um WhatsApp ou celular válido com DDD.');
      return;
    }
    if (!normalizeSocialHandle(buyerSocialPlatform, buyerSocialHandle)) {
      setFormError(
        `Informe um @ válido do seu ${socialPlatformLabel(buyerSocialPlatform)} (ex.: @seuusuario).`,
      );
      return;
    }
    if (buyerTaxId.replace(/\D/g, '').length !== 11) {
      setFormError('Informe seu CPF com 11 dígitos para gerar o PIX.');
      return;
    }
    if (belowMinimum) {
      setFormError(
        minTickets > 1
          ? `A compra mínima neste sorteio é de ${minTickets} cotas.`
          : 'Selecione pelo menos uma cota antes de finalizar.',
      );
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setPaymentActionMessage(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...getBuyerHeaders(),
      };

      const referralToSend = appliedReferral?.code || referralInput.trim().toUpperCase();
      const res = await fetch('/api/reservations', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          raffleId: raffle.id,
          quantity: selectedQuantity,
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim(),
          buyerPhone: buyerPhone.trim(),
          buyerTaxId: buyerTaxId.trim(),
          buyerSocialPlatform,
          buyerSocialHandle: normalizeSocialHandle(buyerSocialPlatform, buyerSocialHandle) ?? '',
          applyOrderBump: activeBumpCount > 0,
          ...(referralToSend ? {referralCode: referralToSend} : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Não foi possível gerar a cobrança PIX.');
        return;
      }

      if (data.buyerToken) {
        try {
          window.localStorage.setItem('leonida_buyer_bearer_v1', data.buyerToken);
        } catch {
          // Ignore
        }
      }

      onReservationCreated(data.reservation as UserReservation, data.raffle as RaffleItem);
      setActiveReservation(data.reservation as UserReservation);
      setSelectedQuantity(0);
      setOrderBumpSelected(false);
      setCheckoutOpen(false);
    } catch {
      setFormError('Erro de conexão ao gerar pagamento AbacatePay.');
    } finally {
      setSubmitting(false);
    }
  };

  const relatedRaffles = sortRafflesUnfinalizedFirst(
    allRaffles.filter((item) => item.id !== raffle.id),
  ).slice(0, 3);

  const openCheckout = () => {
    setCheckoutOpen(true);
    window.setTimeout(() => {
      document.getElementById('checkout-form')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 100);
  };

  return (
    <main className="mx-auto max-w-7xl px-3 pb-32 pt-4 sm:px-6 sm:py-8 lg:px-8 lg:py-12">
      <div className="mb-4 flex items-center justify-between gap-4 border-b border-white/10 pb-3 sm:mb-8 sm:pb-5">
        <button
          type="button"
          onClick={onBackToGallery}
          className="inline-flex min-h-[40px] items-center gap-2 text-sm font-semibold text-[#B8B2C8] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4E8E]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Voltar aos sorteios</span>
        </button>

        <div className="hidden sm:block">
          <PartnerLivesTicker partners={livePartners} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start lg:gap-8">
        <div className="contents">
          <div className="order-1 overflow-hidden rounded-2xl border border-white/10 bg-[#11131A] shadow-[0_18px_60px_rgba(0,0,0,0.28)] lg:col-span-7">
            <MediaFrame
              src={raffle.image}
              alt={raffle.title}
              aspectClass="aspect-[16/10] sm:aspect-[16/10] lg:aspect-[4/3]"
            >
              <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/75 to-transparent p-3 sm:p-4">
                <span className="rounded-full border border-white/20 bg-black/50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-sm">
                  GTA VI · Leonida
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${
                    isFinalized
                      ? 'bg-white/15 text-white'
                      : 'bg-[#7FE5D7] text-[#11131A]'
                  }`}
                >
                  {isFinalized ? 'Encerrado' : 'Sorteio ativo'}
                </span>
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8 sm:px-5 sm:pb-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#FF8EB8]">
                  {raffle.region}
                </p>
              </div>
            </MediaFrame>
          </div>

          <details className="order-3 rounded-xl border border-white/10 bg-[#11131A] px-4 py-3 lg:col-span-7">
            <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-white marker:hidden">
              Sobre o sorteio
              <span className="text-lg leading-none text-[#7FE5D7]">+</span>
            </summary>
            <p className="max-w-2xl pb-2 pt-3 text-sm leading-relaxed text-[#C6C0D4]">
              {raffle.description}
            </p>
          </details>

          <details className="order-4 rounded-xl border border-white/10 bg-[#11131A] px-4 py-3 lg:col-span-7">
            <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-white marker:hidden">
              Prêmios inclusos
              <span className="text-lg leading-none text-[#7FE5D7]">+</span>
            </summary>
            <p className="pt-2 text-xs font-semibold text-[#F3C86A]">
              Valor total: {formatBRL(raffle.productsTotalValue)}
            </p>
            <ul className="mt-2 divide-y divide-white/10 border-y border-white/10">
              {raffle.products.map((product) => (
                <li
                  key={product.name}
                  className="flex items-center justify-between gap-4 py-3 text-sm text-[#D6D1E2]"
                >
                  <span className="flex items-start gap-3">
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-[#7FE5D7]"
                      aria-hidden="true"
                    />
                    <span>{product.name}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-[#B8B2C8]">
                    {formatBRL(product.retailPrice)}
                  </span>
                </li>
              ))}
            </ul>
          </details>

          <details id="raffle-rules" className="order-5 rounded-xl border border-white/10 bg-[#11131A] px-4 py-3 lg:col-span-7">
            <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-white marker:hidden">
              Regras e data do sorteio
              <span className="text-lg leading-none text-[#7FE5D7]">+</span>
            </summary>
            <p className="pb-3 pt-3 text-sm leading-relaxed text-[#B8B2C8]">
              {raffle.drawRule}
            </p>
            <div className="grid grid-cols-1 gap-3 border-t border-white/10 pt-3 sm:grid-cols-2">
              <div>
                <span className="block text-xs text-[#958FA8]">Modalidade</span>
                <span className="mt-1 block text-sm font-semibold text-white">
                  {raffle.poolLabel}
                </span>
              </div>
              <div>
                <span className="block text-xs text-[#958FA8]">Previsão</span>
                <span className="mt-1 block text-sm font-semibold text-white">
                  {raffle.drawDate}
                </span>
              </div>
            </div>
          </details>
        </div>

        <aside className="order-2 lg:sticky lg:top-24 lg:col-span-5 lg:row-span-4">
          <div className="rounded-2xl border border-white/15 bg-gradient-to-b from-[#171A22] to-[#101116] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.32)] sm:p-6">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#B8B2C8]">
              <span className="text-[#FF8EB8]">{raffle.categoryLabel}</span>
            </div>

            <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-wide text-white sm:text-4xl">
              {raffle.title}
            </h1>
            <p className="mt-2 hidden text-sm leading-relaxed text-[#B8B2C8] sm:block">
              {raffle.subtitle}
            </p>

            {isFinalized ? (
              <div className="mt-6 rounded-xl border border-[#FFD166]/45 bg-[#FFD166]/10 p-5">
                <div className="flex items-center gap-2.5 text-[#FFD166]">
                  <Award className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-white">
                    {raffle.winner ? 'Sorteio Finalizado · Ganhador Oficial' : 'Vendas Encerradas'}
                  </h2>
                </div>
                {raffle.winner ? (
                  <div className="mt-4 space-y-4 text-sm text-[#E2DCEB]">
                    <WinnerProfile winner={raffle.winner} />
                    <p>
                      Número contemplado:{' '}
                      <span className="font-mono text-lg font-bold text-[#FFD166]">
                        #{padTicketNumber(raffle.winner.winningNumber, raffle.totalTickets)}
                      </span>
                    </p>
                    <p className="text-xs text-[#A59FB8]">
                      Declarado em {new Date(raffle.winner.declaredAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[#C6C0D4]">
                    As reservas deste sorteio foram encerradas e a apuração será publicada em instantes.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="mt-5">
                  <CountdownTimer targetDate={raffle.drawTimestamp} variant="detail" />
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-y border-white/10 py-3">
                  <div>
                    <span className="block text-xs text-[#958FA8]">Cada número</span>
                    <span className="font-mono text-3xl font-bold tabular-nums text-white">
                      {formatBRL(raffle.ticketPrice)}
                    </span>
                  </div>
                  <div
                    className={`inline-flex max-w-[58%] items-center justify-end gap-1.5 text-right text-xs font-extrabold ${
                      isScarce
                        ? 'rounded-lg border border-[#FF8B62]/50 bg-[#FF4E8E]/10 px-3 py-2 text-[#FFD166]'
                        : 'text-[#7FE5D7]'
                    }`}
                    role="status"
                  >
                    {isScarce && <Flame className="h-4 w-4 shrink-0 text-[#FF8B62]" aria-hidden="true" />}
                    <span>
                      {isScarce
                        ? 'Poucas cotas disponíveis'
                        : 'Garanta sua cota antes que esgote'}
                    </span>
                  </div>
                </div>

                {activeReservation ? (
                  activeReservation.status === 'confirmed' ? (
                    <div className="mt-6 rounded-xl border border-emerald-400/35 bg-emerald-950/25 p-5">
                      <div className="flex items-center gap-2.5 text-emerald-300">
                        <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
                        <h2 className="text-base font-semibold text-white">
                          Pagamento Confirmado · Reserva {activeReservation.id}
                        </h2>
                      </div>
                      <p className="mt-2 text-sm text-[#C6C0D4]">
                        PIX confirmado via <strong className="text-white">AbacatePay</strong>! Seus{' '}
                        {activeReservation.numbers.length} número(s) estão vinculados a{' '}
                        <strong className="text-white">{activeReservation.buyerName}</strong>.
                        {activeReservation.orderBumpApplied && (
                          <span className="mt-1 block text-xs text-[#FFD166]">
                            Inclui cotas extras promocionais do Order Bump com {raffle.orderBumpDiscountPct}% OFF.
                          </span>
                        )}
                        {activeReservation.referralCode && (
                          <span className="mt-1 block text-xs text-emerald-300">
                            Código de indicação vinculado:{' '}
                            <strong className="font-mono">{activeReservation.referralCode}</strong>
                          </span>
                        )}
                      </p>

                      <div className="mt-4">
                        <TicketChips
                          numbers={activeReservation.numbers}
                          format={(num) => padTicketNumber(num, raffle.totalTickets)}
                          label="Suas cotas"
                          maxHeightClass="max-h-48"
                          chipClassName="rounded border border-[#FF4E8E]/40 bg-[#FF4E8E]/15 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-white"
                        />
                      </div>

                      <div className="mt-5 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={onOpenMyTickets}
                          className="min-h-[42px] flex-1 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#0B0A10] hover:bg-[#F3E8EE]"
                        >
                          Ver Meus Bilhetes
                        </button>
                        {activeReservation.paymentReceiptUrl && (
                          <a
                            href={activeReservation.paymentReceiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[42px] items-center justify-center rounded-lg border border-emerald-400/35 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/15"
                          >
                            Comprovante AbacatePay
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveReservation(null);
                            setPaymentActionMessage(null);
                          }}
                          className="min-h-[42px] rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
                        >
                          Escolher Mais
                        </button>
                      </div>
                    </div>
                  ) : activeReservation.status === 'expired' || activeReservation.status === 'cancelled' ? (
                    <div className="mt-6 rounded-xl border border-red-400/35 bg-red-950/25 p-5">
                      <h2 className="text-base font-semibold text-white">
                        PIX Expirado · Reserva {activeReservation.id}
                      </h2>
                      <p className="mt-2 text-sm text-[#C6C0D4]">
                        O prazo de pagamento expirou e os números voltaram para o painel. Você pode gerar uma nova cobrança quando quiser.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveReservation(null);
                          setPaymentActionMessage(null);
                        }}
                        className="mt-4 min-h-[42px] w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#0B0A10] hover:bg-[#F3E8EE]"
                      >
                        Selecionar Números Novamente
                      </button>
                    </div>
                  ) : (
                    <div id="pix-payment" className="mt-6 scroll-mt-20 rounded-xl border border-[#FF4E8E]/40 bg-[#0B0A10] p-5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[#FFD166]">
                          <Clock className="h-5 w-5 shrink-0" aria-hidden="true" />
                          <h2 className="text-base font-semibold text-white">
                            Pague o PIX para confirmar ({activeReservation.id})
                          </h2>
                        </div>
                        <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                          AbacatePay
                        </span>
                      </div>

                      <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-emerald-400/25 bg-emerald-950/20 px-3 py-2 text-[11px]">
                        <span className="inline-flex items-center gap-2 font-medium text-emerald-300">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
                          <span>Confirmação de pagamento ativa (3s)</span>
                        </span>
                        {pixRemainingSec !== null && (
                          <span className="font-mono font-semibold tabular-nums text-[#FFD166]">
                            {String(Math.floor(pixRemainingSec / 60)).padStart(2, '0')}:
                            {String(pixRemainingSec % 60).padStart(2, '0')}
                          </span>
                        )}
                      </div>

                      <p className="mt-2.5 text-xs leading-relaxed text-[#C6C0D4]">
                        Escaneie o QR Code ou copie o código PIX abaixo no valor de{' '}
                        <strong className="font-mono text-white">
                          {formatBRL(activeReservation.totalPaid)}
                        </strong>
                        . Suas {activeReservation.numbers.length} cota(s) confirmam automaticamente nesta tela assim que o PIX compensar.
                      </p>

                      {activeReservation.paymentBrCodeBase64 && (
                        <div className="mt-4 flex justify-center">
                          <div className="rounded-xl bg-white p-3">
                            <img
                              src={activeReservation.paymentBrCodeBase64}
                              alt={`QR Code PIX AbacatePay para reserva ${activeReservation.id}`}
                              className="h-44 w-44 object-contain"
                            />
                          </div>
                        </div>
                      )}

                      {activeReservation.paymentBrCode && (
                        <div className="mt-4 rounded-lg border border-white/10 bg-[#14111D] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-[#958FA8]">
                              PIX Copia e Cola ({formatBRL(activeReservation.totalPaid)})
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(activeReservation.paymentBrCode || '');
                                setCopiedPix(true);
                                setTimeout(() => setCopiedPix(false), 2000);
                              }}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-[#FF7EB3] hover:text-white"
                            >
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>{copiedPix ? 'Copiado' : 'Copiar PIX'}</span>
                            </button>
                          </div>
                          <p className="mt-1.5 truncate font-mono text-[11px] text-[#8E87A3]">
                            {activeReservation.paymentBrCode}
                          </p>
                        </div>
                      )}

                      <div className="mt-4">
                        <TicketChips
                          numbers={activeReservation.numbers}
                          format={(num) => padTicketNumber(num, raffle.totalTickets)}
                          label="Cotas reservadas"
                          maxHeightClass="max-h-32"
                          chipClassName="rounded border border-white/15 bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[#D6D1E2]"
                        />
                      </div>

                      {paymentActionMessage && (
                        <p className="mt-3 text-xs text-[#FFD166]">{paymentActionMessage}</p>
                      )}

                      <div className="mt-4 flex flex-col gap-2.5">
                        <button
                          type="button"
                          disabled={checkingPayment}
                          onClick={() => void checkPaymentStatus(activeReservation.id, true)}
                          className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-bold text-[#0B0A10] hover:bg-[#F3E8EE] disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${checkingPayment ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                          <span>
                            {checkingPayment ? 'Consultando AbacatePay...' : 'Já paguei · Verificar agora'}
                          </span>
                        </button>

                        {activeReservation.paymentDevMode && (
                          <button
                            type="button"
                            disabled={simulatingPayment}
                            onClick={() => void handleSimulateSandboxPayment()}
                            className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {simulatingPayment
                                ? 'Simulando na AbacatePay...'
                                : 'Simular Pagamento PIX (Modo Teste)'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  )
                ) : (
                  <>
                    <div className="mt-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-base font-bold text-white">Escolha suas cotas</h2>
                          <p className="mt-1 text-xs text-[#958FA8]">
                            Escolha a quantidade; os números serão aleatórios.
                          </p>
                        </div>
                        {selectedQuantity > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedQuantity(0);
                              setOrderBumpSelected(false);
                            }}
                            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#A59FB8] hover:text-white"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Limpar</span>
                          </button>
                        )}
                      </div>
                      {minTickets > 1 && (
                        <p className="mt-2 text-[11px] font-semibold text-[#F3C86A]">
                          Mínimo {minTickets} cotas · {formatBRL(minTickets * raffle.ticketPrice)}
                        </p>
                      )}

                      <div className="mt-3 grid grid-cols-5 gap-1.5">
                        {quantityOptions.map((qty) => (
                          <button
                            key={qty}
                            type="button"
                            onClick={() => addRandomNumbers(qty)}
                            aria-label={`Adicionar ${qty.toLocaleString('pt-BR')} ${qty === 1 ? 'cota aleatória' : 'cotas aleatórias'}`}
                            className="flex min-h-[58px] min-w-0 flex-col items-center justify-center rounded-xl border border-white/15 bg-[#20212A] px-1 py-2 text-white transition-colors hover:border-[#7FE5D7]/70 hover:bg-[#7FE5D7]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7FE5D7]"
                          >
                            <span className="font-mono text-[11px] font-bold tabular-nums sm:text-base">
                              +{qty.toLocaleString('pt-BR')}
                            </span>
                            <span className="text-[9px] text-[#A9A7B4]">
                              {qty === 1 ? 'cota' : 'cotas'}
                            </span>
                          </button>
                        ))}
                      </div>

                      {selectionFeedback && (
                        <p className="mt-2.5 text-xs text-[#FFD166]" role="status">
                          {selectionFeedback}
                        </p>
                      )}

                      {selectedQuantity > 0 && (
                        <div className="mt-4 rounded-xl border border-white/10 bg-[#0B0A10]/70 p-3.5">
                          <span className="block text-xs font-medium text-[#A59FB8]">
                            {selectedQuantity}{' '}
                            {selectedQuantity === 1
                              ? 'cota aleatória selecionada'
                              : 'cotas aleatórias selecionadas'}
                          </span>
                          <p className="mt-1 text-[11px] text-[#958FA8]">
                            Os números são gerados automaticamente.
                          </p>
                        </div>
                      )}
                    </div>

                    {canApplyOrderBump && (
                      <div className="mt-5">
                        <label
                          htmlFor="order-bump-toggle"
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border border-dashed p-4 transition-colors ${
                            orderBumpSelected
                              ? 'border-[#FFD166] bg-[#FFD166]/10'
                              : 'border-[#FFD166]/45 bg-[#FFD166]/[0.04] hover:border-[#FFD166]/80'
                          }`}
                        >
                          <input
                            id="order-bump-toggle"
                            type="checkbox"
                            checked={orderBumpSelected}
                            onChange={(e) => setOrderBumpSelected(e.target.checked)}
                            className="mt-1 h-4 w-4 shrink-0 accent-[#FF4E8E]"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#FFD166]">
                                <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Oferta Exclusiva · {raffle.orderBumpDiscountPct}% OFF</span>
                              </span>
                              <span className="font-mono text-xs font-semibold tabular-nums text-white">
                                +{formatBRL(bumpDiscountedPrice)}
                              </span>
                            </div>
                            <p className="mt-1 text-sm font-semibold text-white">
                              Adicionar +{effectiveBumpCount} cotas extras aleatórias neste sorteio
                            </p>
                            <p className="mt-0.5 text-xs text-[#B8B2C8]">
                              De{' '}
                              <span className="font-mono line-through">
                                {formatBRL(bumpOriginalPrice)}
                              </span>{' '}
                              por apenas{' '}
                              <span className="font-mono font-semibold text-[#FFD166]">
                                {formatBRL(bumpDiscountedPrice)}
                              </span>{' '}
                              adicionais no seu pedido.
                            </p>
                          </div>
                        </label>
                      </div>
                    )}

                    <div className="mt-6 border-t border-white/10 pt-5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-[#A59FB8]">
                          Total a pagar ({totalSelectedWithBump}{' '}
                          {totalSelectedWithBump === 1 ? 'cota' : 'cotas'})
                        </span>
                        <span className="font-mono text-2xl font-bold tabular-nums text-white">
                          {formatBRL(totalCost)}
                        </span>
                      </div>

                      {!checkoutOpen ? (
                        <button
                          type="button"
                          disabled={belowMinimum}
                          onClick={openCheckout}
                          className="mt-5 flex min-h-[50px] w-full items-center justify-center rounded-xl bg-[#7FE5D7] px-6 py-3 text-sm font-extrabold text-[#101318] transition-all hover:bg-[#A6F3E8] disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7FE5D7]"
                        >
                          {belowMinimum
                            ? minTickets > 1
                              ? `Compra mínima: ${minTickets} cotas (faltam ${minTickets - selectedQuantity})`
                              : 'Escolha uma quantidade'
                            : `Reservar ${totalSelectedWithBump} ${totalSelectedWithBump === 1 ? 'Cota' : 'Cotas'} · ${formatBRL(totalCost)}`}
                        </button>
                      ) : (
                        <form id="checkout-form" onSubmit={handleConfirmCheckout} className="mt-5 space-y-3 border-t border-white/10 pt-4">
                          <div>
                            <label
                              htmlFor="buyer-name"
                              className="mb-1 block text-xs font-medium text-[#C6C0D4]"
                            >
                              Nome completo
                            </label>
                            <input
                              id="buyer-name"
                              type="text"
                              required
                              value={buyerName}
                              onChange={(e) => setBuyerName(e.target.value)}
                              placeholder="Seu nome completo"
                              className="min-h-[42px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white placeholder:text-[#7D7692] focus:border-[#FF4E8E] focus:outline-none"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="buyer-email"
                              className="mb-1 block text-xs font-medium text-[#C6C0D4]"
                            >
                              E-mail
                            </label>
                            <input
                              id="buyer-email"
                              type="email"
                              required
                              value={buyerEmail}
                              onChange={(e) => setBuyerEmail(e.target.value)}
                              placeholder="voce@email.com"
                              className="min-h-[42px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white placeholder:text-[#7D7692] focus:border-[#FF4E8E] focus:outline-none"
                            />
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label
                                htmlFor="buyer-phone"
                                className="mb-1 block text-xs font-medium text-[#C6C0D4]"
                              >
                                WhatsApp / Celular
                              </label>
                              <input
                                id="buyer-phone"
                                type="tel"
                                required
                                value={buyerPhone}
                                onChange={(e) => setBuyerPhone(formatPhoneInput(e.target.value))}
                                placeholder="(11) 99999-9999"
                                className="min-h-[42px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white placeholder:text-[#7D7692] focus:border-[#FF4E8E] focus:outline-none"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor="buyer-cpf"
                                className="mb-1 block text-xs font-medium text-[#C6C0D4]"
                              >
                                CPF (para emissão PIX)
                              </label>
                              <input
                                id="buyer-cpf"
                                type="text"
                                inputMode="numeric"
                                required
                                value={buyerTaxId}
                                onChange={(e) => setBuyerTaxId(formatCpfInput(e.target.value))}
                                placeholder="000.000.000-00"
                                className="min-h-[42px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 font-mono text-sm text-white placeholder:font-sans placeholder:text-[#7D7692] focus:border-[#FF4E8E] focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label
                              htmlFor="buyer-social"
                              className="mb-1 block text-xs font-medium text-[#C6C0D4]"
                            >
                              Sua rede social
                            </label>
                            <div className="flex gap-2">
                              <select
                                aria-label="Rede social"
                                value={buyerSocialPlatform}
                                onChange={(e) => setBuyerSocialPlatform(e.target.value as SocialPlatform)}
                                className="min-h-[42px] shrink-0 rounded-lg border border-white/15 bg-[#0B0A10] px-2.5 text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                              >
                                {SOCIAL_PLATFORMS.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.label}
                                  </option>
                                ))}
                              </select>
                              <div className="relative min-w-0 flex-1">
                                <span
                                  aria-hidden="true"
                                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#7D7692]"
                                >
                                  @
                                </span>
                                <input
                                  id="buyer-social"
                                  type="text"
                                  required
                                  autoCapitalize="none"
                                  autoCorrect="off"
                                  spellCheck={false}
                                  value={buyerSocialHandle}
                                  onChange={(e) => setBuyerSocialHandle(e.target.value.replace(/^@+/, ''))}
                                  placeholder="seuusuario"
                                  className="min-h-[42px] w-full rounded-lg border border-white/15 bg-[#0B0A10] pl-7 pr-3 text-sm text-white placeholder:text-[#7D7692] focus:border-[#FF4E8E] focus:outline-none"
                                />
                              </div>
                            </div>
                            <p className="mt-1 text-[11px] leading-relaxed text-[#958FA8]">
                              Se você ganhar, seu nome, sua foto de perfil e seu @ aparecem na página do sorteio.
                            </p>
                          </div>

                          <div>
                            <label
                              htmlFor="referral-code"
                              className="mb-1 block text-xs font-medium text-[#C6C0D4]"
                            >
                              Código de indicação (opcional)
                            </label>
                            <div className="flex gap-2">
                              <input
                                id="referral-code"
                                type="text"
                                value={referralInput}
                                onChange={(e) => {
                                  const next = e.target.value.toUpperCase();
                                  setReferralInput(next);
                                  if (appliedReferral && next.trim() !== appliedReferral.code) {
                                    setAppliedReferral(null);
                                  }
                                  if (!next.trim()) {
                                    setReferralStatus(null);
                                  }
                                }}
                                placeholder="Digite o código de indicação"
                                className="min-h-[42px] flex-1 rounded-lg border border-white/15 bg-[#0B0A10] px-3 font-mono text-xs uppercase text-white placeholder:font-sans placeholder:normal-case placeholder:text-[#7D7692] focus:border-[#FF4E8E] focus:outline-none"
                              />
                              {appliedReferral ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAppliedReferral(null);
                                    setReferralInput('');
                                    setReferralStatus(null);
                                  }}
                                  className="min-h-[42px] rounded-lg border border-white/15 px-3 text-xs font-medium text-[#C6C0D4] hover:bg-white/10 hover:text-white"
                                >
                                  Remover
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={validatingReferral || referralInput.trim().length < 3}
                                  onClick={() => void validateAndApplyReferral(referralInput)}
                                  className="min-h-[42px] rounded-lg border border-white/15 bg-white/[0.06] px-3.5 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-45"
                                >
                                  {validatingReferral ? 'Validando...' : 'Aplicar'}
                                </button>
                              )}
                            </div>
                            {referralStatus && (
                              <p
                                className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-medium ${
                                  referralStatus.ok ? 'text-emerald-300' : 'text-[#FF7EB3]'
                                }`}
                              >
                                <UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span>{referralStatus.message}</span>
                              </p>
                            )}
                          </div>

                          {formError && (
                            <p className="text-xs font-medium text-[#FF7EB3]">{formError}</p>
                          )}

                          <div className="flex gap-2.5 pt-1">
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => {
                                setCheckoutOpen(false);
                                setFormError(null);
                              }}
                              className="min-h-[44px] rounded-xl border border-white/15 px-4 text-sm font-medium text-[#C6C0D4] hover:bg-white/10 hover:text-white"
                            >
                              Voltar
                            </button>
                            <button
                              type="submit"
                              disabled={submitting}
                              className="min-h-[44px] flex-1 rounded-xl bg-white px-4 text-sm font-bold text-[#0B0A10] hover:bg-[#F3E8EE] disabled:opacity-50"
                            >
                              {submitting ? 'Gerando PIX...' : 'Gerar PIX'}
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {!isFinalized && !activeReservation && !checkoutOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#0B0D11]/95 shadow-[0_-12px_40px_rgba(0,0,0,0.38)] backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-3 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[11px] text-[#A9A7B4]">
                {selectedQuantity}{' '}
                {selectedQuantity === 1 ? 'cota selecionada' : 'cotas selecionadas'}
              </span>
              <span className="block font-mono text-lg font-bold tabular-nums text-white">
                {formatBRL(totalCost)}
              </span>
            </div>
            <button
              type="button"
              disabled={belowMinimum}
              onClick={openCheckout}
              className="min-h-[48px] shrink-0 rounded-xl bg-[#7FE5D7] px-5 text-sm font-extrabold text-[#101318] transition-colors hover:bg-[#A6F3E8] disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/50"
            >
              {belowMinimum
                ? minTickets > 1
                  ? `Faltam ${minTickets - selectedQuantity}`
                  : 'Escolha cotas'
                : 'Garantir números'}
            </button>
          </div>
        </div>
      )}

      <section className="mt-16 border-t border-white/10 pt-12">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-2xl font-bold tracking-wide text-white">
            Outros Sorteios na Galeria
          </h2>
          <button
            type="button"
            onClick={onBackToGallery}
            className="text-sm font-semibold text-[#FF7EB3] hover:text-white"
          >
            Ver todos
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {relatedRaffles.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectOtherRaffle(item.slug)}
              className="group flex items-center gap-4 rounded-xl border border-white/10 bg-[#14111D] p-3 text-left transition-colors hover:border-[#FF4E8E]/45"
            >
              <div className="h-20 w-24 shrink-0 overflow-hidden rounded-lg">
                <MediaFrame src={item.image} alt={item.shortTitle} aspectClass="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs text-[#FF7EB3]">
                  {item.poolLabel}
                </span>
                <span className="mt-0.5 block truncate text-sm font-semibold text-white">
                  {item.shortTitle}
                </span>
                <span className="mt-1 block font-mono text-xs tabular-nums text-[#B8B2C8]">
                  {formatBRL(item.ticketPrice)} por cota
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
