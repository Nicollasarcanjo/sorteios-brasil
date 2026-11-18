import crypto from 'node:crypto';
import type {
  AuditLogEntry,
  DatabaseState,
  ProductBreakdownItem,
  PublicLivePartner,
  PublicRaffleProjection,
  StoredRaffle,
  StoredReservation,
} from './types.ts';
import {maskBuyerDisplayName} from './security.ts';
import {detectPlatformFromUrl} from './liveResolver.ts';
import {ABACATEPAY_PIX_FEE_BRL} from './abacatepay.ts';

export {
  getStorageBackend,
  initStore,
  readDbSnapshot,
  resetCachedDbForCleanState,
  withDbTransaction,
} from './persistence.ts';


/** Lucro padrão (100%) e limites aceitos no painel (0% a 200%). */
export const TARGET_PROFIT_RATE = 1.0;
export const MIN_PROFIT_RATE = 0;
export const MAX_PROFIT_RATE = 2.0;

/** Converte um percentual (0–200) vindo do painel em taxa (0–2). Inválido → null. */
export function parseProfitPct(value: unknown): number | null {
  const pct = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(pct)) return null;
  const rate = pct / 100;
  return Math.min(MAX_PROFIT_RATE, Math.max(MIN_PROFIT_RATE, Number(rate.toFixed(4))));
}

/**
 * Simula o pior caso de taxas da AbacatePay (R$ 0,80 por PIX, assumindo 1 PIX por cota)
 * somado ao valor dos produtos + lucro alvo (padrão 100%), garantindo margem líquida intacta.
 */
export function buildRafflePricing(
  products: ProductBreakdownItem[],
  totalTickets: number,
  profitRate: number = TARGET_PROFIT_RATE,
) {
  const rate = Math.min(MAX_PROFIT_RATE, Math.max(MIN_PROFIT_RATE, profitRate));
  const productsTotalValue = Number(
    products.reduce((sum, item) => sum + item.retailPrice, 0).toFixed(2),
  );
  const netRevenueAfterPixFees = Number(
    (productsTotalValue * (1 + rate)).toFixed(2),
  );
  const pixFeePerTransaction = ABACATEPAY_PIX_FEE_BRL;
  const estimatedGatewayFees = Number((totalTickets * pixFeePerTransaction).toFixed(2));
  const totalRevenue = Number((netRevenueAfterPixFees + estimatedGatewayFees).toFixed(2));
  const ticketPrice = Number((totalRevenue / totalTickets).toFixed(2));

  return {
    products,
    productsTotalValue,
    targetProfitRate: rate,
    pixFeePerTransaction,
    estimatedGatewayFees,
    netRevenueAfterPixFees,
    totalRevenue,
    ticketPrice,
    totalTickets,
  };
}

/**
 * Sem pré-vendas simuladas: apenas reservas reais (pagas ou em aguardo de PIX) ocupam cotas.
 */
export function getBaselinePreSoldSet(
  _raffleId: string,
  _totalTickets: number,
  _initialSoldCount: number,
): Set<number> {
  return new Set<number>();
}


export function isReservationHoldingNumbers(
  res: StoredReservation,
  nowMs = Date.now(),
): boolean {
  if (res.status === 'confirmed') return true;
  if (res.status === 'pending_payment') {
    if (!res.paymentExpiresAt) return true;
    const expMs = Date.parse(res.paymentExpiresAt);
    return !Number.isNaN(expMs) && expMs > nowMs;
  }
  return false;
}

export function getAllSoldNumbersForRaffle(
  raffle: StoredRaffle,
  reservations: StoredReservation[],
): Set<number> {
  const nowMs = Date.now();
  const sold = new Set<number>();
  for (const res of reservations) {
    if (res.raffleId === raffle.id && isReservationHoldingNumbers(res, nowMs)) {
      for (const n of res.numbers) {
        if (n >= 1 && n <= raffle.totalTickets) {
          sold.add(n);
        }
      }
    }
  }
  return sold;
}

/**
 * RLS Public Projection:
 * Strips all PII (buyer names, emails, phones, ownerId) from public responses.
 */
export function toPublicRaffleProjection(
  raffle: StoredRaffle,
  reservations: StoredReservation[],
): PublicRaffleProjection {
  const soldSet = getAllSoldNumbersForRaffle(raffle, reservations);
  const soldNumbers = Array.from(soldSet).sort((a, b) => a - b);
  const pixFeePerTransaction =
    typeof raffle.pixFeePerTransaction === 'number'
      ? raffle.pixFeePerTransaction
      : ABACATEPAY_PIX_FEE_BRL;
  const estimatedGatewayFees =
    typeof raffle.estimatedGatewayFees === 'number'
      ? raffle.estimatedGatewayFees
      : Number((raffle.totalTickets * pixFeePerTransaction).toFixed(2));
  const netRevenueAfterPixFees =
    typeof raffle.netRevenueAfterPixFees === 'number'
      ? raffle.netRevenueAfterPixFees
      : Number((raffle.totalRevenue - estimatedGatewayFees).toFixed(2));

  return {
    id: raffle.id,
    slug: raffle.slug,
    title: raffle.title,
    shortTitle: raffle.shortTitle,
    subtitle: raffle.subtitle,
    region: raffle.region,
    category: raffle.category,
    categoryLabel: raffle.categoryLabel,
    poolTier: raffle.poolTier,
    poolLabel: raffle.poolLabel,
    products: raffle.products,
    productsTotalValue: raffle.productsTotalValue,
    targetProfitRate: raffle.targetProfitRate,
    pixFeePerTransaction,
    estimatedGatewayFees,
    netRevenueAfterPixFees,
    totalRevenue: raffle.totalRevenue,
    ticketPrice: raffle.ticketPrice,
    totalTickets: raffle.totalTickets,
    soldCount: soldNumbers.length,
    soldNumbers,
    drawDate: raffle.drawDate,
    drawTimestamp: raffle.drawTimestamp,
    orderBumpCount: raffle.orderBumpCount,
    orderBumpDiscountPct: raffle.orderBumpDiscountPct,
    editionBadge: raffle.editionBadge,
    image: raffle.image,
    galleryCaption: raffle.galleryCaption,
    description: raffle.description,
    drawRule: raffle.drawRule,
    status: raffle.status,
    winner: raffle.winner
      ? {
          winningNumber: raffle.winner.winningNumber,
          buyerDisplayName: maskBuyerDisplayName(raffle.winner.buyerName),
          declaredAt: raffle.winner.declaredAt,
          socialPlatform: raffle.winner.socialPlatform ?? null,
          socialHandle: raffle.winner.socialHandle ?? null,
          socialUrl: raffle.winner.socialUrl ?? null,
          avatarUrl: raffle.winner.avatarUrl ?? null,
        }
      : null,
  };
}

