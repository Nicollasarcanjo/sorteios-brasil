import React from 'react';
import {RaffleCategory} from '../data/raffles';

interface FooterProps {
  onNavigateHome: () => void;
  onSelectCategoryAnchor: (category: RaffleCategory | 'all') => void;
  onNavigateAdmin: () => void;
}

export function Footer({
  onNavigateHome,
  onSelectCategoryAnchor,
  onNavigateAdmin,
}: FooterProps) {
  return (
    <footer className="border-t border-white/10 bg-[#08070C] py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-center">
          <div>
            <button
              type="button"
              onClick={onNavigateHome}
              className="font-display text-2xl font-bold tracking-wider text-white"
            >
              SORTEIOS <span className="vice-sunset-text">BRASIL</span>
            </button>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-[#8E87A3]">
              Galeria temática de sorteios inspirada no universo de Vice City e Leonida. Todas as apurações são transmitidas ao vivo com registro verificável.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-sm text-[#B8B2C8]">
            <button
              type="button"
              onClick={() => onSelectCategoryAnchor('all')}
              className="hover:text-white"
            >
              Galeria de Sorteios
            </button>
            <button
              type="button"
              onClick={() => onSelectCategoryAnchor('gta6')}
              className="hover:text-white"
            >
              Sorteios GTA VI
            </button>
            <button
              type="button"
              onClick={() => onSelectCategoryAnchor('gta6-ps5')}
              className="hover:text-white"
            >
              Combos GTA VI + PS5
            </button>
            <button
              type="button"
              onClick={onNavigateAdmin}
              className="text-[#FF7EB3] hover:text-white"
            >
              Painel Administrativo
            </button>
          </div>
        </div>

        <div className="mt-10 flex flex-col justify-between gap-4 border-t border-white/10 pt-6 text-xs text-[#7D7692] sm:flex-row sm:items-center">
          <span>© 2026 Sorteios Brasil. Plataforma com isolamento RLS e auditoria verificada.</span>
          <span>Proibido para menores de 18 anos · Apuração ao Vivo</span>
        </div>
      </div>
    </footer>
  );
}
