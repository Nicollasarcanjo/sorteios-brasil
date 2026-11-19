import type {SocialPlatform} from '../../shared/social.ts';

/** Id da categoria (livre). Padrões: 'gta6', 'gta6-ps5'. Ver shared/categories.ts. */
export type RaffleCategory = string;
export type PoolTier = 'popular' | 'exclusive';
export type RaffleStatus = 'active' | 'finalized';

export interface ProductBreakdownItem {
  name: string;
  retailPrice: number;
}

export interface RaffleWinnerPublic {
  winningNumber: number;
  buyerDisplayName: string;
  declaredAt: string;
  socialPlatform?: SocialPlatform | null;
  socialHandle?: string | null;
  socialUrl?: string | null;
  avatarUrl?: string | null;
}

export const ABACATEPAY_PIX_FEE_BRL = 0.8;

export interface RaffleItem {
  id: string;
  slug: string;
  title: string;
  shortTitle: string;
  subtitle: string;
  region: string;
  category: RaffleCategory;
  categoryLabel: string;
  poolTier: PoolTier;
  poolLabel: string;
  products: ProductBreakdownItem[];
  productsTotalValue: number;
  targetProfitRate: number;
  pixFeePerTransaction?: number;
  estimatedGatewayFees?: number;
  netRevenueAfterPixFees?: number;
  totalRevenue: number;
  ticketPrice: number;
  totalTickets: number;
  /** Mínimo de cotas por compra (padrão 1). */
  minTicketsPerPurchase?: number;
  soldCount: number;
  soldNumbers: number[];
  drawDate: string;
  drawTimestamp: string;
  orderBumpCount: number;
  orderBumpDiscountPct: number;
  editionBadge: string;
  image: string;
  galleryCaption: string;
  description: string;
  drawRule: string;
  status: RaffleStatus;
  winner: RaffleWinnerPublic | null;
}

/** Keep open draws ahead of completed ones wherever raffle lists are shown. */
export function sortRafflesUnfinalizedFirst(raffles: RaffleItem[]): RaffleItem[] {
  return [...raffles].sort(
    (a, b) => Number(a.status === 'finalized') - Number(b.status === 'finalized'),
  );
}

/** Show the low-availability message only when sales leave at most 10% of the draw. */
export function isRaffleNearSellout(raffle: RaffleItem): boolean {
  if (raffle.status === 'finalized' || raffle.totalTickets <= 0) return false;
  const remaining = Math.max(0, raffle.totalTickets - raffle.soldCount);
  const lowAvailabilityThreshold = Math.max(3, Math.ceil(raffle.totalTickets * 0.1));
  return remaining <= lowAvailabilityThreshold;
}

export interface UserReservation {
  id: string;
  raffleId: string;
  raffleSlug: string;
  raffleTitle: string;
  raffleImage: string;
  numbers: number[];
  totalPaid: number;
  buyerName: string;
  buyerContact: string;
  buyerEmail?: string;
  buyerPhone?: string;
  buyerTaxIdMasked?: string;
  orderBumpApplied?: boolean;
  referralCode?: string;
  referralPromoterName?: string;
  referralCommissionPct?: number;
  referralCommissionAmount?: number;
  referralCommissionPaidAt?: string;
  referralPayoutId?: string;
  paymentGateway?: 'abacatepay';
  paymentId?: string;
  paymentStatus?: 'PENDING' | 'PAID' | 'APPROVED' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';
  paymentBrCode?: string;
  paymentBrCodeBase64?: string;
  paymentExpiresAt?: string;
  paymentDevMode?: boolean;
  paymentReceiptUrl?: string;
  paidAt?: string;
  status?: 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';
  createdAt: string;
}

export interface AdminGatewayStatus {
  provider: 'abacatepay';
  configured: boolean;
  webhookConfigured: boolean;
}

