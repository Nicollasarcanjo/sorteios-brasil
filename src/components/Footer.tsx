import React from 'react';
import {RaffleCategory} from '../data/raffles';

interface FooterProps {
  onNavigateHome: () => void;
  onNavigateRaffles: () => void;
  onNavigateHowItWorks: () => void;
  onNavigateRules: () => void;
  rulesLinkLabel: string;
  onOpenMyTickets: () => void;
  onSelectCategoryAnchor: (category: RaffleCategory | 'all') => void;
  reserveMobileBottomSpace: boolean;
}

const footerLinkClass =
  'min-h-10 text-left text-sm text-[#B8B2C8] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7FE5D7]';

export function Footer({
  onNavigateHome,
  onNavigateRaffles,
  onNavigateHowItWorks,
  onNavigateRules,
  rulesLinkLabel,
  onOpenMyTickets,
  onSelectCategoryAnchor,
  reserveMobileBottomSpace,
}: FooterProps) {
  return (
    <footer className="border-t border-white/10 bg-[#08070C]">
      <div
        className={`mx-auto max-w-7xl px-4 pt-10 sm:px-6 sm:pt-12 lg:px-8 ${
          reserveMobileBottomSpace ? 'pb-28 lg:pb-12' : 'pb-10 sm:pb-12'
        }`}
      >
        <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <button
              type="button"
              onClick={onNavigateHome}
              className="font-display text-2xl font-bold tracking-wider text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7FE5D7]"
            >
              SORTEIOS <span className="vice-sunset-text">BRASIL</span>
            </button>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-[#A59FB8]">
              Sorteios temáticos de GTA VI e PlayStation. Confira o prêmio, o valor, as regras e a previsão de cada ação antes de participar.
            </p>
            <button
              type="button"
              onClick={onNavigateRaffles}
              className="mt-4 min-h-10 rounded-lg border border-white/15 px-4 text-sm font-semibold text-white transition-colors hover:border-[#7FE5D7]/60 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7FE5D7]"
            >
              Ver sorteios
            </button>
          </div>

          <nav aria-label="Explorar sorteios" className="lg:col-span-3">
            <h2 className="text-sm font-bold text-white">Explorar</h2>
            <ul className="mt-3 space-y-1">
              <li>
                <button type="button" onClick={onNavigateRaffles} className={footerLinkClass}>
                  Galeria de sorteios
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onSelectCategoryAnchor('gta6')}
                  className={footerLinkClass}
                >
                  Sorteios GTA VI
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onSelectCategoryAnchor('gta6-ps5')}
                  className={footerLinkClass}
                >
                  Combos GTA VI + PS5
                </button>
              </li>
            </ul>
          </nav>

          <nav aria-label="Área do participante" className="lg:col-span-4">
            <h2 className="text-sm font-bold text-white">Área do participante</h2>
            <ul className="mt-3 space-y-1">
              <li>
                <button type="button" onClick={onNavigateHowItWorks} className={footerLinkClass}>
                  Como funciona
                </button>
              </li>
              <li>
                <button type="button" onClick={onNavigateRules} className={footerLinkClass}>
                  {rulesLinkLabel}
                </button>
              </li>
              <li>
                <button type="button" onClick={onOpenMyTickets} className={footerLinkClass}>
                  Minhas cotas e reservas
                </button>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-9 flex flex-col gap-2 border-t border-white/10 pt-5 text-xs leading-relaxed text-[#8E87A3] sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Sorteios Brasil.</span>
          <span>18+ · Consulte as regras e a previsão de cada sorteio antes de participar.</span>
        </div>
      </div>
    </footer>
  );
}
