export type RaffleCategory = 'gta6' | 'gta6-ps5';
export type PoolTier = 'popular' | 'exclusive';
export type RaffleStatus = 'active' | 'finalized';

export interface ProductBreakdownItem {
  name: string;
  retailPrice: number;
}

export interface RaffleWinnerInfo {
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
}

export interface StoredRaffle {
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
  pixFeePerTransaction: number;
  estimatedGatewayFees: number;
  netRevenueAfterPixFees: number;
  totalRevenue: number;
  ticketPrice: number;
  totalTickets: number;
  initialSoldCount: number;
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
  winner: RaffleWinnerInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredReferralCode {
  id: string;
  code: string;
  promoterName: string;
  promoterContact: string;
  commissionPct: number; // 5 to 10
  active: boolean;
  liveLinks: string[];
  avatarUrl?: string;
  isLive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicLivePartner {
  id: string;
  code: string;
  promoterName: string;
  avatarUrl: string | null;
  isLive: boolean;
  platforms: Array<{
    platform: 'Twitch' | 'YouTube' | 'Kick' | 'TikTok' | 'Instagram' | 'Facebook' | 'Live';
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

export interface StoredReservation {
  id: string;
  ownerId: string;
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
  orderBumpApplied: boolean;
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
  status: 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';
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

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action:
    | 'ADMIN_LOGIN'
    | 'ADMIN_LOGIN_FAILED'
    | 'CREATE_RAFFLE'
    | 'UPDATE_RAFFLE'
    | 'FINALIZE_RAFFLE'
    | 'SET_WINNER'
    | 'CANCEL_RESERVATION'
    | 'CREATE_REFERRAL_CODE'
    | 'UPDATE_REFERRAL_CODE'
    | 'DELETE_REFERRAL_CODE'
    | 'REFERRAL_WINNER_BONUS'
    | 'ACK_REFERRAL_ALERT'
    | 'PAYOUT_REFERRAL'
    | 'PAYMENT_CREATED'
    | 'PAYMENT_CONFIRMED'
    | 'PAYMENT_EXPIRED'
    | 'PAYMENT_REFUNDED';
  targetId: string;
  details: string;
}

export interface DatabaseState {
  raffles: StoredRaffle[];
  reservations: StoredReservation[];
  referralCodes: StoredReferralCode[];
  referralAlerts: ReferralWinnerAlert[];
  referralPayouts: ReferralPayoutRecord[];
  auditLogs: AuditLogEntry[];
}

export interface PublicRaffleProjection {
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
  pixFeePerTransaction: number;
  estimatedGatewayFees: number;
  netRevenueAfterPixFees: number;
  totalRevenue: number;
  ticketPrice: number;
  totalTickets: number;
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
  winner: {
    winningNumber: number;
    buyerDisplayName: string;
    declaredAt: string;
  } | null;
}