export interface AdminRaffleRecord extends Omit<RaffleItem, 'soldNumbers' | 'winner'> {
  initialSoldCount: number;
  reservationsCount: number;
  recordedRevenue: number;
  winner: {
    winningNumber: number;
    buyerName: string;
    buyerContactMasked: string;
    reservationId: string;
    declaredAt: string;
    declaredBy: string;
    selectionMode: 'random_sold' | 'manual';
    referralCode?: string;
    referralPromoterName?: string;
    referralWinnerBonusPct?: number;
    referralWinnerBonusAmount?: number;
    socialPlatform?: SocialPlatform;
    socialHandle?: string;
    socialUrl?: string;
    avatarUrl?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminNumberOwner {
  source: 'reservation' | 'baseline';
  reservationId?: string;
  buyerName: string;
  buyerContact: string;
  status?: 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';
  paymentId?: string;
  createdAt?: string;
  orderBumpApplied?: boolean;
  referralCode?: string;
  referralCommissionPct?: number;
  referralCommissionAmount?: number;
}

export interface AdminReferralCodeSummary {
  id: string;
  code: string;
  promoterName: string;
  promoterContact: string;
  commissionPct: number;
  active: boolean;
  liveLinks: string[];
  avatarUrl?: string;
  isLive: boolean;
  createdAt: string;
  updatedAt: string;
  salesCount: number;
  ticketsCount: number;
  totalSalesRevenue: number;
  totalSalesCommission: number;
  pendingSalesCommission: number;
  winnerBonusCount: number;
  totalWinnerBonus: number;
  pendingWinnerBonus: number;
  totalPayout: number;
  pendingPayout: number;
  totalPaidOut: number;
  payoutsCount: number;
  lastPaidAt: string | null;
  recentSales: UserReservation[];
}

export type LivePlatformName =
  | 'Twitch'
  | 'YouTube'
  | 'Kick'
  | 'TikTok'
  | 'Instagram'
  | 'Facebook'
  | 'Live';

export interface PublicLivePartner {
  id: string;
  code: string;
  promoterName: string;
  avatarUrl: string | null;
  isLive: boolean;
  platforms: Array<{
    platform: LivePlatformName;
    url: string;
  }>;
}

export interface ReferralWinnerAlert {
  id: string;
  raffleId: string;
  raffleTitle: string;
  winningNumber: number;
  totalTickets: number;
  buyerName: string;
  reservationId: string;
  referralCode: string;
  promoterName: string;
  promoterContact: string;
  prizeValue: number;
  bonusPct: number;
  bonusAmount: number;
  acknowledged: boolean;
  acknowledgedAt?: string;
  bonusPaidAt?: string;
  referralPayoutId?: string;
  createdAt: string;
}

export interface ReferralPayoutRecord {
  id: string;
  referralId: string;
  referralCode: string;
  promoterName: string;
  promoterContact: string;
  salesCommissionPaid: number;
  winnerBonusPaid: number;
  totalPaid: number;
  settledSalesCount: number;
  settledAlertsCount: number;
  reservationIds: string[];
  alertIds: string[];
  note?: string;
  paidBy: string;
  paidAt: string;
}

export interface AdminLedgerResponse {
  raffle: AdminRaffleRecord;
  soldCount: number;
  reservations: UserReservation[];
  numberOwnerMap: Record<number, AdminNumberOwner>;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  targetId: string;
  details: string;
}

export const HERO_IMAGE = '/src/assets/images/hero_vice_city_sunset_1795020693503.jpg';

export const ARTWORK_PRESETS = [
  {
    label: 'GTA VI Edição Padrão (Vice Beach)',
    url: '/src/assets/images/raffle_gta6_standard_1795020694086.jpg',
  },
  {
    label: 'GTA VI Colecionador Steelbook',
    url: '/src/assets/images/raffle_gta6_collector_1795020694574.jpg',
  },
  {
    label: 'GTA VI + Pulse Elite + Gift Card',
    url: '/src/assets/images/raffle_gta6_trio_1795020695589.jpg',
  },
  {
    label: 'Combo PS5 Pro + GTA VI',
    url: '/src/assets/images/raffle_ps5_gta6_combo_1795020696195.jpg',
  },
  {
    label: 'PS5 Slim Duo + GTA VI VIP',
    url: '/src/assets/images/raffle_ps5_vip_duo_1795020696967.jpg',
  },
  {
    label: 'Setup Vice City PS5 + OLED 4K',
    url: '/src/assets/images/raffle_ps5_setup_4k_1795020697296.jpg',
  },
];

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

export function padTicketNumber(num: number, totalTickets: number): string {
  const digits = totalTickets >= 1000 ? 4 : totalTickets >= 100 ? 3 : 2;
  return String(num).padStart(digits, '0');
}
