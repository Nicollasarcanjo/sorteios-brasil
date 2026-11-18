import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ArrowLeft,
  Award,
  Banknote,
  BellRing,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Gift,
  Link2,
  Lock,
  LogOut,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  ABACATEPAY_PIX_FEE_BRL,
  ARTWORK_PRESETS,
  AdminGatewayStatus,
  AdminLedgerResponse,
  AdminNumberOwner,
  AdminRaffleRecord,
  AdminReferralCodeSummary,
  AuditLogEntry,
  PoolTier,
  ProductBreakdownItem,
  RaffleCategory,
  ReferralPayoutRecord,
  ReferralWinnerAlert,
  formatBRL,
  padTicketNumber,
} from '../data/raffles';
import {DEFAULT_CATEGORIES, type CategoryOption} from '../../shared/categories.ts';
import {MAX_TOTAL_TICKETS, MIN_TOTAL_TICKETS} from '../../shared/limits.ts';

interface AdminDashboardProps {
  onBackToSite: () => void;
  onCatalogChanged: () => void;
}

type AdminTab = 'raffles' | 'referrals' | 'security';

interface RaffleFormState {
  editingId: string | null;
  /** Título do sorteio de origem quando é "Criar novamente" (novo sorteio com os mesmos itens). */
  duplicatedFromTitle?: string;
  title: string;
  shortTitle: string;
  subtitle: string;
  region: string;
  categoryLabel: string;
  poolTier: PoolTier;
  totalTickets: number;
  /** Lucro sobre o valor dos prêmios, 0 a 200 (%). */
  profitPct: number;
  /** 'tickets': admin define a quantidade de cotas; 'price': define o valor da cota. */
  pricingMode: 'tickets' | 'price';
  desiredTicketPrice: number;
  /** Compra mínima: por quantidade de cotas ou por valor (R$). */
  minPurchaseMode: 'tickets' | 'value';
  minTickets: number;
  minValue: number;
  drawDate: string;
  drawTimestamp: string;
  orderBumpCount: number;
  orderBumpDiscountPct: number;
  image: string;
  description: string;
  products: ProductBreakdownItem[];
}