export function appendAuditLog(
  db: DatabaseState,
  actor: string,
  action: AuditLogEntry['action'],
  targetId: string,
  details: string,
): void {
  db.auditLogs.unshift({
    id: `aud_${crypto.randomBytes(6).toString('hex')}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    targetId,
    details,
  });
  if (db.auditLogs.length > 250) {
    db.auditLogs = db.auditLogs.slice(0, 250);
  }
}

export function buildAdminReferralSummaries(db: DatabaseState) {
  return db.referralCodes.map((ref) => {
    const codeUpper = ref.code.toUpperCase();
    const matchingSales = db.reservations
      .filter(
        (res) =>
          res.status === 'confirmed' &&
          res.referralCode?.toUpperCase() === codeUpper,
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const matchingAlerts = db.referralAlerts.filter(
      (alert) => alert.referralCode.toUpperCase() === codeUpper,
    );
    const matchingPayouts = (db.referralPayouts || [])
      .filter((p) => p.referralCode.toUpperCase() === codeUpper)
      .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));

    const getSaleCommission = (res: StoredReservation): number => {
      if (typeof res.referralCommissionAmount === 'number') {
        return res.referralCommissionAmount;
      }
      const pct = res.referralCommissionPct ?? ref.commissionPct;
      return res.totalPaid * (pct / 100);
    };

    const salesCount = matchingSales.length;
    const ticketsCount = matchingSales.reduce((sum, res) => sum + res.numbers.length, 0);
    const totalSalesRevenue = Number(
      matchingSales.reduce((sum, res) => sum + res.totalPaid, 0).toFixed(2),
    );
    const totalSalesCommission = Number(
      matchingSales.reduce((sum, res) => sum + getSaleCommission(res), 0).toFixed(2),
    );
    const pendingSalesCommission = Number(
      matchingSales
        .filter((res) => !res.referralCommissionPaidAt)
        .reduce((sum, res) => sum + getSaleCommission(res), 0)
        .toFixed(2),
    );

    const winnerBonusCount = matchingAlerts.length;
    const totalWinnerBonus = Number(
      matchingAlerts.reduce((sum, alert) => sum + alert.bonusAmount, 0).toFixed(2),
    );
    const pendingWinnerBonus = Number(
      matchingAlerts
        .filter((alert) => !alert.bonusPaidAt)
        .reduce((sum, alert) => sum + alert.bonusAmount, 0)
        .toFixed(2),
    );

    const totalPayout = Number((totalSalesCommission + totalWinnerBonus).toFixed(2));
    const pendingPayout = Number((pendingSalesCommission + pendingWinnerBonus).toFixed(2));
    const totalPaidOut = Number(
      matchingPayouts.reduce((sum, p) => sum + p.totalPaid, 0).toFixed(2),
    );

    return {
      ...ref,
      liveLinks: ref.liveLinks || [],
      isLive: Boolean(ref.isLive),
      salesCount,
      ticketsCount,
      totalSalesRevenue,
      totalSalesCommission,
      pendingSalesCommission,
      winnerBonusCount,
      totalWinnerBonus,
      pendingWinnerBonus,
      totalPayout,
      pendingPayout,
      totalPaidOut,
      payoutsCount: matchingPayouts.length,
      lastPaidAt: matchingPayouts[0]?.paidAt || null,
      recentSales: matchingSales.slice(0, 150),
    };
  });
}

/**
 * RLS Public Projection for Partner Lives:
 * Strictly strips promoterContact, commissionPct, and revenue figures.
 */
export function buildPublicLivePartners(db: DatabaseState): PublicLivePartner[] {
  return db.referralCodes
    .filter(
      (ref) =>
        ref.active &&
        ref.isLive &&
        Array.isArray(ref.liveLinks) &&
        ref.liveLinks.length > 0,
    )
    .map((ref) => ({
      id: ref.id,
      code: ref.code,
      promoterName: ref.promoterName,
      avatarUrl: ref.avatarUrl || null,
      isLive: true,
      platforms: ref.liveLinks.map((url) => ({
        platform: detectPlatformFromUrl(url),
        url,
      })),
    }));
}
