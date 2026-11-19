import React from 'react';
import {Ticket} from 'lucide-react';
import {RaffleCategory} from '../data/raffles';

interface HeaderProps {
  totalReservedCount: number;
  onNavigateHome: () => void;
  onSelectCategoryAnchor: (category: RaffleCategory | 'all') => void;
  onNavigateRules: () => void;
  onOpenTickets: () => void;
}

export function Header({
  totalReservedCount,
  onNavigateHome,
  onSelectCategoryAnchor,
  onNavigateRules,
  onOpenTickets,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0B0A10]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onNavigateHome}
          className="font-display text-2xl font-bold tracking-wider text-white whitespace-nowrap shrink-0 transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4E8E]"
        >
          LUCKY <span className="vice-sunset-text">SORTEIOS</span>
        </button>

        <nav
          aria-label="Navegação principal"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-[#B8B2C8]"
        >
          <button
            type="button"
            onClick={() => onSelectCategoryAnchor('all')}
            className="whitespace-nowrap shrink-0 border-b border-transparent py-1 transition-colors hover:border-[#FF4E8E] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4E8E]"
          >
            Galeria
          </button>
          <button
            type="button"
            onClick={() => onSelectCategoryAnchor('gta6')}
            className="whitespace-nowrap shrink-0 border-b border-transparent py-1 transition-colors hover:border-[#FF4E8E] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4E8E]"
          >
            GTA VI
          </button>
          <button
            type="button"
            onClick={() => onSelectCategoryAnchor('gta6-ps5')}
            className="whitespace-nowrap shrink-0 border-b border-transparent py-1 transition-colors hover:border-[#FF4E8E] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4E8E]"
          >
            GTA VI + PS5
          </button>
          <button
            type="button"
            onClick={onNavigateRules}
            className="whitespace-nowrap shrink-0 border-b border-transparent py-1 transition-colors hover:border-[#FF4E8E] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4E8E]"
          >
            Modalidades
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenTickets}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#0B0A10] whitespace-nowrap shrink-0 transition-transform duration-150 hover:bg-[#F3E8EE] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4E8E]"
          >
            <Ticket className="h-4 w-4" aria-hidden="true" />
            <span>Meus Bilhetes</span>
            {totalReservedCount > 0 && (
              <span className="font-mono text-xs font-semibold tabular-nums text-[#C81E65]">
                ({totalReservedCount})
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