function defaultFormState(): RaffleFormState {
  const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const localIso = new Date(futureDate.getTime() - futureDate.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  const formattedDrawDate = `${String(futureDate.getDate()).padStart(2, '0')}/${String(
    futureDate.getMonth() + 1,
  ).padStart(2, '0')} às 20h00`;

  return {
    editingId: null,
    title: '',
    shortTitle: '',
    subtitle: '',
    region: 'Vice Beach',
    categoryLabel: 'GTA VI + PS5',
    poolTier: 'exclusive',
    totalTickets: 100,
    profitPct: 100,
    pricingMode: 'tickets',
    desiredTicketPrice: 10,
    minPurchaseMode: 'tickets',
    minTickets: 1,
    minValue: 10,
    drawDate: formattedDrawDate,
    drawTimestamp: localIso,
    orderBumpCount: 2,
    orderBumpDiscountPct: 30,
    image: ARTWORK_PRESETS[3].url,
    description: '',
    products: [{name: '', retailPrice: 500}],
  };
}

const ADMIN_TOKEN_KEY = 'leonida_admin_bearer_v1';
const NEW_CATEGORY_OPTION = '__nova_categoria__';
let memoryAdminToken: string | null = null;

function setStoredAdminToken(token: string | null): void {
  memoryAdminToken = token;
  try {
    if (token) {
      window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  } catch {
    // Ignore sessionStorage errors in restricted iframes
  }
}

function getStoredAdminToken(): string | null {
  if (memoryAdminToken) return memoryAdminToken;
  try {
    const stored = window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (stored) {
      memoryAdminToken = stored;
      return stored;
    }
  } catch {
    // Ignore sessionStorage errors
  }
  return null;
}

function getAdminHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {...extra};
  const token = getStoredAdminToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function AdminDashboard({onBackToSite, onCatalogChanged}: AdminDashboardProps) {
  const [checkingSession, setCheckingSession] = useState(true);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [customSecretsConfigured, setCustomSecretsConfigured] = useState(false);
  const [maskedEmailHint, setMaskedEmailHint] = useState<string | null>(null);

  // Overview state
  const [activeTab, setActiveTab] = useState<AdminTab>('raffles');
  const [raffles, setRaffles] = useState<AdminRaffleRecord[]>([]);
  const [referralCodes, setReferralCodes] = useState<AdminReferralCodeSummary[]>([]);
  const [referralAlerts, setReferralAlerts] = useState<ReferralWinnerAlert[]>([]);
  const [referralPayouts, setReferralPayouts] = useState<ReferralPayoutRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [gatewayStatus, setGatewayStatus] = useState<AdminGatewayStatus | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Referral Modal / Inspector / Payout state
  const [referralFormOpen, setReferralFormOpen] = useState(false);
  const [editingReferralId, setEditingReferralId] = useState<string | null>(null);
  const [refCodeInput, setRefCodeInput] = useState('');
  const [refPromoterName, setRefPromoterName] = useState('');
  const [refPromoterContact, setRefPromoterContact] = useState('');
  const [refCommissionPct, setRefCommissionPct] = useState<number>(8);
  const [refActive, setRefActive] = useState<boolean>(true);
  const [refLiveLinks, setRefLiveLinks] = useState<string[]>([]);
  const [refNewLinkInput, setRefNewLinkInput] = useState('');
  const [refIsLive, setRefIsLive] = useState<boolean>(true);
  const [refAvatarUrl, setRefAvatarUrl] = useState('');
  const [refOriginalAvatarUrl, setRefOriginalAvatarUrl] = useState('');
  const [refOriginalLinksSignature, setRefOriginalLinksSignature] = useState('');
  const [refForceRefreshAvatar, setRefForceRefreshAvatar] = useState(false);
  const [savingReferral, setSavingReferral] = useState(false);
  const [inspectReferralId, setInspectReferralId] = useState<string | null>(null);
  const [payoutModalReferralId, setPayoutModalReferralId] = useState<string | null>(null);
  const [payoutNoteInput, setPayoutNoteInput] = useState('');
  const [processingPayout, setProcessingPayout] = useState(false);

  const inspectReferralCode = useMemo(
    () => referralCodes.find((c) => c.id === inspectReferralId) ?? null,
    [referralCodes, inspectReferralId],
  );
  const payoutModalReferral = useMemo(
    () => referralCodes.find((c) => c.id === payoutModalReferralId) ?? null,
    [referralCodes, payoutModalReferralId],
  );

  // Ledger state (Inspect all numbers + buyers of a raffle)
  const [ledger, setLedger] = useState<AdminLedgerResponse | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [numberPage, setNumberPage] = useState(0);
  const [jumpNumber, setJumpNumber] = useState('');
  const [selectedNumberDetail, setSelectedNumberDetail] = useState<{
    num: number;
    owner: AdminNumberOwner | null;
  } | null>(null);

  // Create / Edit modal state
  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<RaffleFormState>(defaultFormState);
  const [savingForm, setSavingForm] = useState(false);

  // Winner / Finalize modal state
  // Catálogo (categorias e produtos já usados) para facilitar a criação de sorteios.
  const [catalog, setCatalog] = useState<{categories: CategoryOption[]; products: ProductBreakdownItem[]}>({
    categories: [...DEFAULT_CATEGORIES],
    products: [],
  });
  const [creatingCategory, setCreatingCategory] = useState(false);

  useEffect(() => {
    if (!formOpen) return;
    setCreatingCategory(false);
    let cancelled = false;
    fetch('/api/admin/catalog', {credentials: 'include', headers: getAdminHeaders()})
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.categories) {
          setCatalog({categories: data.categories, products: data.products ?? []});
        }
      })
      .catch(() => {
        // Sem catálogo: o formulário continua funcionando com as categorias padrão.
      });
    return () => {
      cancelled = true;
    };
  }, [formOpen]);

  /** Categorias do dropdown, garantindo que a do sorteio em edição apareça. */
  const categoryOptions = useMemo(() => {
    const label = formState.categoryLabel.trim();
    if (creatingCategory || !label || catalog.categories.some((c) => c.label === label)) {
      return catalog.categories;
    }
    return [...catalog.categories, {id: label, label}];
  }, [catalog.categories, formState.categoryLabel, creatingCategory]);

  /** Preenche o produto com o preço salvo quando o nome bate com um produto do catálogo. */
  const findCatalogProduct = (name: string) =>
    catalog.products.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());

  const addCatalogProduct = (product: ProductBreakdownItem) => {
    setFormState((s) => {
      const emptyIdx = s.products.findIndex((p) => !p.name.trim());
      const next = [...s.products];
      if (emptyIdx >= 0) next[emptyIdx] = {...product};
      else next.push({...product});
      return {...s, products: next};
    });
  };

  const [winnerModalRaffle, setWinnerModalRaffle] = useState<AdminRaffleRecord | null>(null);
  const [winnerAvatarInput, setWinnerAvatarInput] = useState('');
  useEffect(() => {
    setWinnerAvatarInput(winnerModalRaffle?.winner?.avatarUrl ?? '');
  }, [winnerModalRaffle]);
  const [manualWinNumber, setManualWinNumber] = useState('');
  const [processingWinner, setProcessingWinner] = useState(false);

  const loadOverview = useCallback(async (fromLogin = false) => {
    setLoadingOverview(true);
    try {
      const res = await fetch('/api/admin/overview', {
        credentials: 'include',
        headers: getAdminHeaders(),
      });
      if (res.status === 401) {
        setStoredAdminToken(null);
        setAdminEmail(null);
        if (fromLogin) {
          setLoginError('Sessão não reconhecida pelo servidor. Tente entrar novamente.');
        }
        return;
      }
      const data = await res.json();
      setRaffles(data.raffles || []);
      setReferralCodes(data.referralCodes || []);
      setReferralAlerts(data.referralAlerts || []);
      setReferralPayouts(data.referralPayouts || []);
      setAuditLogs(data.auditLogs || []);
      setGatewayStatus(data.gateway || null);
    } catch {
      setActionError('Não foi possível carregar os dados administrativos.');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/session', {
          credentials: 'include',
          headers: getAdminHeaders(),
        });
        const data = await res.json();
        if (data.authenticated) {
          setAdminEmail(data.email || 'admin@leonida.vi');
          await loadOverview();
        } else {
          const isCustom = Boolean(data.customSecretsConfigured);
          setCustomSecretsConfigured(isCustom);
          setMaskedEmailHint(data.maskedEmailHint || null);
          if (!isCustom) {
            setLoginEmail('admin@leonida.vi');
          }
        }
      } catch {
        // Ignore
      } finally {
        setCheckingSession(false);
      }
    })();
  }, [loadOverview]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || 'Falha na autenticação.');
        return;
      }
      if (data.token) {
        setStoredAdminToken(data.token);
      }
      setAdminEmail(data.email);
      setLoginPassword('');
      await loadOverview(true);
    } catch {
      setLoginError('Erro de conexão ao autenticar.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    const headers = getAdminHeaders();
    setStoredAdminToken(null);
    await fetch('/api/admin/logout', {
      method: 'POST',
      credentials: 'include',
      headers,
    });
    setAdminEmail(null);
    setLedger(null);
    setRaffles([]);
  };

  const openLedger = async (raffleId: string) => {
    setLoadingLedger(true);
    setActionError(null);
    setSelectedNumberDetail(null);
    setNumberPage(0);
    setLedgerSearch('');
    try {
      const res = await fetch(`/api/admin/raffles/${raffleId}/ledger`, {
        credentials: 'include',
        headers: getAdminHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao carregar mapa de cotas.');
        return;
      }
      setLedger(data as AdminLedgerResponse);
    } catch {
      setActionError('Falha ao carregar compradores e cotas.');
    } finally {
      setLoadingLedger(false);
    }
  };

  const openCreateModal = () => {
    setFormState(defaultFormState());
    setActionError(null);
    setFormOpen(true);
  };

  const openEditModal = (raffle: AdminRaffleRecord) => {
    const dt = new Date(raffle.drawTimestamp);
    const localIso = Number.isNaN(dt.getTime())
      ? ''
      : new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    setFormState({
      editingId: raffle.id,
      title: raffle.title,
      shortTitle: raffle.shortTitle,
      subtitle: raffle.subtitle,
      region: raffle.region,
      categoryLabel: raffle.categoryLabel,
      poolTier: raffle.poolTier,
      totalTickets: raffle.totalTickets,
      profitPct: Math.round((raffle.targetProfitRate ?? 1) * 100),
      pricingMode: 'tickets',
      desiredTicketPrice: raffle.ticketPrice,
      minPurchaseMode: 'tickets',
      minTickets: raffle.minTicketsPerPurchase ?? 1,
      minValue: Number(((raffle.minTicketsPerPurchase ?? 1) * raffle.ticketPrice).toFixed(2)),
      drawDate: raffle.drawDate,
      drawTimestamp: localIso,
      orderBumpCount: raffle.orderBumpCount,
      orderBumpDiscountPct: raffle.orderBumpDiscountPct,
      image: raffle.image,
      description: raffle.description,
      products: raffle.products.map((p) => ({...p})),
    });
    setActionError(null);
    setFormOpen(true);
  };

  /** Novo sorteio com os mesmos itens/configuração de um existente (inclusive finalizado). */
  const openDuplicateModal = (raffle: AdminRaffleRecord) => {
    const fresh = defaultFormState();
    setFormState({
      ...fresh,
      duplicatedFromTitle: raffle.title,
      title: raffle.title,
      shortTitle: raffle.shortTitle,
      subtitle: raffle.subtitle,
      region: raffle.region,
      categoryLabel: raffle.categoryLabel,
      poolTier: raffle.poolTier,
      totalTickets: raffle.totalTickets,
      profitPct: Math.round((raffle.targetProfitRate ?? 1) * 100),
      pricingMode: 'tickets',
      desiredTicketPrice: raffle.ticketPrice,
      minPurchaseMode: 'tickets',
      minTickets: raffle.minTicketsPerPurchase ?? 1,
      minValue: Number(((raffle.minTicketsPerPurchase ?? 1) * raffle.ticketPrice).toFixed(2)),
      orderBumpCount: raffle.orderBumpCount,
      orderBumpDiscountPct: raffle.orderBumpDiscountPct,
      image: raffle.image,
      description: raffle.description,
      products: raffle.products.map((p) => ({...p})),
      // Data nova (padrão: daqui a 5 dias) — ajuste antes de publicar.
    });
    setActionError(null);
    setFormOpen(true);
  };

  const handleSaveRaffle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formPricingError || formMinError) {
      setActionError(formPricingError || formMinError);
      return;
    }
    setSavingForm(true);
    setActionError(null);
    setActionMessage(null);

    const payload = {
      title: formState.title,
      shortTitle: formState.shortTitle,
      subtitle: formState.subtitle,
      region: formState.region,
      categoryLabel: formState.categoryLabel,
      poolTier: formState.poolTier,
      totalTickets: formTotalTickets,
      profitPct: Number(formState.profitPct),
      minTicketsPerPurchase: formMinTickets,
      drawDate: formState.drawDate,
      drawTimestamp: formState.drawTimestamp
        ? new Date(formState.drawTimestamp).toISOString()
        : undefined,
      orderBumpCount: Number(formState.orderBumpCount),
      orderBumpDiscountPct: Number(formState.orderBumpDiscountPct),
      image: formState.image,
      description: formState.description || formState.subtitle,
      products: formState.products.map((p) => ({
        name: p.name,
        retailPrice: Number(p.retailPrice),
      })),
    };

    try {
      const url = formState.editingId
        ? `/api/admin/raffles/${formState.editingId}`
        : '/api/admin/raffles';
      const method = formState.editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: getAdminHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao salvar sorteio.');
        return;
      }

      setFormOpen(false);
      setActionMessage(
        formState.editingId
          ? `Sorteio "${data.raffle.title}" atualizado com sucesso.`
          : `Novo sorteio "${data.raffle.title}" publicado com sucesso.`,
      );
      await loadOverview();
      onCatalogChanged();
      if (ledger && ledger.raffle.id === data.raffle.id) {
        await openLedger(data.raffle.id);
      }
    } catch {
      setActionError('Erro de comunicação ao salvar sorteio.');
    } finally {
      setSavingForm(false);
    }
  };

  const handleFinalizeOrReopen = async (raffleId: string, reopen: boolean) => {
    setProcessingWinner(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/raffles/${raffleId}/finalize`, {
        method: 'POST',
        credentials: 'include',
        headers: getAdminHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({reopen}),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Não foi possível alterar o status do sorteio.');
        return;
      }
      setWinnerModalRaffle(null);
      setActionMessage(
        reopen
          ? `Sorteio "${data.raffle.title}" reaberto para reservas.`
          : `Sorteio "${data.raffle.title}" finalizado (vendas encerradas).`,
      );
      await loadOverview();
      onCatalogChanged();
      if (ledger && ledger.raffle.id === raffleId) {
        await openLedger(raffleId);
      }
    } finally {
      setProcessingWinner(false);
    }
  };

  const handleSaveWinnerAvatar = async (raffleId: string) => {
    setProcessingWinner(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/raffles/${raffleId}/winner-avatar`, {
        method: 'PATCH',
        credentials: 'include',
        headers: getAdminHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({avatarUrl: winnerAvatarInput.trim()}),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao salvar a foto do ganhador.');
        return;
      }
      setWinnerModalRaffle(null);
      setActionMessage(`Foto do ganhador atualizada em "${data.raffle.title}".`);
      await loadOverview();
      onCatalogChanged();
    } finally {
      setProcessingWinner(false);
    }
  };

  const handleSetWinner = async (
    raffleId: string,
    mode: 'random_sold' | 'manual',
    explicitNumber?: number,
  ) => {
    setProcessingWinner(true);
    setActionError(null);
    try {
      const parsedNum =
        explicitNumber ??
        (manualWinNumber ? Number.parseInt(manualWinNumber.replace(/\D/g, ''), 10) : undefined);

      const res = await fetch(`/api/admin/raffles/${raffleId}/winner`, {
        method: 'POST',
        credentials: 'include',
        headers: getAdminHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({
          mode,
          winningNumber: mode === 'manual' ? parsedNum : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao definir ganhador.');
        return;
      }
      setWinnerModalRaffle(null);
      setManualWinNumber('');
      if (data.referralWinnerAlert) {
        const al = data.referralWinnerAlert as ReferralWinnerAlert;
        setActionMessage(
          `Ganhador definido em "${data.raffle.title}": #${data.raffle.winner.winningNumber} (${data.raffle.winner.buyerName}). AVISO DE INDICAÇÃO PREMIADA: código ${al.referralCode} (${al.promoterName}) recebeu +5% do prêmio (${formatBRL(al.bonusAmount)}).`,
        );
      } else {
        setActionMessage(
          `Ganhador definido em "${data.raffle.title}": número #${data.raffle.winner.winningNumber} (${data.raffle.winner.buyerName}).`,
        );
      }
      await loadOverview();
      onCatalogChanged();
      if (ledger && ledger.raffle.id === raffleId) {
        await openLedger(raffleId);
      }
    } finally {
      setProcessingWinner(false);
    }
  };

  const detectPlatformLabel = (rawUrl: string): string => {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      if (host.includes('twitch.tv')) return 'Twitch';
      if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube';
      if (host.includes('kick.com')) return 'Kick';
      if (host.includes('tiktok.com')) return 'TikTok';
      if (host.includes('instagram.com')) return 'Instagram';
      if (host.includes('facebook.com') || host.includes('fb.gg')) return 'Facebook';
      return 'Live';
    } catch {
      return 'Link';
    }
  };

  const normalizeLiveUrlInput = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      if (!parsed.hostname.includes('.')) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  };

  const handleAddLiveLink = () => {
    const normalized = normalizeLiveUrlInput(refNewLinkInput);
    if (!normalized) {
      setActionError('Informe uma URL válida de live (ex: https://www.twitch.tv/canal).');
      return;
    }
    setActionError(null);
    setRefLiveLinks((prev) => {
      if (prev.includes(normalized) || prev.length >= 6) return prev;
      return [...prev, normalized];
    });
    setRefNewLinkInput('');
  };

  const handleRemoveLiveLink = (urlToRemove: string) => {
    setRefLiveLinks((prev) => prev.filter((item) => item !== urlToRemove));
  };

  const openCreateReferralModal = () => {
    setEditingReferralId(null);
    setRefCodeInput('');
    setRefPromoterName('');
    setRefPromoterContact('');
    setRefCommissionPct(8);
    setRefActive(true);
    setRefLiveLinks([]);
    setRefNewLinkInput('');
    setRefIsLive(true);
    setRefAvatarUrl('');
    setRefOriginalAvatarUrl('');
    setRefOriginalLinksSignature('');
    setRefForceRefreshAvatar(false);
    setReferralFormOpen(true);
  };

  const openEditReferralModal = (refItem: AdminReferralCodeSummary) => {
    const initialLinks = Array.isArray(refItem.liveLinks) ? refItem.liveLinks : [];
    setEditingReferralId(refItem.id);
    setRefCodeInput(refItem.code);
    setRefPromoterName(refItem.promoterName);
    setRefPromoterContact(refItem.promoterContact);
    setRefCommissionPct(refItem.commissionPct);
    setRefActive(refItem.active);
    setRefLiveLinks(initialLinks);
    setRefNewLinkInput('');
    setRefIsLive(Boolean(refItem.isLive));
    setRefAvatarUrl(refItem.avatarUrl || '');
    setRefOriginalAvatarUrl(refItem.avatarUrl || '');
    setRefOriginalLinksSignature(initialLinks.join('|'));
    setRefForceRefreshAvatar(false);
    setReferralFormOpen(true);
  };

  const handleSaveReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingReferral(true);
    setActionError(null);
    try {
      let finalLiveLinks = [...refLiveLinks];
      if (refNewLinkInput.trim()) {
        const pending = normalizeLiveUrlInput(refNewLinkInput);
        if (!pending) {
          setActionError('A URL digitada em Links das Lives é inválida.');
          setSavingReferral(false);
          return;
        }
        if (!finalLiveLinks.includes(pending) && finalLiveLinks.length < 6) {
          finalLiveLinks = [...finalLiveLinks, pending];
        }
        setRefNewLinkInput('');
      }

      const linksChanged = finalLiveLinks.join('|') !== refOriginalLinksSignature;
      const trimmedAvatar = refAvatarUrl.trim();
      const manualAvatarChanged =
        trimmedAvatar.length > 0 && trimmedAvatar !== refOriginalAvatarUrl;
      const shouldAutoExtract =
        !manualAvatarChanged &&
        (refForceRefreshAvatar || !trimmedAvatar || linksChanged);

      const endpoint = editingReferralId
        ? `/api/admin/referrals/${editingReferralId}`
        : '/api/admin/referrals';
      const method = editingReferralId ? 'PATCH' : 'POST';
      const res = await fetch(endpoint, {
        method,
        credentials: 'include',
        headers: getAdminHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({
          ...(editingReferralId ? {} : {code: refCodeInput.trim().toUpperCase()}),
          promoterName: refPromoterName.trim(),
          promoterContact: refPromoterContact.trim(),
          commissionPct: Number(refCommissionPct),
          active: refActive,
          liveLinks: finalLiveLinks,
          isLive: finalLiveLinks.length > 0 ? refIsLive : false,
          ...(manualAvatarChanged ? {avatarUrl: trimmedAvatar} : {}),
          ...(shouldAutoExtract ? {refreshAvatar: true} : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao salvar código de indicação.');
        return;
      }
      setReferralFormOpen(false);
      const avatarInfo = data.referralCode?.avatarUrl
        ? ' · Foto de perfil capturada dos links.'
        : '';
      setActionMessage(
        editingReferralId
          ? `Código ${data.referralCode.code} atualizado com sucesso.${avatarInfo}`
          : `Código de indicação ${data.referralCode.code} criado (${data.referralCode.commissionPct}% por venda + 5% do prêmio).${avatarInfo}`,
      );
      await loadOverview();
      onCatalogChanged();
    } catch {
      setActionError('Erro de conexão ao salvar código de indicação.');
    } finally {
      setSavingReferral(false);
    }
  };

  const handleToggleReferralActive = async (refItem: AdminReferralCodeSummary) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/referrals/${refItem.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: getAdminHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({active: !refItem.active}),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao alterar status do código.');
        return;
      }
      setActionMessage(
        `Código ${refItem.code} ${!refItem.active ? 'ativado' : 'pausado'} com sucesso.`,
      );
      await loadOverview();
      onCatalogChanged();
    } catch {
      setActionError('Erro ao atualizar código de indicação.');
    }
  };

  const handleToggleReferralLive = async (refItem: AdminReferralCodeSummary) => {
    setActionError(null);
    if (!refItem.liveLinks || refItem.liveLinks.length === 0) {
      openEditReferralModal(refItem);
      return;
    }
    try {
      const nextLive = !refItem.isLive;
      const res = await fetch(`/api/admin/referrals/${refItem.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: getAdminHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({
          isLive: nextLive,
          ...(!refItem.avatarUrl ? {refreshAvatar: true} : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao atualizar status de Live.');
        return;
      }
      setActionMessage(
        `Live de ${refItem.promoterName} (${refItem.code}) ${nextLive ? 'ativada em Lives Parceiras' : 'colocada offline'}.`,
      );
      await loadOverview();
      onCatalogChanged();
    } catch {
      setActionError('Erro ao atualizar status de Live.');
    }
  };

  const handleDeleteReferral = async (refItem: AdminReferralCodeSummary) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/referrals/${refItem.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAdminHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao remover código.');
        return;
      }
      if (inspectReferralId === refItem.id) {
        setInspectReferralId(null);
      }
      if (payoutModalReferralId === refItem.id) {
        setPayoutModalReferralId(null);
      }
      setActionMessage(`Código ${refItem.code} removido.`);
      await loadOverview();
      onCatalogChanged();
    } catch {
      setActionError('Erro ao remover código de indicação.');
    }
  };

  const openPayoutModal = (refItem: AdminReferralCodeSummary) => {
    setActionError(null);
    setPayoutModalReferralId(refItem.id);
    setPayoutNoteInput('');
  };

  const handleConfirmReferralPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutModalReferral) return;
    setProcessingPayout(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/referrals/${payoutModalReferral.id}/payout`, {
        method: 'POST',
        credentials: 'include',
        headers: getAdminHeaders({'Content-Type': 'application/json'}),
        body: JSON.stringify({note: payoutNoteInput.trim()}),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao registrar baixa de pagamento.');
        return;
      }
      setPayoutModalReferralId(null);
      setPayoutNoteInput('');
      setActionMessage(
        `Pagamento registrado para ${data.payout.referralCode} (${data.payout.promoterName}): ${formatBRL(data.payout.totalPaid)} quitado e saldo pendente zerado.`,
      );
      await loadOverview();
    } catch {
      setActionError('Erro de conexão ao registrar baixa de pagamento.');
    } finally {
      setProcessingPayout(false);
    }
  };

  const handleAckReferralAlert = async (alertId: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/referral-alerts/${alertId}/ack`, {
        method: 'POST',
        credentials: 'include',
        headers: getAdminHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao confirmar bônus de indicação.');
        return;
      }
      setActionMessage(
        `Bônus de 5% do prêmio (${formatBRL(data.alert.bonusAmount)}) para ${data.alert.referralCode} marcado como pago / ciente.`,
      );
      await loadOverview();
    } catch {
      setActionError('Erro ao confirmar alerta.');
    }
  };

  const handleCancelReservation = async (reservationId: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/reservations/${reservationId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAdminHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Erro ao cancelar reserva.');
        return;
      }
      setActionMessage(`Reserva ${reservationId} cancelada e cotas devolvidas ao painel.`);
      if (ledger) {
        await openLedger(ledger.raffle.id);
      }
      await loadOverview();
      onCatalogChanged();
    } catch {
      setActionError('Erro ao cancelar reserva.');
    }
  };

  const handleExportCsv = () => {
    if (!ledger) return;
    const header = [
      'Reserva',
      'Comprador',
      'Contato',
      'Qtd Cotas',
      'Numeros',
      'Total Pago',
      'Codigo Indicacao',
      'Bonus Indicador',
      'Order Bump',
      'Data',
    ];
    const rows = ledger.reservations.map((r) => [
      r.id,
      `"${r.buyerName.replace(/"/g, '""')}"`,
      `"${r.buyerContact.replace(/"/g, '""')}"`,
      String(r.numbers.length),
      `"${r.numbers.map((n) => padTicketNumber(n, ledger.raffle.totalTickets)).join(', ')}"`,
      r.totalPaid.toFixed(2),
      r.referralCode || '',
      r.referralCommissionAmount ? r.referralCommissionAmount.toFixed(2) : '0.00',
      r.orderBumpApplied ? 'Sim' : 'Nao',
      r.createdAt,
    ]);
    const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `compradores-${ledger.raffle.slug}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formProductsSum = useMemo(
    () => formState.products.reduce((sum, p) => sum + (Number(p.retailPrice) || 0), 0),
    [formState.products],
  );
  // Mesma fórmula do servidor (server/store.ts → buildRafflePricing):
  // arrecadação = prêmios × (1 + lucro) + cotas × taxa PIX;  valor da cota = arrecadação / cotas.
  const formProfitRate = Math.min(2, Math.max(0, (Number(formState.profitPct) || 0) / 100));
  const formProfitValue = Number((formProductsSum * formProfitRate).toFixed(2));
  const formNetRevenue = Number((formProductsSum * (1 + formProfitRate)).toFixed(2));
  // Modo "valor da cota": cotas = (prêmios + lucro) / (valor desejado − taxa PIX), arredondado para cima.
  const formTotalTickets =
    formState.pricingMode === 'price'
      ? formState.desiredTicketPrice > ABACATEPAY_PIX_FEE_BRL && formNetRevenue > 0
        ? Math.ceil(formNetRevenue / (formState.desiredTicketPrice - ABACATEPAY_PIX_FEE_BRL) - 1e-9)
        : 0
      : Number(formState.totalTickets) || 0;
  const formGatewayFees = Number((formTotalTickets * ABACATEPAY_PIX_FEE_BRL).toFixed(2));
  const formTotalRevenue = Number((formNetRevenue + formGatewayFees).toFixed(2));
  const formTicketPrice =
    formTotalTickets > 0 ? Number((formTotalRevenue / formTotalTickets).toFixed(2)) : 0;
  const formPricingError =
    formState.pricingMode === 'price' && formState.desiredTicketPrice <= ABACATEPAY_PIX_FEE_BRL
      ? 'O valor da cota precisa ser maior que a taxa do PIX (R$ 0,80).'
      : formTotalTickets < MIN_TOTAL_TICKETS
        ? 'Informe a quantidade de cotas.'
        : formTotalTickets > MAX_TOTAL_TICKETS
          ? `O máximo técnico é ${MAX_TOTAL_TICKETS.toLocaleString('pt-BR')} cotas por sorteio.`
          : null;
  // Compra mínima em cotas (no modo valor: arredonda para cima para cobrir o valor pedido).
  const formMinTickets =
    formState.minPurchaseMode === 'tickets'
      ? Math.max(1, Math.trunc(Number(formState.minTickets) || 1))
      : formTicketPrice > 0
        ? Math.max(1, Math.ceil((Number(formState.minValue) || 0) / formTicketPrice - 1e-9))
        : 1;
  const formMinError =
    formMinTickets > formTotalTickets && formTotalTickets > 0
      ? `A compra mínima (${formMinTickets} cotas) passa do total de cotas do sorteio.`
      : null;
  /** "Criar novamente": itens travados, só cotas/valor (e data) podem mudar. */
  const formItemsLocked = !formState.editingId && Boolean(formState.duplicatedFromTitle);

  const filteredLedgerReservations = useMemo(() => {
    if (!ledger) return [];
    const q = ledgerSearch.trim().toLowerCase();
    if (!q) return ledger.reservations;
    return ledger.reservations.filter((r) => {
      if (r.id.toLowerCase().includes(q)) return true;
      if (r.buyerName.toLowerCase().includes(q)) return true;
      if (r.buyerContact.toLowerCase().includes(q)) return true;
      return r.numbers.some((n) =>
        padTicketNumber(n, ledger.raffle.totalTickets).includes(q) || String(n) === q,
      );
    });
  }, [ledger, ledgerSearch]);

  if (checkingSession) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-[#B8B2C8]">Verificando sessão administrativa...</p>
      </main>
    );
  }

  // Protected Admin Login Gate
  if (!adminEmail) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 sm:py-24">
        <div className="mb-6">
          <button
            type="button"
            onClick={onBackToSite}
            className="inline-flex min-h-[40px] items-center gap-2 text-sm font-medium text-[#B8B2C8] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Voltar para a Galeria</span>
          </button>
        </div>

        <div className="rounded-2xl border border-white/15 bg-[#14111D] p-7">
          <div className="flex items-center gap-2.5 text-[#FF7EB3]">
            <Lock className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Acesso Restrito · RBAC
            </span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-wide text-white">
            Gerenciamento de Sorteios
          </h1>
          <p className="mt-2 text-sm text-[#A59FB8]">
            Autenticação obrigatória via sessão assinada (RBAC) para criar, editar, encerrar sorteios e visualizar dados completos de compradores.
          </p>

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="admin-email" className="mb-1.5 block text-xs font-medium text-[#C6C0D4]">
                E-mail administrativo
              </label>
              <input
                id="admin-email"
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder={
                  customSecretsConfigured
                    ? 'Digite o e-mail configurado em ADMIN_EMAIL'
                    : 'admin@leonida.vi'
                }
                className="min-h-[44px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3.5 text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
              />
              {customSecretsConfigured && maskedEmailHint && (
                <p className="mt-1.5 text-[11px] text-[#B8B2C8]">
                  Credenciais personalizadas ativas nas Secrets ({maskedEmailHint}).
                </p>
              )}
            </div>

            <div>
              <label htmlFor="admin-pass" className="mb-1.5 block text-xs font-medium text-[#C6C0D4]">
                Senha de acesso
              </label>
              <div className="relative">
                <input
                  id="admin-pass"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Digite sua senha administrativa"
                  className="min-h-[44px] w-full rounded-lg border border-white/15 bg-[#0B0A10] pl-3.5 pr-10 text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#958FA8] hover:text-white"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/35 bg-red-950/30 p-3 text-xs text-red-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="min-h-[46px] w-full rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-[#0B0A10] transition-colors hover:bg-[#F3E8EE] disabled:opacity-50"
            >
              {loggingIn ? 'Verificando credenciais...' : 'Entrar no Painel'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const pageSize = 100;
  const totalPages = ledger ? Math.ceil(ledger.raffle.totalTickets / pageSize) : 0;
  const pageStart = numberPage * pageSize + 1;
  const pageEnd = ledger
    ? Math.min(ledger.raffle.totalTickets, (numberPage + 1) * pageSize)
    : 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      {/* Top Admin Workspace Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#958FA8]">
            <button
              type="button"
              onClick={onBackToSite}
              className="hover:text-white"
            >
              Sorteios Brasil
            </button>
            <span aria-hidden="true">/</span>
            <span className="text-[#FF7EB3]">Painel Administrativo</span>
            {ledger && (
              <>
                <span aria-hidden="true">/</span>
                <span className="truncate text-white">{ledger.raffle.shortTitle}</span>
              </>
            )}
          </div>
          <h1 className="mt-1.5 font-display text-3xl font-bold tracking-wide text-white">
            {ledger ? `Cotas e Compradores · ${ledger.raffle.shortTitle}` : 'Gerenciamento de Sorteios'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {ledger ? (
            <button
              type="button"
              onClick={() => setLedger(null)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Todos os Sorteios</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openCreateReferralModal}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10"
              >
                <Tag className="h-3.5 w-3.5 text-[#FF7EB3]" aria-hidden="true" />
                <span>Novo Código</span>
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-bold text-[#0B0A10] hover:bg-[#F3E8EE]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Novo Sorteio</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 px-3.5 py-2 text-xs font-medium text-[#B8B2C8] hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sair ({adminEmail})</span>
          </button>
        </div>
      </div>

      {/* Prominent Referral Winner Bonus Alert (+5% of Total Prize Value) */}
      {referralAlerts.filter((a) => !a.acknowledged).length > 0 && (
        <div className="mt-5 space-y-3">
          {referralAlerts
            .filter((a) => !a.acknowledged)
            .map((alert) => (
              <div
                key={alert.id}
                className="flex flex-col justify-between gap-4 rounded-xl border border-[#FFD166]/50 bg-[#FFD166]/10 p-4 sm:flex-row sm:items-center"
              >
                <div className="flex items-start gap-3">
                  <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-[#FFD166]" aria-hidden="true" />
                  <div className="space-y-1 text-xs">
                    <p className="font-semibold text-[#FFD166]">
                      Indicação Premiada · Bônus Extra de +5% do Prêmio
                    </p>
                    <p className="text-sm text-white">
                      <strong>{alert.buyerName}</strong> ganhou em{' '}
                      <strong>{alert.raffleTitle}</strong> (cota #
                      {padTicketNumber(alert.winningNumber, alert.totalTickets)}) usando o código{' '}
                      <span className="font-mono font-bold text-[#FFD166]">{alert.referralCode}</span>{' '}
                      de <strong>{alert.promoterName}</strong>.
                    </p>
                    <p className="text-[#E2DCEB]">
                      Prêmio total: <span className="font-mono">{formatBRL(alert.prizeValue)}</span>{' '}
                      · Bônus de 5% devido ao indicador:{' '}
                      <strong className="font-mono text-[#FFD166]">
                        {formatBRL(alert.bonusAmount)}
                      </strong>{' '}
                      · Contato/PIX: {alert.promoterContact}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleAckReferralAlert(alert.id)}
                  className="min-h-[38px] shrink-0 rounded-lg bg-[#FFD166] px-4 py-1.5 text-xs font-bold text-[#0B0A10] hover:bg-[#FFE08C]"
                >
                  Marcar Bônus Pago / Ciente
                </button>
              </div>
            ))}
        </div>
      )}

      {actionMessage && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            <span>{actionMessage}</span>
          </span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            aria-label="Dispensar aviso"
            className="text-emerald-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-red-400/35 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            <span>{actionError}</span>
          </span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dispensar erro"
            className="text-red-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Specific Raffle Ledger View (All Numbers + Buyers) */}
      {ledger ? (
        <div className="mt-8 space-y-8">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-[#14111D] p-4">
              <span className="block text-xs text-[#958FA8]">Cotas Vendidas</span>
              <span className="mt-1 block font-mono text-2xl font-bold tabular-nums text-white">
                {ledger.soldCount.toLocaleString('pt-BR')} / {ledger.raffle.totalTickets.toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#14111D] p-4">
              <span className="block text-xs text-[#958FA8]">Valor por Cota</span>
              <span className="mt-1 block font-mono text-2xl font-bold tabular-nums text-white">
                {formatBRL(ledger.raffle.ticketPrice)}
              </span>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#14111D] p-4">
              <span className="block text-xs text-[#958FA8]">Pedidos Registrados</span>
              <span className="mt-1 block font-mono text-2xl font-bold tabular-nums text-[#FFD166]">
                {ledger.reservations.length.toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#14111D] p-4">
              <span className="block text-xs text-[#958FA8]">Status / Ganhador</span>
              <span className="mt-1 block text-sm font-semibold text-white">
                {ledger.raffle.winner
                  ? `Finalizado · #${padTicketNumber(ledger.raffle.winner.winningNumber, ledger.raffle.totalTickets)} (${ledger.raffle.winner.buyerName})`
                  : ledger.raffle.status === 'finalized'
                    ? 'Encerrado (sem ganhador)'
                    : 'Ativo para reservas'}
              </span>
            </div>
          </div>

          {/* Interactive Actions Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#14111D] px-5 py-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => openEditModal(ledger.raffle)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
              >
                <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Editar Sorteio</span>
              </button>
              <button
                type="button"
                onClick={() => openDuplicateModal(ledger.raffle)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Criar novamente</span>
              </button>
              <button
                type="button"
                onClick={() => setWinnerModalRaffle(ledger.raffle)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#FF4E8E] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#E03B78]"
              >
                <Award className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Finalizar & Definir Ganhador</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-[#D6D1E2] hover:bg-white/10 hover:text-white"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Exportar Compradores (CSV)</span>
            </button>
          </div>

          {/* Complete Number Grid Inspector */}
          <section className="rounded-2xl border border-white/10 bg-[#14111D] p-6">
            <div className="flex flex-col justify-between gap-4 border-b border-white/10 pb-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Mapa Completo de Números ({pageStart} a {pageEnd} de{' '}
                  {ledger.raffle.totalTickets.toLocaleString('pt-BR')})
                </h2>
                <p className="mt-0.5 text-xs text-[#958FA8]">
                  Clique em qualquer número para visualizar quem comprou aquela cota.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number.parseInt(jumpNumber.replace(/\D/g, ''), 10);
                    if (!Number.isNaN(n) && n >= 1 && n <= ledger.raffle.totalTickets) {
                      setNumberPage(Math.floor((n - 1) / pageSize));
                      setSelectedNumberDetail({
                        num: n,
                        owner: ledger.numberOwnerMap[n] || null,
                      });
                    }
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    inputMode="numeric"
                    value={jumpNumber}
                    onChange={(e) => setJumpNumber(e.target.value)}
                    placeholder="Ir para cota nº"
                    className="min-h-[36px] w-32 rounded-lg border border-white/15 bg-[#0B0A10] px-2.5 font-mono text-xs text-white focus:border-[#FF4E8E] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="min-h-[36px] rounded-lg border border-white/15 px-3 text-xs font-semibold text-white hover:bg-white/10"
                  >
                    Buscar
                  </button>
                </form>

                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={numberPage === 0}
                      onClick={() => setNumberPage((p) => Math.max(0, p - 1))}
                      className="min-h-[36px] rounded-lg border border-white/15 px-2.5 text-xs text-white disabled:opacity-35"
                    >
                      Anterior
                    </button>
                    <span className="px-2 font-mono text-xs tabular-nums text-[#B8B2C8]">
                      {numberPage + 1}/{totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={numberPage >= totalPages - 1}
                      onClick={() => setNumberPage((p) => Math.min(totalPages - 1, p + 1))}
                      className="min-h-[36px] rounded-lg border border-white/15 px-2.5 text-xs text-white disabled:opacity-35"
                    >
                      Próxima
                    </button>
                  </div>
                )}
              </div>
            </div>

            {selectedNumberDetail && (
              <div className="mt-4 flex flex-col justify-between gap-4 rounded-xl border border-[#FF4E8E]/40 bg-[#FF4E8E]/10 p-4 sm:flex-row sm:items-center">
                <div>
                  <span className="font-mono text-xs font-bold text-[#FF7EB3]">
                    COTA #{padTicketNumber(selectedNumberDetail.num, ledger.raffle.totalTickets)}
                  </span>
                  {selectedNumberDetail.owner ? (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-sm font-semibold text-white">
                        {selectedNumberDetail.owner.buyerName}
                      </p>
                      <p className="text-xs text-[#D6D1E2]">
                        Contato: {selectedNumberDetail.owner.buyerContact}
                        {selectedNumberDetail.owner.reservationId && (
                          <> · Reserva: {selectedNumberDetail.owner.reservationId}</>
                        )}
                        {selectedNumberDetail.owner.status && (
                          <>
                            {' '}
                            · PIX:{' '}
                            <span
                              className={
                                selectedNumberDetail.owner.status === 'pending_payment'
                                  ? 'text-[#FFD166]'
                                  : 'text-emerald-300'
                              }
                            >
                              {selectedNumberDetail.owner.status === 'pending_payment'
                                ? 'Aguardando Pagamento'
                                : 'Confirmado AbacatePay'}
                            </span>
                          </>
                        )}
                        {selectedNumberDetail.owner.referralCode && (
                          <>
                            {' '}
                            · Indicação:{' '}
                            <span className="font-mono text-emerald-300">
                              {selectedNumberDetail.owner.referralCode}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-[#B8B2C8]">
                      Cota disponível (ainda não comprada).
                    </p>
                  )}
                </div>

                {selectedNumberDetail.owner &&
                  selectedNumberDetail.owner.status !== 'pending_payment' && (
                    <button
                      type="button"
                      onClick={() =>
                        handleSetWinner(ledger.raffle.id, 'manual', selectedNumberDetail.num)
                      }
                      className="min-h-[38px] shrink-0 rounded-lg bg-white px-4 py-1.5 text-xs font-bold text-[#0B0A10] hover:bg-[#F3E8EE]"
                    >
                      Definir #{padTicketNumber(selectedNumberDetail.num, ledger.raffle.totalTickets)} como Ganhador
                    </button>
                  )}
              </div>
            )}

            <div className="mt-4 grid grid-cols-5 gap-1.5 sm:grid-cols-10 md:grid-cols-10 lg:grid-cols-10">
              {Array.from({length: pageEnd - pageStart + 1}, (_, i) => pageStart + i).map(
                (num) => {
                  const owner = ledger.numberOwnerMap[num];
                  const isWinner = ledger.raffle.winner?.winningNumber === num;
                  const isFocused = selectedNumberDetail?.num === num;
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setSelectedNumberDetail({num, owner: owner || null})}
                      title={
                        owner
                          ? `#${num} - ${owner.buyerName} (${owner.buyerContact})${owner.referralCode ? ` · Indicação: ${owner.referralCode}` : ''}`
                          : `#${num} - Disponível`
                      }
                      className={`flex h-9 items-center justify-center rounded border font-mono text-xs tabular-nums transition-colors ${
                        isWinner
                          ? 'border-[#FFD166] bg-[#FFD166] font-bold text-[#0B0A10]'
                          : isFocused
                            ? 'border-white bg-white font-bold text-[#0B0A10]'
                            : owner?.source === 'reservation'
                              ? 'border-[#FF4E8E]/50 bg-[#FF4E8E]/20 text-white hover:bg-[#FF4E8E]/35'
                              : owner?.source === 'baseline'
                                ? 'border-white/20 bg-white/10 text-[#C6C0D4] hover:bg-white/20'
                                : 'border-white/10 bg-[#0B0A10] text-[#7D7692] hover:border-white/30 hover:text-white'
                      }`}
                    >
                      {padTicketNumber(num, ledger.raffle.totalTickets)}
                    </button>
                  );
                },
              )}
            </div>
          </section>

          {/* Complete Buyers Ledger Table */}
          <section className="rounded-2xl border border-white/10 bg-[#14111D] p-6">
            <div className="flex flex-col justify-between gap-4 border-b border-white/10 pb-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Compradores e Cotas Reservadas ({filteredLedgerReservations.length})
                </h2>
                <p className="mt-0.5 text-xs text-[#958FA8]">
                  Listagem completa visível apenas para administradores autenticados.
                </p>
              </div>

              <div className="relative w-full sm:w-72">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#958FA8]"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  placeholder="Filtrar nome, contato, nº..."
                  className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] pl-9 pr-3 text-xs text-white placeholder:text-[#7D7692] focus:border-[#FF4E8E] focus:outline-none"
                />
              </div>
            </div>

            {filteredLedgerReservations.length === 0 ? (
              <p className="py-10 text-center text-sm text-[#958FA8]">
                Nenhum comprador encontrado para esse filtro.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[#958FA8]">
                      <th className="py-3 pr-4 font-medium">Reserva</th>
                      <th className="py-3 pr-4 font-medium">Comprador</th>
                      <th className="py-3 pr-4 font-medium">Contato</th>
                      <th className="py-3 pr-4 font-medium">Indicação</th>
                      <th className="py-3 pr-4 font-medium">Cotas Compradas</th>
                      <th className="py-3 pr-4 text-right font-medium">Total Pago</th>
                      <th className="py-3 text-right font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {filteredLedgerReservations.map((resItem) => (
                      <tr key={resItem.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 pr-4">
                          <div className="font-mono font-semibold text-[#FF7EB3]">
                            {resItem.id}
                          </div>
                          <div className="mt-0.5 text-[10px]">
                            {resItem.status === 'pending_payment' ? (
                              <span className="font-semibold text-[#FFD166]">Aguardando PIX</span>
                            ) : (
                              <span className="font-semibold text-emerald-300">Pago AbacatePay</span>
                            )}
                            {resItem.paymentId && (
                              <span className="ml-1 font-mono text-[#8E87A3]">
                                ({resItem.paymentId})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4 font-medium text-white">
                          {resItem.buyerName}
                        </td>
                        <td className="py-3 pr-4 text-[#C6C0D4]">{resItem.buyerContact}</td>
                        <td className="py-3 pr-4">
                          {resItem.referralCode ? (
                            <span className="font-mono text-[11px] text-emerald-300">
                              {resItem.referralCode}
                              {typeof resItem.referralCommissionAmount === 'number' && (
                                <span className="text-[#958FA8]">
                                  {' '}
                                  (+{formatBRL(resItem.referralCommissionAmount)})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[#7D7692]">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {resItem.numbers.map((n) => (
                              <span
                                key={n}
                                className="rounded border border-white/15 bg-[#0B0A10] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white"
                              >
                                {padTicketNumber(n, ledger.raffle.totalTickets)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-right font-mono font-semibold tabular-nums text-white">
                          {formatBRL(resItem.totalPaid)}
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleCancelReservation(resItem.id)}
                            title="Cancelar reserva e liberar cotas"
                            className="inline-flex items-center gap-1 rounded border border-red-400/30 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-950/50"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            <span>Liberar</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : (
        /* Main Overview Tabs */
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-[#14111D] p-1">
              <button
                type="button"
                onClick={() => setActiveTab('raffles')}
                className={`min-h-[36px] whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === 'raffles'
                    ? 'bg-white text-[#0B0A10]'
                    : 'text-[#B8B2C8] hover:text-white'
                }`}
              >
                Sorteios ({raffles.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('referrals')}
                className={`min-h-[36px] whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === 'referrals'
                    ? 'bg-white text-[#0B0A10]'
                    : 'text-[#B8B2C8] hover:text-white'
                }`}
              >
                Indicações & Códigos ({referralCodes.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('security')}
                className={`min-h-[36px] whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === 'security'
                    ? 'bg-white text-[#0B0A10]'
                    : 'text-[#B8B2C8] hover:text-white'
                }`}
              >
                Segurança, RLS & Auditoria ({auditLogs.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => loadOverview(false)}
              disabled={loadingOverview}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-medium text-[#C6C0D4] hover:text-white"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingOverview ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Atualizar</span>
            </button>
          </div>

          {activeTab === 'raffles' ? (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-[#14111D]">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[#958FA8]">
                    <th className="px-5 py-3.5 font-medium">Sorteio</th>
                    <th className="px-4 py-3.5 font-medium">Modalidade</th>
                    <th className="px-4 py-3.5 text-right font-medium">Cotas</th>
                    <th className="px-4 py-3.5 text-right font-medium">Valor / Cota</th>
                    <th className="px-4 py-3.5 text-right font-medium">Prêmio (Soma)</th>
                    <th className="px-4 py-3.5 font-medium">Status / Ganhador</th>
                    <th className="px-5 py-3.5 text-right font-medium">Gerenciar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {raffles.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-white">{r.title}</div>
                        <div className="mt-0.5 text-[11px] text-[#958FA8]">
                          {r.categoryLabel} · {r.region}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-[#C6C0D4]">{r.poolLabel}</td>
                      <td className="px-4 py-4 text-right font-mono tabular-nums text-white">
                        {r.soldCount.toLocaleString('pt-BR')} / {r.totalTickets.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-4 py-4 text-right font-mono font-semibold tabular-nums text-white">
                        {formatBRL(r.ticketPrice)}
                      </td>
                      <td className="px-4 py-4 text-right font-mono tabular-nums text-[#FFD166]">
                        <div>{formatBRL(r.productsTotalValue)}</div>
                        <div className="text-[10px] text-[#958FA8]">
                          Taxa PIX: {formatBRL(r.estimatedGatewayFees ?? r.totalTickets * ABACATEPAY_PIX_FEE_BRL)}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {r.winner ? (
                          <div>
                            <span className="font-medium text-[#FFD166]">
                              Finalizado · #{padTicketNumber(r.winner.winningNumber, r.totalTickets)} ({r.winner.buyerName})
                            </span>
                            {r.winner.referralCode && (
                              <span className="mt-0.5 block font-mono text-[11px] text-emerald-300">
                                Indicação {r.winner.referralCode} (+5% ={' '}
                                {formatBRL(r.winner.referralWinnerBonusAmount || 0)})
                              </span>
                            )}
                          </div>
                        ) : r.status === 'finalized' ? (
                          <span className="font-medium text-[#B8B2C8]">Finalizado</span>
                        ) : (
                          <span className="font-medium text-emerald-300">Ativo</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openLedger(r.id)}
                            disabled={loadingLedger}
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/15"
                          >
                            <Eye className="h-3.5 w-3.5 text-[#FF7EB3]" aria-hidden="true" />
                            <span>Cotas & Compradores</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(r)}
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-[#D6D1E2] hover:bg-white/10 hover:text-white"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openDuplicateModal(r)}
                            title="Criar um novo sorteio com os mesmos itens"
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-[#D6D1E2] hover:bg-white/10 hover:text-white"
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Criar novamente</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setWinnerModalRaffle(r)}
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-[#FF4E8E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#E03B78]"
                          >
                            <Award className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Finalizar / Ganhador</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : activeTab === 'referrals' ? (
            <div className="mt-6 space-y-6">
              {/* Referral KPI Strip */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-[#14111D] p-4">
                  <span className="block text-xs text-[#958FA8]">Códigos Cadastrados</span>
                  <span className="mt-1 block font-mono text-2xl font-bold tabular-nums text-white">
                    {referralCodes.filter((c) => c.active).length} ativos{' '}
                    <span className="text-xs font-normal text-[#958FA8]">/ {referralCodes.length}</span>
                  </span>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#14111D] p-4">
                  <span className="block text-xs text-[#958FA8]">Vendas com Indicação</span>
                  <span className="mt-1 block font-mono text-2xl font-bold tabular-nums text-white">
                    {referralCodes.reduce((s, c) => s + c.salesCount, 0)}{' '}
                    <span className="text-xs font-normal text-[#958FA8]">
                      ({formatBRL(referralCodes.reduce((s, c) => s + c.totalSalesRevenue, 0))})
                    </span>
                  </span>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#14111D] p-4">
                  <span className="block text-xs text-[#958FA8]">Saldo Pendente (A Pagar)</span>
                  <span className="mt-1 block font-mono text-2xl font-bold tabular-nums text-[#FFD166]">
                    {formatBRL(referralCodes.reduce((s, c) => s + c.pendingPayout, 0))}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#958FA8]">
                    Vendas: {formatBRL(referralCodes.reduce((s, c) => s + c.pendingSalesCommission, 0))} · Prêmios: {formatBRL(referralCodes.reduce((s, c) => s + c.pendingWinnerBonus, 0))}
                  </span>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#14111D] p-4">
                  <span className="block text-xs text-[#958FA8]">Total Pago (Baixas)</span>
                  <span className="mt-1 block font-mono text-2xl font-bold tabular-nums text-emerald-300">
                    {formatBRL(referralCodes.reduce((s, c) => s + c.totalPaidOut, 0))}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#958FA8]">
                    {referralPayouts.length} pagamento(s) no histórico
                  </span>
                </div>
              </div>

              {/* Referral Codes Table */}
              <div className="rounded-2xl border border-white/10 bg-[#14111D] p-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Gerenciamento de Códigos de Indicação
                    </h2>
                    <p className="mt-0.5 text-xs text-[#958FA8]">
                      Cada código recebe de 5% a 10% sobre o valor das vendas realizadas e +5% extra do valor total do prêmio caso um indicado vença.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openCreateReferralModal}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-white px-4 py-1.5 text-xs font-bold text-[#0B0A10] hover:bg-[#F3E8EE]"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>Criar Código de Indicação</span>
                  </button>
                </div>

                {referralCodes.length === 0 ? (
                  <p className="py-10 text-center text-sm text-[#958FA8]">
                    Nenhum código de indicação criado ainda. Clique em Criar Código de Indicação.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-[#958FA8]">
                          <th className="py-3 pr-4 font-medium">Código</th>
                          <th className="py-3 pr-4 font-medium">Parceiro / Lives</th>
                          <th className="py-3 pr-4 text-right font-medium">Comissão</th>
                          <th className="py-3 pr-4 text-right font-medium">Vendas (Cotas)</th>
                          <th className="py-3 pr-4 text-right font-medium">Volume Gerado</th>
                          <th className="py-3 pr-4 text-right font-medium">Acumulado (Vendas + 5%)</th>
                          <th className="py-3 pr-4 text-right font-medium">Já Pago</th>
                          <th className="py-3 pr-4 text-right font-medium">Pendente</th>
                          <th className="py-3 pr-4 font-medium">Status</th>
                          <th className="py-3 text-right font-medium">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {referralCodes.map((refItem) => (
                          <tr key={refItem.id} className="hover:bg-white/[0.02]">
                            <td className="py-3.5 pr-4 font-mono font-bold text-[#FF7EB3]">
                              {refItem.code}
                            </td>
                            <td className="py-3.5 pr-4">
                              <div className="flex items-center gap-2.5">
                                <div
                                  className={`relative h-9 w-9 shrink-0 rounded-full border-2 p-0.5 ${
                                    refItem.isLive && refItem.liveLinks?.length > 0
                                      ? 'border-red-500'
                                      : 'border-white/15'
                                  }`}
                                >
                                  {refItem.avatarUrl ? (
                                    <img
                                      src={refItem.avatarUrl}
                                      alt={refItem.promoterName}
                                      referrerPolicy="no-referrer"
                                      className="h-full w-full rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center rounded-full bg-[#1C1726] text-[10px] font-bold text-[#D6D1E2]">
                                      {refItem.promoterName.slice(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium text-white">{refItem.promoterName}</div>
                                  <div className="text-[11px] text-[#958FA8]">{refItem.promoterContact}</div>
                                  {refItem.liveLinks && refItem.liveLinks.length > 0 && (
                                    <div className="mt-1 flex flex-wrap items-center gap-1">
                                      {refItem.liveLinks.map((url) => (
                                        <a
                                          key={url}
                                          href={url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-[#D6D1E2] hover:border-[#FF7EB3]/50 hover:text-white"
                                        >
                                          <span>{detectPlatformLabel(url)}</span>
                                          <ExternalLink className="h-2.5 w-2.5 opacity-70" aria-hidden="true" />
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 pr-4 text-right font-mono font-semibold tabular-nums text-white">
                              {refItem.commissionPct}%
                            </td>
                            <td className="py-3.5 pr-4 text-right font-mono tabular-nums text-[#C6C0D4]">
                              {refItem.salesCount} ({refItem.ticketsCount})
                            </td>
                            <td className="py-3.5 pr-4 text-right font-mono tabular-nums text-white">
                              {formatBRL(refItem.totalSalesRevenue)}
                            </td>
                            <td className="py-3.5 pr-4 text-right font-mono tabular-nums text-[#D6D1E2]">
                              <div>{formatBRL(refItem.totalPayout)}</div>
                              {refItem.winnerBonusCount > 0 && (
                                <div className="text-[10px] text-[#FFD166]">
                                  +{formatBRL(refItem.totalWinnerBonus)} ({refItem.winnerBonusCount}× prêmio)
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 pr-4 text-right font-mono tabular-nums text-emerald-300">
                              {formatBRL(refItem.totalPaidOut)}
                            </td>
                            <td className="py-3.5 pr-4 text-right font-mono font-bold tabular-nums">
                              {refItem.pendingPayout > 0 ? (
                                <span className="text-[#FFD166]">{formatBRL(refItem.pendingPayout)}</span>
                              ) : (
                                <span className="text-[11px] font-medium text-[#958FA8]">
                                  {formatBRL(0)}
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 pr-4">
                              <div className="flex flex-col items-start gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleToggleReferralActive(refItem)}
                                  className={`text-[11px] font-semibold hover:underline ${
                                    refItem.active ? 'text-emerald-300' : 'text-[#958FA8]'
                                  }`}
                                >
                                  {refItem.active ? 'Ativo' : 'Pausado'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleReferralLive(refItem)}
                                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                                    refItem.isLive && refItem.liveLinks?.length > 0
                                      ? 'bg-red-600/20 text-red-300 hover:bg-red-600/30'
                                      : 'bg-white/[0.04] text-[#958FA8] hover:text-white'
                                  }`}
                                  title={
                                    refItem.liveLinks?.length > 0
                                      ? 'Alternar exibição em Lives Parceiras'
                                      : 'Adicionar links de live'
                                  }
                                >
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      refItem.isLive && refItem.liveLinks?.length > 0
                                        ? 'bg-red-500'
                                        : 'bg-[#6E6782]'
                                    }`}
                                  />
                                  <span>
                                    {refItem.liveLinks?.length > 0
                                      ? refItem.isLive
                                        ? 'Live ON'
                                        : 'Live OFF'
                                      : '+ Add Live'}
                                  </span>
                                </button>
                              </div>
                            </td>
                            <td className="py-3.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setInspectReferralId(refItem.id)}
                                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/15"
                                >
                                  <Users className="h-3 w-3 text-[#FF7EB3]" aria-hidden="true" />
                                  <span>Vendas ({refItem.salesCount})</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={refItem.pendingPayout <= 0}
                                  onClick={() => openPayoutModal(refItem)}
                                  className={`inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                    refItem.pendingPayout > 0
                                      ? 'bg-emerald-500 text-[#07150F] hover:bg-emerald-400'
                                      : 'border border-white/10 bg-white/[0.02] text-[#6E6782] cursor-not-allowed'
                                  }`}
                                  title={
                                    refItem.pendingPayout > 0
                                      ? 'Dar baixa / registrar pagamento pendente'
                                      : 'Nenhum saldo pendente'
                                  }
                                >
                                  <Banknote className="h-3 w-3" aria-hidden="true" />
                                  <span>{refItem.pendingPayout > 0 ? 'Pagar' : 'Quitado'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditReferralModal(refItem)}
                                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-[#D6D1E2] hover:bg-white/10 hover:text-white"
                                >
                                  <Edit3 className="h-3 w-3" aria-hidden="true" />
                                  <span>Editar</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteReferral(refItem)}
                                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-red-400/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-950/50"
                                  title="Excluir código"
                                >
                                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Baixa / Pagamento de Indicação & Histórico */}
              <div className="rounded-2xl border border-white/10 bg-[#14111D] p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                  <div className="flex items-center gap-2">
                    <Banknote className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        Baixa & Histórico de Pagamentos de Indicação
                      </h2>
                      <p className="text-xs text-[#958FA8]">
                        Dê baixa nos saldos pendentes para registrar no histórico de pagamentos e zerar o valor a pagar do indicador.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Pending Settlements Quick Bar */}
                {referralCodes.some((c) => c.pendingPayout > 0) ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-[#FFD166]">
                      Códigos com saldo pendente aguardando pagamento:
                    </p>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {referralCodes
                        .filter((c) => c.pendingPayout > 0)
                        .map((pendingRef) => (
                          <div
                            key={pendingRef.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-[#FFD166]/30 bg-[#0B0A10] p-3.5"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-[#FF7EB3]">
                                  {pendingRef.code}
                                </span>
                                <span className="truncate text-xs font-medium text-white">
                                  {pendingRef.promoterName}
                                </span>
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-[#958FA8]">
                                Chave/Contato: {pendingRef.promoterContact}
                              </div>
                              <div className="mt-1 text-[11px] text-[#C6C0D4]">
                                Vendas: {formatBRL(pendingRef.pendingSalesCommission)} · Prêmios (+5%):{' '}
                                {formatBRL(pendingRef.pendingWinnerBonus)}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              <span className="font-mono text-sm font-bold tabular-nums text-[#FFD166]">
                                {formatBRL(pendingRef.pendingPayout)}
                              </span>
                              <button
                                type="button"
                                onClick={() => openPayoutModal(pendingRef)}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-[#07150F] hover:bg-emerald-400"
                              >
                                <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Dar Baixa / Pagar</span>
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-200">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                    <span>
                      Nenhum saldo pendente no momento — todas as comissões e bônus gerados até agora estão quitados.
                    </span>
                  </div>
                )}

                {/* Payout History Table */}
                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#958FA8]">
                    Histórico de Baixas Registradas ({referralPayouts.length})
                  </h3>
                  {referralPayouts.length === 0 ? (
                    <p className="py-6 text-center text-xs text-[#958FA8]">
                      Nenhum pagamento de indicação registrado ainda. Ao clicar em Pagar / Dar Baixa em um código com saldo pendente, o recibo aparecerá aqui.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-white/10 text-[#958FA8]">
                            <th className="py-2.5 pr-4 font-medium">Data / Recibo</th>
                            <th className="py-2.5 pr-4 font-medium">Código / Indicador</th>
                            <th className="py-2.5 pr-4 text-right font-medium">Itens Quitados</th>
                            <th className="py-2.5 pr-4 text-right font-medium">Comissão Vendas</th>
                            <th className="py-2.5 pr-4 text-right font-medium">Bônus Prêmio (+5%)</th>
                            <th className="py-2.5 pr-4 text-right font-medium">Total Pago</th>
                            <th className="py-2.5 font-medium">Observação / Admin</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                          {referralPayouts.map((pay) => (
                            <tr key={pay.id} className="hover:bg-white/[0.02]">
                              <td className="py-3 pr-4">
                                <div className="font-mono text-[11px] text-white">
                                  {new Date(pay.paidAt).toLocaleString('pt-BR')}
                                </div>
                                <div className="font-mono text-[10px] text-[#958FA8]">{pay.id}</div>
                              </td>
                              <td className="py-3 pr-4">
                                <div>
                                  <span className="font-mono font-bold text-[#FF7EB3]">
                                    {pay.referralCode}
                                  </span>{' '}
                                  · <span className="text-white">{pay.promoterName}</span>
                                </div>
                                <div className="text-[11px] text-[#958FA8]">{pay.promoterContact}</div>
                              </td>
                              <td className="py-3 pr-4 text-right font-mono tabular-nums text-[#C6C0D4]">
                                {pay.settledSalesCount} venda(s)
                                {pay.settledAlertsCount > 0 ? ` + ${pay.settledAlertsCount} prêmio(s)` : ''}
                              </td>
                              <td className="py-3 pr-4 text-right font-mono tabular-nums text-white">
                                {formatBRL(pay.salesCommissionPaid)}
                              </td>
                              <td className="py-3 pr-4 text-right font-mono tabular-nums text-[#FFD166]">
                                {formatBRL(pay.winnerBonusPaid)}
                              </td>
                              <td className="py-3 pr-4 text-right font-mono font-bold tabular-nums text-emerald-300">
                                {formatBRL(pay.totalPaid)}
                              </td>
                              <td className="py-3 text-[#C6C0D4]">
                                <div>{pay.note || 'Baixa manual via painel'}</div>
                                <div className="text-[10px] text-[#958FA8]">por {pay.paidBy}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Winner Referral Bonus History (+5% of Total Prize Value) */}
              <div className="rounded-2xl border border-white/10 bg-[#14111D] p-6">
                <div className="flex items-center gap-2 border-b border-white/10 pb-4">
                  <Gift className="h-4 w-4 text-[#FFD166]" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-white">
                    Histórico de Ganhadores por Indicação (+5% do Valor Total do Prêmio)
                  </h2>
                </div>

                {referralAlerts.length === 0 ? (
                  <p className="py-8 text-center text-xs text-[#958FA8]">
                    Quando um comprador que usou um código de indicação vencer um sorteio, o aviso e o bônus extra de 5% do prêmio aparecerão aqui automaticamente.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-[#958FA8]">
                          <th className="py-2.5 pr-4 font-medium">Sorteio / Cota</th>
                          <th className="py-2.5 pr-4 font-medium">Ganhador</th>
                          <th className="py-2.5 pr-4 font-medium">Código / Indicador</th>
                          <th className="py-2.5 pr-4 text-right font-medium">Valor do Prêmio</th>
                          <th className="py-2.5 pr-4 text-right font-medium">Bônus +5%</th>
                          <th className="py-2.5 text-right font-medium">Situação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {referralAlerts.map((al) => (
                          <tr key={al.id}>
                            <td className="py-3 pr-4">
                              <div className="font-medium text-white">{al.raffleTitle}</div>
                              <div className="font-mono text-[11px] text-[#FFD166]">
                                Cota #{padTicketNumber(al.winningNumber, al.totalTickets)}
                              </div>
                            </td>
                            <td className="py-3 pr-4 text-[#D6D1E2]">{al.buyerName}</td>
                            <td className="py-3 pr-4">
                              <span className="font-mono font-bold text-[#FF7EB3]">
                                {al.referralCode}
                              </span>{' '}
                              · <span className="text-white">{al.promoterName}</span>
                              <div className="text-[11px] text-[#958FA8]">{al.promoterContact}</div>
                            </td>
                            <td className="py-3 pr-4 text-right font-mono tabular-nums text-white">
                              {formatBRL(al.prizeValue)}
                            </td>
                            <td className="py-3 pr-4 text-right font-mono font-bold tabular-nums text-[#FFD166]">
                              +{formatBRL(al.bonusAmount)}
                            </td>
                            <td className="py-3 text-right">
                              {al.bonusPaidAt ? (
                                <span className="font-semibold text-emerald-300">Pago na Baixa</span>
                              ) : al.acknowledged ? (
                                <span className="font-semibold text-[#FFD166]">Ciente (Aguardando baixa)</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleAckReferralAlert(al.id)}
                                  className="rounded-lg bg-[#FFD166] px-3 py-1 text-[11px] font-bold text-[#0B0A10] hover:bg-[#FFE08C]"
                                >
                                  Marcar Ciente
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-[#14111D] p-5">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-white">Isolamento PII (RLS)</h3>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#A59FB8]">
                    Rotas públicas retornam apenas números ocupados. Dados de compradores (nome, WhatsApp, e-mail) ficam isolados ao dono via cookie HttpOnly ou ao Admin RBAC.
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#14111D] p-5">
                  <div className="flex items-center gap-2 text-[#FFD166]">
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-white">Preço Autoritativo & Trava</h3>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#A59FB8]">
                    O servidor calcula preços e Order Bump no backend, rejeita campos extras no payload (allowlist estrita) e bloqueia concorrência na reserva atômica.
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#14111D] p-5">
                  <div className="flex items-center gap-2 text-[#FF7EB3]">
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-white">Rate Limit & Scrypt</h3>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#A59FB8]">
                    Login administrativo protegido por hash scrypt com comparação em tempo constante, janela de bloqueio contra força bruta e tokens assinados HMAC-SHA256.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#14111D] p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                  <div className="flex items-center gap-2">
                    <Banknote className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        Gateway PIX AbacatePay v2 (Server-Side)
                      </h2>
                      <p className="text-xs text-[#958FA8]">
                        Checkout Transparente PIX via <span className="font-mono text-[#D6D1E2]">api.abacatepay.com/v2</span> com autenticação protegida por variáveis de ambiente do servidor.
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                      gatewayStatus?.configured
                        ? 'border border-emerald-400/30 bg-emerald-950/40 text-emerald-300'
                        : 'border border-amber-400/35 bg-amber-950/30 text-amber-200'
                    }`}
                  >
                    {gatewayStatus?.configured
                      ? 'ABACATEPAY_API_KEY ativa'
                      : 'Aguardando Secret ABACATEPAY_API_KEY'}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 text-xs md:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-[#0B0A10] p-4">
                    <span className="block text-[11px] text-[#958FA8]">Chave API (Secret)</span>
                    <span className="mt-1 block font-semibold text-white">
                      {gatewayStatus?.configured ? 'Configurada no servidor' : 'Não configurada'}
                    </span>
                    <span className="mt-1 block text-[11px] text-[#958FA8]">
                      Defina <span className="font-mono text-[#D6D1E2]">ABACATEPAY_API_KEY</span> nas Secrets do ambiente.
                    </span>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#0B0A10] p-4">
                    <span className="block text-[11px] text-[#958FA8]">Segredo do Webhook</span>
                    <span className="mt-1 block font-semibold text-white">
                      {gatewayStatus?.webhookConfigured
                        ? 'ABACATEPAY_WEBHOOK_SECRET ativo'
                        : 'Não configurado'}
                    </span>
                    <span className="mt-1 block text-[11px] text-[#958FA8]">
                      Valida notificações <span className="font-mono text-[#D6D1E2]">transparent.completed</span> em tempo constante.
                    </span>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#0B0A10] p-4">
                    <span className="block text-[11px] text-[#958FA8]">Endpoint de Webhook</span>
                    <span className="mt-1 block break-all font-mono text-[11px] text-[#FF7EB3]">
                      /api/webhooks/abacatepay
                    </span>
                    <span className="mt-1 block text-[11px] text-[#958FA8]">
                      Cadastre apenas essa URL na AbacatePay; ela envia o Secret automaticamente em <span className="font-mono text-[#D6D1E2]">?webhookSecret=</span>.
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#14111D] p-6">
                <h2 className="text-base font-semibold text-white">
                  Trilha de Auditoria Administrativa
                </h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-[#958FA8]">
                        <th className="py-2.5 pr-4 font-medium">Data/Hora</th>
                        <th className="py-2.5 pr-4 font-medium">Ator</th>
                        <th className="py-2.5 pr-4 font-medium">Ação</th>
                        <th className="py-2.5 font-medium">Detalhes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="py-2.5 pr-4 font-mono text-[11px] tabular-nums text-[#958FA8]">
                            {new Date(log.timestamp).toLocaleString('pt-BR')}
                          </td>
                          <td className="py-2.5 pr-4 text-white">{log.actor}</td>
                          <td className="py-2.5 pr-4 font-mono text-[11px] text-[#FF7EB3]">
                            {log.action}
                          </td>
                          <td className="py-2.5 text-[#C6C0D4]">{log.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Create / Edit Raffle */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-[#14111D] p-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">
                  {formState.editingId
                    ? 'Editar Sorteio'
                    : formState.duplicatedFromTitle
                      ? 'Criar Sorteio Novamente'
                      : 'Adicionar Novo Sorteio'}
                </h2>
                {!formState.editingId && formState.duplicatedFromTitle && (
                  <p className="mt-1 text-xs text-[#A59FB8]">
                    Mesmos itens de “{formState.duplicatedFromTitle}” (travados). Ajuste o lucro, as cotas ou o valor da cota e confira a data.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-[#B8B2C8] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRaffle} className="mt-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-medium text-[#C6C0D4]">Título do sorteio</label>
                  <input
                    type="text"
                    required
                    value={formState.title}
                    disabled={formItemsLocked}
                    onChange={(e) => setFormState((s) => ({...s, title: e.target.value}))}
                    placeholder="Ex: Combo PS5 Pro + GTA VI Edição Vice"
                    className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white focus:border-[#FF4E8E] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block font-medium text-[#C6C0D4]">Subtítulo / Chamada</label>
                  <input
                    type="text"
                    required
                    value={formState.subtitle}
                    disabled={formItemsLocked}
                    onChange={(e) => setFormState((s) => ({...s, subtitle: e.target.value}))}
                    placeholder="Descrição curta exibida no card da galeria"
                    className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white focus:border-[#FF4E8E] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div>
                  <label htmlFor="raffle-category" className="mb-1 block font-medium text-[#C6C0D4]">
                    Categoria
                  </label>
                  {creatingCategory ? (
                    <div className="flex gap-2">
                      <input
                        id="raffle-category"
                        type="text"
                        autoFocus
                        maxLength={40}
                        value={formState.categoryLabel}
                        onChange={(e) => setFormState((s) => ({...s, categoryLabel: e.target.value}))}
                        placeholder="Nome da nova categoria"
                        className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-[#FF4E8E]/60 bg-[#0B0A10] px-3 text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingCategory(false);
                          setFormState((s) => ({...s, categoryLabel: categoryOptions[0]?.label ?? ''}));
                        }}
                        className="min-h-[40px] rounded-lg border border-white/15 px-3 text-xs text-[#C6C0D4] hover:text-white"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <select
                      id="raffle-category"
                      value={formState.categoryLabel}
                      disabled={formItemsLocked}
                      onChange={(e) => {
                        if (e.target.value === NEW_CATEGORY_OPTION) {
                          setCreatingCategory(true);
                          setFormState((s) => ({...s, categoryLabel: ''}));
                        } else {
                          setFormState((s) => ({...s, categoryLabel: e.target.value}));
                        }
                      }}
                      className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white focus:border-[#FF4E8E] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {categoryOptions.map((c) => (
                        <option key={c.id} value={c.label}>
                          {c.label}
                        </option>
                      ))}
                      <option value={NEW_CATEGORY_OPTION}>+ Nova categoria…</option>
                    </select>
                  )}
                </div>

                <div>
                  <label className="mb-1 block font-medium text-[#C6C0D4]">Modalidade</label>
                  <select
                    value={formState.poolTier}
                    disabled={formItemsLocked}
                    onChange={(e) =>
                      setFormState((s) => ({...s, poolTier: e.target.value as PoolTier}))
                    }
                    className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white focus:border-[#FF4E8E] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="popular">Mais Gente · Valor Menor</option>
                    <option value="exclusive">Menos Pessoas · Alta Chance</option>
                  </select>
                </div>

                
                <div>
                  <label className="mb-1 block font-medium text-[#C6C0D4]">Região de Leonida</label>
                  <input
                    type="text"
                    value={formState.region}
                    disabled={formItemsLocked}
                    onChange={(e) => setFormState((s) => ({...s, region: e.target.value}))}
                    className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white focus:border-[#FF4E8E] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="mb-1 block font-medium text-[#C6C0D4]">
                    Data/Hora do Encerramento (Cronômetro)
                  </label>
                  <input
                    type="datetime-local"
                    value={formState.drawTimestamp}
                    onChange={(e) => setFormState((s) => ({...s, drawTimestamp: e.target.value}))}
                    className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 font-mono text-xs text-white focus:border-[#FF4E8E] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="mb-1 block font-medium text-[#C6C0D4]">Imagem do card</label>
                  <select
                    value={formState.image}
                    disabled={formItemsLocked}
                    onChange={(e) => setFormState((s) => ({...s, image: e.target.value}))}
                    className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-xs text-white focus:border-[#FF4E8E] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {ARTWORK_PRESETS.map((preset) => (
                      <option key={preset.url} value={preset.url}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dynamic Product List + 100% Marketplace Calculator */}
              <div className="rounded-xl border border-white/10 bg-[#0B0A10] p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">
                    Produtos do Prêmio
                  </span>
                  {!formItemsLocked && (
                  <button
                    type="button"
                    onClick={() =>
                      setFormState((s) => ({
                        ...s,
                        products: [...s.products, {name: '', retailPrice: 100}],
                      }))
                    }
                    className="inline-flex items-center gap-1 font-semibold text-[#FF7EB3] hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Adicionar produto</span>
                  </button>
                  )}
                </div>

                {!formItemsLocked && catalog.products.length > 0 && (
                  <div className="mt-3">
                    <span className="block text-[11px] text-[#958FA8]">
                      Produtos já usados (clique para adicionar):
                    </span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {catalog.products
                        .filter(
                          (p) =>
                            !formState.products.some(
                              (fp) => fp.name.trim().toLowerCase() === p.name.toLowerCase(),
                            ),
                        )
                        .map((p) => (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => addCatalogProduct(p)}
                            className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-[#14111D] px-2.5 py-1 text-[11px] text-[#D6D1E2] hover:border-[#FF4E8E]/60 hover:text-white"
                          >
                            <Plus className="h-3 w-3 text-[#FF7EB3]" aria-hidden="true" />
                            <span>{p.name}</span>
                            <span className="font-mono text-[#958FA8]">{formatBRL(p.retailPrice)}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                <datalist id="catalog-products">
                  {catalog.products.map((p) => (
                    <option key={p.name} value={p.name} />
                  ))}
                </datalist>

                <div className="mt-3 space-y-2">
                  {formState.products.map((prod, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        list="catalog-products"
                        value={prod.name}
                        disabled={formItemsLocked}
                        onChange={(e) => {
                          const val = e.target.value;
                          const known = findCatalogProduct(val);
                          setFormState((s) => {
                            const next = [...s.products];
                            next[idx] = known
                              ? {name: known.name, retailPrice: known.retailPrice}
                              : {...next[idx], name: val};
                            return {...s, products: next};
                          });
                        }}
                        placeholder="Nome do produto"
                        className="min-h-[36px] flex-1 rounded-lg border border-white/15 bg-[#14111D] px-2.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <input
                        type="number"
                        min={1}
                        step="0.01"
                        required
                        value={prod.retailPrice}
                        disabled={formItemsLocked}
                        onChange={(e) => {
                          const val = Number.parseFloat(e.target.value || '0');
                          setFormState((s) => {
                            const next = [...s.products];
                            next[idx] = {...next[idx], retailPrice: val};
                            return {...s, products: next};
                          });
                        }}
                        className="min-h-[36px] w-28 rounded-lg border border-white/15 bg-[#14111D] px-2.5 font-mono text-xs text-white disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      {formState.products.length > 1 && !formItemsLocked && (
                        <button
                          type="button"
                          onClick={() =>
                            setFormState((s) => ({
                              ...s,
                              products: s.products.filter((_, i) => i !== idx),
                            }))
                          }
                          className="text-[#958FA8] hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Lucro + modo de precificação (cotas ou valor da cota) */}
                <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="profitPct" className="font-medium text-[#C6C0D4]">
                        Lucro desejado
                        <span className="ml-1 font-normal text-[#958FA8]">(sobre o valor dos prêmios)</span>
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          id="profitPct"
                          type="number"
                          min={0}
                          max={200}
                          step={1}
                          value={formState.profitPct}
                          onChange={(e) =>
                            setFormState((s) => ({
                              ...s,
                              profitPct: Math.min(200, Math.max(0, Number(e.target.value) || 0)),
                            }))
                          }
                          className="min-h-[34px] w-20 rounded-lg border border-white/15 bg-[#14111D] px-2 text-right font-mono text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                        />
                        <span className="font-mono text-sm text-white">%</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      step={5}
                      value={formState.profitPct}
                      onChange={(e) =>
                        setFormState((s) => ({...s, profitPct: Number(e.target.value)}))
                      }
                      aria-label="Lucro desejado em porcentagem"
                      className="mt-2 w-full accent-[#FF4E8E]"
                    />
                    <div className="flex justify-between text-[10px] text-[#958FA8]">
                      <span>0%</span>
                      <span>100%</span>
                      <span>200%</span>
                    </div>
                  </div>

                  <div>
                    <span className="mb-1.5 block font-medium text-[#C6C0D4]">O que você quer definir?</span>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Modo de precificação">
                      {(
                        [
                          {mode: 'tickets', label: 'Quantidade de cotas', hint: 'o valor da cota é calculado'},
                          {mode: 'price', label: 'Valor da cota', hint: 'a quantidade de cotas é calculada'},
                        ] as const
                      ).map((opt) => {
                        const active = formState.pricingMode === opt.mode;
                        return (
                          <button
                            key={opt.mode}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() =>
                              setFormState((s) =>
                                s.pricingMode === opt.mode
                                  ? s
                                  : opt.mode === 'price'
                                    ? {...s, pricingMode: 'price', desiredTicketPrice: formTicketPrice || s.desiredTicketPrice}
                                    : {...s, pricingMode: 'tickets', totalTickets: formTotalTickets || s.totalTickets},
                              )
                            }
                            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                              active
                                ? 'border-[#FF4E8E] bg-[#FF4E8E]/10 text-white'
                                : 'border-white/15 text-[#B8B2C8] hover:border-white/30 hover:text-white'
                            }`}
                          >
                            <span className="block text-xs font-semibold">{opt.label}</span>
                            <span className="block text-[10px] text-[#958FA8]">{opt.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {formState.pricingMode === 'tickets' ? (
                      <>
                        <div>
                          <label htmlFor="totalTickets" className="mb-1 block font-medium text-[#C6C0D4]">
                            Total de cotas
                          </label>
                          <input
                            id="totalTickets"
                            type="number"
                            min={MIN_TOTAL_TICKETS}
                            max={MAX_TOTAL_TICKETS}
                            required
                            value={formState.totalTickets}
                            onChange={(e) =>
                              setFormState((s) => ({
                                ...s,
                                totalTickets: Number.parseInt(e.target.value || '0', 10),
                              }))
                            }
                            className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#14111D] px-3 font-mono text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                          />
                        </div>
                        <div className="rounded-lg border border-white/10 bg-[#14111D] px-3 py-2">
                          <span className="block text-[11px] text-[#958FA8]">Valor da cota (calculado)</span>
                          <span className="font-mono text-lg font-bold text-[#FF7EB3]">
                            {formatBRL(formTicketPrice)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label htmlFor="desiredTicketPrice" className="mb-1 block font-medium text-[#C6C0D4]">
                            Valor da cota (R$)
                          </label>
                          <input
                            id="desiredTicketPrice"
                            type="number"
                            min={1}
                            step="0.01"
                            required
                            value={formState.desiredTicketPrice}
                            onChange={(e) =>
                              setFormState((s) => ({
                                ...s,
                                desiredTicketPrice: Number.parseFloat(e.target.value || '0'),
                              }))
                            }
                            className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#14111D] px-3 font-mono text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                          />
                        </div>
                        <div className="rounded-lg border border-white/10 bg-[#14111D] px-3 py-2">
                          <span className="block text-[11px] text-[#958FA8]">Quantidade de cotas (calculada)</span>
                          <span className="font-mono text-lg font-bold text-[#FF7EB3]">
                            {formTotalTickets.toLocaleString('pt-BR')}
                          </span>
                          {formTicketPrice > 0 && formTicketPrice !== formState.desiredTicketPrice && (
                            <span className="block text-[10px] text-[#958FA8]">
                              Valor final ajustado: {formatBRL(formTicketPrice)} por cota
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {formPricingError && (
                    <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-red-200">
                      {formPricingError}
                    </p>
                  )}

                  <div>
                    <span className="mb-1.5 block font-medium text-[#C6C0D4]">Compra mínima por pessoa</span>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex gap-2">
                        <select
                          aria-label="Tipo de compra mínima"
                          value={formState.minPurchaseMode}
                          onChange={(e) =>
                            setFormState((s) => ({...s, minPurchaseMode: e.target.value as 'tickets' | 'value'}))
                          }
                          className="min-h-[40px] shrink-0 rounded-lg border border-white/15 bg-[#14111D] px-2 text-xs text-white focus:border-[#FF4E8E] focus:outline-none"
                        >
                          <option value="tickets">Cotas</option>
                          <option value="value">Valor (R$)</option>
                        </select>
                        {formState.minPurchaseMode === 'tickets' ? (
                          <input
                            type="number"
                            min={1}
                            step={1}
                            aria-label="Quantidade mínima de cotas"
                            value={formState.minTickets}
                            onChange={(e) =>
                              setFormState((s) => ({...s, minTickets: Number.parseInt(e.target.value || '1', 10)}))
                            }
                            className="min-h-[40px] w-full min-w-0 rounded-lg border border-white/15 bg-[#14111D] px-3 font-mono text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                          />
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            aria-label="Valor mínimo da compra em reais"
                            value={formState.minValue}
                            onChange={(e) =>
                              setFormState((s) => ({...s, minValue: Number.parseFloat(e.target.value || '0')}))
                            }
                            className="min-h-[40px] w-full min-w-0 rounded-lg border border-white/15 bg-[#14111D] px-3 font-mono text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                          />
                        )}
                      </div>
                      <div className="rounded-lg border border-white/10 bg-[#14111D] px-3 py-2">
                        <span className="block text-[11px] text-[#958FA8]">Comprador precisa levar pelo menos</span>
                        <span className="font-mono text-sm font-bold text-white">
                          {formMinTickets.toLocaleString('pt-BR')} {formMinTickets === 1 ? 'cota' : 'cotas'} ·{' '}
                          {formatBRL(Number((formMinTickets * formTicketPrice).toFixed(2)))}
                        </span>
                      </div>
                    </div>
                    {formMinError && (
                      <p role="alert" className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-red-200">
                        {formMinError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
                  <div className="grid grid-cols-2 gap-3 font-mono sm:grid-cols-5">
                    <div>
                      <span className="block font-sans text-[11px] text-[#958FA8]">
                        Soma Produtos
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {formatBRL(formProductsSum)}
                      </span>
                    </div>
                    <div>
                      <span className="block font-sans text-[11px] text-[#958FA8]">
                        Lucro (+{formState.profitPct}%)
                      </span>
                      <span className="text-sm font-semibold text-emerald-300">
                        {formatBRL(formProfitValue)}
                      </span>
                    </div>
                    <div>
                      <span className="block font-sans text-[11px] text-[#958FA8]">
                        Taxa AbacatePay (R$ 0,80/PIX)
                      </span>
                      <span className="text-sm font-semibold text-amber-300">
                        {formatBRL(formGatewayFees)}
                      </span>
                    </div>
                    <div>
                      <span className="block font-sans text-[11px] text-[#958FA8]">
                        Final c/ Taxas PIX
                      </span>
                      <span className="text-sm font-semibold text-[#FFD166]">
                        {formatBRL(formTotalRevenue)}
                      </span>
                    </div>
                    <div>
                      <span className="block font-sans text-[11px] text-[#958FA8]">
                        Valor / Cota
                      </span>
                      <span className="text-sm font-bold text-[#FF7EB3]">
                        {formatBRL(formTicketPrice)}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#958FA8]">
                    Simulação conservadora: considera 1 pagamento PIX separado por cota (
                    {formTotalTickets} × R$ 0,80 ={' '}
                    <span className="font-mono text-[#E2DCEB]">
                      {formatBRL(formGatewayFees)}
                    </span>
                    ), garantindo o prêmio + {formState.profitPct}% de lucro líquido mesmo se cada cota for paga individualmente.
                  </p>
                </div>
              </div>

              {actionError && (
                <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-red-200">
                  {actionError}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="min-h-[40px] rounded-lg border border-white/15 px-4 text-xs font-medium text-[#C6C0D4] hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingForm || Boolean(formPricingError || formMinError)}
                  className="min-h-[40px] rounded-lg bg-white px-5 text-xs font-bold text-[#0B0A10] hover:bg-[#F3E8EE] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingForm
                    ? 'Salvando...'
                    : formState.editingId
                      ? 'Salvar Alterações'
                      : 'Publicar Sorteio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Finalize & Declare Winner */}
      {winnerModalRaffle && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#14111D] p-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h2 className="font-display text-2xl font-bold text-white">
                Finalizar & Definir Ganhador
              </h2>
              <button
                type="button"
                onClick={() => setWinnerModalRaffle(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-[#B8B2C8] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-5 text-xs">
              <div>
                <p className="text-sm font-semibold text-white">{winnerModalRaffle.title}</p>
                <p className="mt-1 text-[#958FA8]">
                  {winnerModalRaffle.soldCount.toLocaleString('pt-BR')} cotas vendidas de{' '}
                  {winnerModalRaffle.totalTickets.toLocaleString('pt-BR')}
                </p>
              </div>

              {winnerModalRaffle.winner && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSaveWinnerAvatar(winnerModalRaffle.id);
                  }}
                  className="space-y-2 rounded-xl border border-[#FFD166]/30 bg-[#FFD166]/5 p-3"
                >
                  <p className="text-sm text-white">
                    Ganhador atual: <strong>{winnerModalRaffle.winner.buyerName}</strong> · #
                    {winnerModalRaffle.winner.winningNumber}
                  </p>
                  {winnerModalRaffle.winner.socialHandle && winnerModalRaffle.winner.socialUrl ? (
                    <a
                      href={winnerModalRaffle.winner.socialUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-[#FF7EB3] hover:text-white"
                    >
                      @{winnerModalRaffle.winner.socialHandle} ({winnerModalRaffle.winner.socialPlatform})
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <p className="text-[#958FA8]">Comprador sem rede social cadastrada.</p>
                  )}
                  <label htmlFor="winner-avatar" className="block pt-1 font-medium text-[#C6C0D4]">
                    Foto do ganhador (link da imagem)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="winner-avatar"
                      type="url"
                      value={winnerAvatarInput}
                      onChange={(e) => setWinnerAvatarInput(e.target.value)}
                      placeholder="https://..."
                      className="min-h-[38px] min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-xs text-white focus:border-[#FF4E8E] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={processingWinner}
                      className="min-h-[38px] rounded-lg bg-[#FFD166] px-3 text-xs font-bold text-[#0B0A10] hover:bg-[#FFE09A] disabled:opacity-50"
                    >
                      Salvar foto
                    </button>
                  </div>
                  <p className="text-[11px] text-[#958FA8]">
                    TikTok e X têm foto automática. Para Instagram/Facebook, abra o perfil, copie o
                    endereço da foto e cole aqui. Em branco = mostra as iniciais.
                  </p>
                </form>
              )}

              <button
                type="button"
                disabled={processingWinner}
                onClick={() => handleSetWinner(winnerModalRaffle.id, 'random_sold')}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#0B0A10] hover:bg-[#F3E8EE] disabled:opacity-50"
              >
                <Shuffle className="h-4 w-4" aria-hidden="true" />
                <span>Sortear Número Aleatório entre Cotas Vendidas</span>
              </button>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSetWinner(winnerModalRaffle.id, 'manual');
                }}
                className="space-y-2 border-t border-white/10 pt-4"
              >
                <label className="block font-medium text-[#C6C0D4]">
                  Ou informe manualmente o número premiado
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={manualWinNumber}
                    onChange={(e) => setManualWinNumber(e.target.value)}
                    placeholder={`1 a ${winnerModalRaffle.totalTickets}`}
                    className="min-h-[40px] flex-1 rounded-lg border border-white/15 bg-[#0B0A10] px-3 font-mono text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={processingWinner || !manualWinNumber}
                    className="min-h-[40px] rounded-lg bg-[#FF4E8E] px-4 font-semibold text-white hover:bg-[#E03B78] disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                </div>
              </form>

              <div className="flex items-center justify-between border-t border-white/10 pt-4">
                {winnerModalRaffle.status === 'active' ? (
                  <button
                    type="button"
                    disabled={processingWinner}
                    onClick={() => handleFinalizeOrReopen(winnerModalRaffle.id, false)}
                    className="text-xs font-semibold text-[#FFD166] hover:underline"
                  >
                    Encerrar vendas sem definir ganhador ainda
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={processingWinner}
                    onClick={() => handleFinalizeOrReopen(winnerModalRaffle.id, true)}
                    className="text-xs font-semibold text-emerald-300 hover:underline"
                  >
                    Reabrir sorteio para vendas
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create / Edit Referral Code */}
      {referralFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-[#14111D] p-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h2 className="font-display text-2xl font-bold text-white">
                {editingReferralId ? 'Editar Código de Indicação' : 'Novo Código de Indicação'}
              </h2>
              <button
                type="button"
                onClick={() => setReferralFormOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-[#B8B2C8] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveReferral} className="mt-5 space-y-4 text-xs">
              <div>
                <label className="mb-1 block font-medium text-[#C6C0D4]">
                  Código (letras/números)
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingReferralId)}
                  value={refCodeInput}
                  onChange={(e) =>
                    setRefCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))
                  }
                  placeholder="Ex: VICE10 ou LUCASVIP"
                  className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 font-mono text-sm uppercase text-white focus:border-[#FF4E8E] focus:outline-none disabled:opacity-60"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-[#C6C0D4]">
                  Nome do Indicador / Parceiro
                </label>
                <input
                  type="text"
                  required
                  value={refPromoterName}
                  onChange={(e) => setRefPromoterName(e.target.value)}
                  placeholder="Ex: Lucas Andrade"
                  className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-[#C6C0D4]">
                  Contato ou Chave PIX para Pagamento
                </label>
                <input
                  type="text"
                  value={refPromoterContact}
                  onChange={(e) => setRefPromoterContact(e.target.value)}
                  placeholder="(11) 99999-9999 ou chave PIX"
                  className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white focus:border-[#FF4E8E] focus:outline-none"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="font-medium text-[#C6C0D4]">
                    Bônus sobre cada venda (5% a 10%)
                  </label>
                  <span className="font-mono text-sm font-bold text-[#FF7EB3]">
                    {refCommissionPct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={10}
                  step={0.5}
                  value={refCommissionPct}
                  onChange={(e) => setRefCommissionPct(Number.parseFloat(e.target.value))}
                  className="w-full accent-[#FF4E8E]"
                />
                <div className="mt-1.5 flex justify-between gap-1.5">
                  {[5, 6, 7, 8, 9, 10].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setRefCommissionPct(pct)}
                      className={`flex-1 rounded border py-1 font-mono text-[11px] font-semibold transition-colors ${
                        refCommissionPct === pct
                          ? 'border-[#FF4E8E] bg-[#FF4E8E]/20 text-white'
                          : 'border-white/10 bg-[#0B0A10] text-[#958FA8] hover:text-white'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-[#958FA8]">
                  Além dos {refCommissionPct}% por venda, se um indicado vencer o sorteio, o sistema gera automaticamente +5% do valor total do prêmio.
                </p>
              </div>

              {/* Partner Live Streams Section */}
              <div className="rounded-xl border border-white/10 bg-[#0B0A10] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-red-400" aria-hidden="true" />
                    <span className="font-semibold text-white">
                      Links das Lives (Multi-plataforma)
                    </span>
                  </div>
                  <span className="text-[11px] text-[#958FA8]">
                    {refLiveLinks.length}/6 links
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-[#958FA8]">
                  Adicione Twitch, YouTube, Kick, TikTok ou Instagram. A foto de perfil redonda será extraída automaticamente de um dos links enviados.
                </p>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Link2
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#958FA8]"
                      aria-hidden="true"
                    />
                    <input
                      type="url"
                      value={refNewLinkInput}
                      onChange={(e) => setRefNewLinkInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddLiveLink();
                        }
                      }}
                      placeholder="https://www.twitch.tv/canal ou youtube.com/@canal"
                      className="min-h-[38px] w-full rounded-lg border border-white/15 bg-[#14111D] pl-8 pr-3 text-xs text-white focus:border-[#FF4E8E] focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddLiveLink}
                    disabled={refLiveLinks.length >= 6}
                    className="inline-flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Adicionar</span>
                  </button>
                </div>

                {refLiveLinks.length > 0 && (
                  <ul className="space-y-1.5">
                    {refLiveLinks.map((url) => (
                      <li
                        key={url}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#14111D] px-2.5 py-1.5"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#FF7EB3]">
                            {detectPlatformLabel(url)}
                          </span>
                          <span className="truncate text-[11px] text-[#D6D1E2]">{url}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveLiveLink(url)}
                          className="shrink-0 rounded p-1 text-[#958FA8] hover:bg-red-950/60 hover:text-red-300"
                          title="Remover link"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {refAvatarUrl && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#14111D] p-2.5">
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <div className="h-11 w-11 rounded-full border-2 border-red-500 p-0.5">
                          <img
                            src={refAvatarUrl}
                            alt={refPromoterName || 'Parceiro'}
                            referrerPolicy="no-referrer"
                            className="h-full w-full rounded-full object-cover"
                          />
                        </div>
                        <span className="absolute -bottom-0.5 -right-2 inline-flex items-center gap-1 rounded-full border border-[#14111D] bg-red-600 px-1.5 py-0.5 text-[8px] font-bold uppercase text-white">
                          <span className="h-1 w-1 rounded-full bg-white" />
                          Live
                        </span>
                      </div>
                      <div className="ml-2">
                        <span className="block text-[11px] font-medium text-white">
                          Foto capturada dos links
                        </span>
                        <span className="block max-w-[200px] truncate text-[10px] text-[#958FA8]">
                          {refAvatarUrl}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setRefAvatarUrl('');
                        setRefForceRefreshAvatar(true);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-[10px] font-medium text-[#D6D1E2] hover:text-white"
                      title="Reextrair automaticamente ao salvar"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden="true" />
                      <span>Reextrair</span>
                    </button>
                  </div>
                )}

                <label className="flex items-center gap-2 pt-1 text-xs text-[#D6D1E2]">
                  <input
                    type="checkbox"
                    checked={refIsLive}
                    onChange={(e) => setRefIsLive(e.target.checked)}
                    className="h-4 w-4 accent-red-500"
                  />
                  <span>Exibir em Lives Parceiras abaixo do título principal (Live)</span>
                </label>
              </div>

              <label className="flex items-center gap-2 text-xs text-[#D6D1E2]">
                <input
                  type="checkbox"
                  checked={refActive}
                  onChange={(e) => setRefActive(e.target.checked)}
                  className="h-4 w-4 accent-[#FF4E8E]"
                />
                <span>Código ativo para uso imediato no checkout</span>
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setReferralFormOpen(false)}
                  className="min-h-[40px] rounded-lg border border-white/15 px-4 text-xs font-medium text-[#C6C0D4] hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingReferral}
                  className="min-h-[40px] rounded-lg bg-white px-5 text-xs font-bold text-[#0B0A10] hover:bg-[#F3E8EE] disabled:opacity-50"
                >
                  {savingReferral ? 'Salvando...' : editingReferralId ? 'Salvar Código' : 'Criar Código'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Vendas & Extrato do Código de Indicação */}
      {inspectReferralCode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/15 bg-[#14111D] p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">
                  Vendas do Código{' '}
                  <span className="font-mono text-[#FF7EB3]">{inspectReferralCode.code}</span>
                </h2>
                <p className="mt-0.5 text-xs text-[#958FA8]">
                  Indicador: {inspectReferralCode.promoterName} ({inspectReferralCode.promoterContact}) · Comissão: {inspectReferralCode.commissionPct}% por venda + 5% do prêmio se vencer
                </p>
              </div>
              <div className="flex items-center gap-2">
                {inspectReferralCode.pendingPayout > 0 && (
                  <button
                    type="button"
                    onClick={() => openPayoutModal(inspectReferralCode)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 text-xs font-bold text-[#07150F] hover:bg-emerald-400"
                  >
                    <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Dar Baixa ({formatBRL(inspectReferralCode.pendingPayout)})</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInspectReferralId(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-[#B8B2C8] hover:text-white"
                  aria-label="Fechar modal de vendas"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-[#0B0A10] p-3">
                <span className="block text-[11px] text-[#958FA8]">Vendas Confirmadas</span>
                <span className="mt-1 block font-mono text-lg font-bold tabular-nums text-white">
                  {inspectReferralCode.salesCount}{' '}
                  <span className="text-xs font-normal text-[#958FA8]">
                    ({inspectReferralCode.ticketsCount} cotas)
                  </span>
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0B0A10] p-3">
                <span className="block text-[11px] text-[#958FA8]">Volume Gerado</span>
                <span className="mt-1 block font-mono text-lg font-bold tabular-nums text-white">
                  {formatBRL(inspectReferralCode.totalSalesRevenue)}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0B0A10] p-3">
                <span className="block text-[11px] text-[#958FA8]">Total Já Pago</span>
                <span className="mt-1 block font-mono text-lg font-bold tabular-nums text-emerald-300">
                  {formatBRL(inspectReferralCode.totalPaidOut)}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0B0A10] p-3">
                <span className="block text-[11px] text-[#958FA8]">Saldo Pendente</span>
                <span
                  className={`mt-1 block font-mono text-lg font-bold tabular-nums ${
                    inspectReferralCode.pendingPayout > 0 ? 'text-[#FFD166]' : 'text-[#958FA8]'
                  }`}
                >
                  {formatBRL(inspectReferralCode.pendingPayout)}
                </span>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#958FA8]">
                Compras Realizadas com {inspectReferralCode.code}
              </h3>
              {inspectReferralCode.recentSales.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-[#0B0A10] py-10 text-center text-xs text-[#958FA8]">
                  Nenhuma compra confirmada utilizou o código {inspectReferralCode.code} até o momento.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#0B0A10]">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-[#958FA8]">
                        <th className="px-3.5 py-2.5 font-medium">Reserva / Data</th>
                        <th className="px-3.5 py-2.5 font-medium">Sorteio</th>
                        <th className="px-3.5 py-2.5 font-medium">Comprador</th>
                        <th className="px-3.5 py-2.5 text-right font-medium">Cotas / Números</th>
                        <th className="px-3.5 py-2.5 text-right font-medium">Valor Pago</th>
                        <th className="px-3.5 py-2.5 text-right font-medium">Bônus</th>
                        <th className="px-3.5 py-2.5 text-right font-medium">Baixa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {inspectReferralCode.recentSales.map((sale) => (
                        <tr key={sale.id} className="hover:bg-white/[0.02]">
                          <td className="px-3.5 py-2.5">
                            <div className="font-mono font-semibold text-[#FF7EB3]">{sale.id}</div>
                            <div className="text-[10px] text-[#958FA8]">
                              {new Date(sale.createdAt).toLocaleString('pt-BR')}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 text-white">{sale.raffleTitle}</td>
                          <td className="px-3.5 py-2.5 text-[#C6C0D4]">
                            <div className="text-white">{sale.buyerName}</div>
                            <div className="text-[11px] text-[#958FA8]">{sale.buyerContact}</div>
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-white">
                            <div>{sale.numbers.length} cota(s)</div>
                            <div className="max-w-[160px] truncate text-[10px] text-[#958FA8]">
                              #{sale.numbers.join(', #')}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-white">
                            {formatBRL(sale.totalPaid)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono font-semibold tabular-nums text-emerald-300">
                            +{formatBRL(sale.referralCommissionAmount || 0)} (
                            {sale.referralCommissionPct ?? inspectReferralCode.commissionPct}%)
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            {sale.referralCommissionPaidAt ? (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                Pago
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-[#FFD166]/15 px-2 py-0.5 text-[10px] font-semibold text-[#FFD166]">
                                Pendente
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {referralPayouts.some((p) => p.referralCode === inspectReferralCode.code) && (
              <div className="mt-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#958FA8]">
                  Baixas Registradas para {inspectReferralCode.code}
                </h3>
                <div className="space-y-1.5">
                  {referralPayouts
                    .filter((p) => p.referralCode === inspectReferralCode.code)
                    .map((p) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0B0A10] px-3.5 py-2 text-xs"
                      >
                        <div>
                          <span className="font-mono text-[#958FA8]">{p.id}</span> ·{' '}
                          <span className="text-white">
                            {new Date(p.paidAt).toLocaleString('pt-BR')}
                          </span>
                          {p.note ? (
                            <span className="text-[#958FA8]"> · {p.note}</span>
                          ) : null}
                        </div>
                        <span className="font-mono font-bold tabular-nums text-emerald-300">
                          {formatBRL(p.totalPaid)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Confirmar Baixa / Pagamento de Indicação */}
      {payoutModalReferral && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#14111D] p-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h2 className="font-display text-2xl font-bold text-white">
                Registrar Pagamento (Baixa)
              </h2>
              <button
                type="button"
                onClick={() => setPayoutModalReferralId(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-[#B8B2C8] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmReferralPayout} className="mt-5 space-y-4 text-xs">
              <div className="rounded-xl border border-white/10 bg-[#0B0A10] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#958FA8]">Código / Parceiro</span>
                  <span className="font-semibold text-white">
                    <span className="font-mono text-[#FF7EB3]">{payoutModalReferral.code}</span> ·{' '}
                    {payoutModalReferral.promoterName}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#958FA8]">Contato / Chave PIX</span>
                  <span className="text-[#D6D1E2]">{payoutModalReferral.promoterContact}</span>
                </div>
                <div className="border-t border-white/10 pt-2 flex items-center justify-between">
                  <span className="text-[#958FA8]">Comissões de Vendas Pendentes</span>
                  <span className="font-mono tabular-nums text-white">
                    {formatBRL(payoutModalReferral.pendingSalesCommission)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#958FA8]">Bônus de Prêmio (+5%) Pendentes</span>
                  <span className="font-mono tabular-nums text-[#FFD166]">
                    {formatBRL(payoutModalReferral.pendingWinnerBonus)}
                  </span>
                </div>
                <div className="border-t border-white/10 pt-2 flex items-center justify-between text-sm font-bold">
                  <span className="text-white">Valor Total a Pagar</span>
                  <span className="font-mono tabular-nums text-emerald-300">
                    {formatBRL(payoutModalReferral.pendingPayout)}
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-medium text-[#C6C0D4]">
                  Observação ou ID do comprovante PIX (opcional)
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={payoutNoteInput}
                  onChange={(e) => setPayoutNoteInput(e.target.value)}
                  placeholder="Ex: PIX enviado dia 18/11 · Comprovante #1234"
                  className="min-h-[40px] w-full rounded-lg border border-white/15 bg-[#0B0A10] px-3 text-sm text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>

              <p className="text-[11px] leading-relaxed text-[#958FA8]">
                Ao confirmar, o valor de {formatBRL(payoutModalReferral.pendingPayout)} será registrado no histórico de pagamentos e o saldo pendente deste código será zerado. Novas vendas futuras acumularão um novo saldo pendente normalmente.
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPayoutModalReferralId(null)}
                  className="min-h-[40px] rounded-lg border border-white/15 px-4 text-xs font-medium text-[#C6C0D4] hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={processingPayout || payoutModalReferral.pendingPayout <= 0}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-500 px-5 text-xs font-bold text-[#07150F] hover:bg-emerald-400 disabled:opacity-50"
                >
                  <Banknote className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {processingPayout ? 'Registrando...' : 'Confirmar Pagamento e Zerar'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
