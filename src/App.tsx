import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ShieldCheck, Ticket, Users} from 'lucide-react';
import {
  HERO_IMAGE,
  PoolTier,
  PublicLivePartner,
  RaffleCategory,
  RaffleItem,
  sortRafflesUnfinalizedFirst,
  UserReservation,
} from './data/raffles';
import {Header} from './components/Header';
import {Footer} from './components/Footer';
import {ViceEmblem} from './components/ViceLogo';
import {PartnerLivesBar} from './components/PartnerLivesBar';
import {RaffleCard} from './components/RaffleCard';
import {RaffleDetailPage} from './components/RaffleDetailPage';
import {MyTicketsDrawer} from './components/MyTicketsDrawer';
import {AdminDashboard} from './components/AdminDashboard';

type AppRoute =
  | {view: 'home'}
  | {view: 'admin'}
  | {view: 'raffle'; slug: string};

// Painel administrativo: endereço não divulgado no site (sem links públicos).
// O acesso continua protegido pelo login do admin no servidor.
const ADMIN_PATH = '/paineladmsorteio2026';

function parseRouteFromHash(): AppRoute {
  const pathname = window.location.pathname.replace(/\/+$/, '');
  if (pathname === ADMIN_PATH) return {view: 'admin'};
  const hash = window.location.hash;
  const match = hash.match(/^#\/sorteio\/([a-z0-9-]+)(?:\?.*)?$/);
  if (match) return {view: 'raffle', slug: match[1]};
  return {view: 'home'};
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseRouteFromHash());
  const [raffles, setRaffles] = useState<RaffleItem[]>([]);
  const [livePartners, setLivePartners] = useState<PublicLivePartner[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [reservations, setReservations] = useState<UserReservation[]>([]);

  const [categoryFilter, setCategoryFilter] = useState<RaffleCategory | 'all'>('all');
  const [tierFilter, setTierFilter] = useState<PoolTier | 'all'>('all');
  const [ticketsDrawerOpen, setTicketsDrawerOpen] = useState(false);

  const loadLivePartners = useCallback(async () => {
    try {
      const res = await fetch('/api/live-partners', {credentials: 'include'});
      if (res.ok) {
        const data = await res.json();
        setLivePartners(data.partners || []);
      }
    } catch {
      // Ignore transient errors
    }
  }, []);

  const loadPublicCatalog = useCallback(async () => {
    try {
      const res = await fetch('/api/raffles', {credentials: 'include'});
      if (res.ok) {
        const data = await res.json();
        setRaffles(data.raffles || []);
      }
    } catch {
      // Keep current state on transient failure
    } finally {
      setLoadingCatalog(false);
    }
    void loadLivePartners();
  }, [loadLivePartners]);

  const loadBuyerReservations = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      try {
        const token = window.localStorage.getItem('leonida_buyer_bearer_v1');
        if (token) headers['X-Buyer-Token'] = token;
      } catch {
        // Ignore
      }
      const res = await fetch('/api/my-reservations', {
        credentials: 'include',
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        setReservations(data.reservations || []);
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    loadPublicCatalog();
    loadBuyerReservations();
  }, [loadPublicCatalog, loadBuyerReservations]);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseRouteFromHash());
      window.scrollTo({top: 0, behavior: 'smooth'});
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, []);

  const navigateToRaffle = (slug: string) => {
    window.location.hash = `#/sorteio/${slug}`;
    setRoute({view: 'raffle', slug});
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  const navigateHome = (scrollToId?: string) => {
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', '/');
    }
    if (window.location.hash !== '#/' && window.location.hash !== '') {
      window.location.hash = '#/';
    }
    setRoute({view: 'home'});
    if (scrollToId) {
      setTimeout(() => {
        const el = document.getElementById(scrollToId);
        el?.scrollIntoView({behavior: 'smooth'});
      }, 60);
    } else {
      window.scrollTo({top: 0, behavior: 'smooth'});
    }
  };

  const handleSelectCategoryAnchor = (category: RaffleCategory | 'all') => {
    setCategoryFilter(category);
    navigateHome('galeria');
  };

  const handleNavigateRules = () => {
    if (route.view === 'raffle') {
      const rules = document.getElementById('raffle-rules');
      if (rules instanceof HTMLDetailsElement) {
        rules.open = true;
        rules.scrollIntoView({behavior: 'smooth', block: 'center'});
        return;
      }
    }
    // Na galeria, leva o participante à lista para abrir uma ação e consultar
    // o regulamento específico dela.
    navigateHome('galeria');
  };

  const activeRaffle = useMemo(
    () =>
      route.view === 'raffle'
        ? raffles.find((r) => r.slug === route.slug) ?? null
        : null,
    [route, raffles],
  );

  const totalReservedTickets = useMemo(
    () =>
      reservations
        .filter((item) => item.status !== 'cancelled' && item.status !== 'expired')
        .reduce((acc, item) => acc + item.numbers.length, 0),
    [reservations],
  );

  /** Filtros de categoria: só as categorias que têm sorteio publicado. */
  const galleryCategories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of raffles) {
      if (!seen.has(r.category)) seen.set(r.category, r.categoryLabel);
    }
    return [...seen].map(([id, label]) => ({id, label}));
  }, [raffles]);

  const filteredRaffles = useMemo(() => {
    const filtered = raffles.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (tierFilter !== 'all' && item.poolTier !== tierFilter) return false;
      return true;
    });
    return sortRafflesUnfinalizedFirst(filtered);
  }, [raffles, categoryFilter, tierFilter]);

  const handleReservationCreated = useCallback(
    (createdReservation: UserReservation, updatedRaffle?: RaffleItem | null) => {
      setReservations((prev) => {
        const exists = prev.some((item) => item.id === createdReservation.id);
        if (exists) {
          return prev.map((item) =>
            item.id === createdReservation.id ? createdReservation : item,
          );
        }
        return [createdReservation, ...prev];
      });
      if (updatedRaffle) {
        setRaffles((prev) =>
          prev.map((item) => (item.id === updatedRaffle.id ? updatedRaffle : item)),
        );
      }
    },
    [],
  );

  const pendingReservationForActiveRaffle = useMemo(
    () =>
      activeRaffle
        ? reservations.find(
            (res) => res.raffleId === activeRaffle.id && res.status === 'pending_payment',
          ) ?? null
        : null,
    [activeRaffle, reservations],
  );

  return (
    <div className="min-h-screen bg-[#0B0A10] text-[#F5F3F7]">
      <Header
        totalReservedCount={totalReservedTickets}
        onNavigateHome={() => navigateHome()}
        onSelectCategoryAnchor={handleSelectCategoryAnchor}
        onNavigateRules={() => navigateHome('modalidades')}
        onOpenTickets={() => setTicketsDrawerOpen(true)}
      />

      {route.view === 'admin' ? (
        <AdminDashboard
          onBackToSite={() => navigateHome()}
          onCatalogChanged={loadPublicCatalog}
        />
      ) : route.view === 'raffle' && activeRaffle ? (
        <RaffleDetailPage
          key={activeRaffle.id}
          raffle={activeRaffle}
          allRaffles={raffles}
          initialPendingReservation={pendingReservationForActiveRaffle}
          onBackToGallery={() => navigateHome('galeria')}
          onSelectOtherRaffle={navigateToRaffle}
          onReservationCreated={handleReservationCreated}
          onOpenMyTickets={() => setTicketsDrawerOpen(true)}
          livePartners={livePartners}
        />
      ) : (
        <main>
          <section className="relative overflow-hidden border-b border-white/10">
            <div className="absolute inset-0">
              <img
                src={HERO_IMAGE}
                alt="Horizonte de Vice City ao entardecer com letreiros neon e palmeiras"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover object-center opacity-55"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0B0A10] via-[#0B0A10]/88 to-[#0B0A10]/65" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0A10] via-transparent to-[#0B0A10]/70" />
            </div>

            <div className="relative mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-medium text-[#FF7EB3]">
                    Estado de Leonida · Galeria Oficial de Sorteios
                  </p>
                  <h1 className="mt-1.5 font-display text-3xl font-bold leading-tight tracking-wide text-white [text-wrap:balance] sm:text-4xl lg:text-5xl">
                    Sorteios GTA VI & PlayStation 5
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#D4CEDF]">
                    Escolha um card abaixo para abrir a página do sorteio, conferir os prêmios e reservar seus números via PIX AbacatePay com confirmação automática.
                  </p>
                </div>

                <div className="hidden sm:flex shrink-0 flex-col items-end">
                  <ViceEmblem className="w-28 lg:w-36 drop-shadow-[0_12px_28px_rgba(255,78,142,0.28)]" />
                </div>
              </div>
            </div>
          </section>

          <PartnerLivesBar partners={livePartners} />

          <section id="galeria" className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-6 sm:pt-10 lg:px-8 lg:pb-20">
            <div className="flex flex-col justify-between gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-center">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="font-display text-2xl font-bold tracking-wide text-white sm:text-3xl">
                  Sorteios em Destaque
                </h2>
                <span className="text-xs text-[#958FA8]">
                  <span className="font-mono tabular-nums text-[#E2DCEB]">
                    {filteredRaffles.length}
                  </span>{' '}
                  {filteredRaffles.length === 1 ? 'sorteio exibido' : 'sorteios ativos'}
                </span>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#14111D] p-1"
                  role="group"
                  aria-label="Filtrar por prêmio"
                >
                  {[{id: 'all', label: 'Todos'}, ...galleryCategories].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setCategoryFilter(tab.id)}
                      className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                        categoryFilter === tab.id
                          ? 'bg-white text-[#0B0A10]'
                          : 'text-[#B8B2C8] hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#14111D] p-1"
                  role="group"
                  aria-label="Filtrar por modalidade"
                >
                  {(
                    [
                      {id: 'all', label: 'Todas Modalidades'},
                      {id: 'popular', label: 'Mais Gente · Valor Menor'},
                      {id: 'exclusive', label: 'Menos Pessoas · Alta Chance'},
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setTierFilter(tab.id)}
                      className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                        tierFilter === tab.id
                          ? 'bg-[#FF4E8E] text-white'
                          : 'text-[#B8B2C8] hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loadingCatalog ? (
              <div className="mt-10 grid grid-cols-1 gap-7 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className="h-[460px] animate-pulse rounded-2xl border border-white/10 bg-[#14111D]"
                  />
                ))}
              </div>
            ) : raffles.length === 0 ? (
              <div className="mt-10 rounded-2xl border border-dashed border-white/15 bg-[#14111D] px-6 py-14 text-center">
                <p className="text-base font-semibold text-white">
                  Nenhum sorteio publicado no momento
                </p>
                <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[#A59FB8]">
                  Novos sorteios serão anunciados em breve. Volte logo!
                </p>
              </div>
            ) : filteredRaffles.length === 0 ? (
              <div className="mt-10 rounded-2xl border border-dashed border-white/15 bg-[#14111D] px-6 py-14 text-center">
                <p className="text-base font-semibold text-white">
                  Nenhum sorteio encontrado para essa combinação de filtros.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCategoryFilter('all');
                    setTierFilter('all');
                  }}
                  className="mt-4 min-h-[40px] rounded-lg bg-white px-5 py-2 text-sm font-semibold text-[#0B0A10]"
                >
                  Mostrar todos os sorteios
                </button>
              </div>
            ) : (
              <div className="mt-10 grid grid-cols-1 gap-7 md:grid-cols-2 lg:grid-cols-3">
                {filteredRaffles.map((raffle) => (
                  <RaffleCard
                    key={raffle.id}
                    raffle={raffle}
                    onSelectRaffle={navigateToRaffle}
                  />
                ))}
              </div>
            )}
          </section>

          <section
            id="modalidades"
            className="border-t border-white/10 bg-[#100D18] py-16 lg:py-20"
          >
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="max-w-2xl">
                <h2 className="font-display text-3xl font-bold tracking-wide text-white sm:text-4xl">
                  Duas Formas de Participar
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[#B8B2C8]">
                  Escolha a estratégia ideal para o seu perfil: entrar com o menor custo em grupos amplos ou concentrar suas chances em painéis reduzidos.
                </p>
              </div>

              <div className="mt-10 grid grid-cols-1 gap-8 border-t border-white/10 pt-10 md:grid-cols-3">
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 text-[#FF7EB3]">
                    <Users className="h-5 w-5" aria-hidden="true" />
                    <h3 className="text-base font-semibold text-white">
                      Mais Gente · Valor Menor
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-[#A59FB8]">
                    Grupos amplos com centenas ou milhares de cotas e valor individual acessível. Permite acumular pacotes de números em um único PIX.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 text-[#FFD166]">
                    <Ticket className="h-5 w-5" aria-hidden="true" />
                    <h3 className="text-base font-semibold text-white">
                      Menos Pessoas · Alta Chance
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-[#A59FB8]">
                    Painéis exclusivos de apenas <span className="font-mono text-white">50 ou 100</span> participantes. Cada número escolhido no mapa vale{' '}
                    <span className="font-mono text-white">1% a 2%</span> de probabilidade real imediata.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 text-[#7AE0FF]">
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                    <h3 className="text-base font-semibold text-white">
                      Apuração Transparente ao Vivo
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-[#A59FB8]">
                    Assim que a contagem regressiva termina ou 100% das cotas são preenchidas, a extração ocorre ao vivo com código público de auditoria para todos os participantes.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </main>
      )}

      <Footer
        onNavigateHome={() => navigateHome()}
        onNavigateRaffles={() => navigateHome('galeria')}
        onNavigateHowItWorks={() => navigateHome('modalidades')}
        onNavigateRules={handleNavigateRules}
        rulesLinkLabel={route.view === 'raffle' && activeRaffle ? 'Regras desta ação' : 'Consultar regras dos sorteios'}
        onOpenMyTickets={() => setTicketsDrawerOpen(true)}
        onSelectCategoryAnchor={handleSelectCategoryAnchor}
        reserveMobileBottomSpace={route.view === 'raffle' && activeRaffle?.status !== 'finalized'}
      />

      <MyTicketsDrawer
        isOpen={ticketsDrawerOpen}
        onClose={() => setTicketsDrawerOpen(false)}
        reservations={reservations}
        onGoToRaffle={navigateToRaffle}
      />
    </div>
  );
}
