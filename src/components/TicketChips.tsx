import React from 'react';

/** Acima disso, mostramos só as primeiras para não pesar a página (compras muito grandes). */
const MAX_RENDERED = 1000;

interface TicketChipsProps {
  numbers: number[];
  format: (num: number) => string;
  chipClassName: string;
  /** Altura máxima da área com rolagem (classe Tailwind). */
  maxHeightClass?: string;
  label?: string;
  /** Quantas cotas renderizar no máximo (padrão 1000). */
  maxRendered?: number;
}

/** Lista de cotas com rolagem interna, para não deixar a tela gigante. */
export function TicketChips({
  numbers,
  format,
  chipClassName,
  maxHeightClass = 'max-h-40',
  label,
  maxRendered = MAX_RENDERED,
}: TicketChipsProps) {
  const shown = numbers.length > maxRendered ? numbers.slice(0, maxRendered) : numbers;
  const hidden = numbers.length - shown.length;

  return (
    <div>
      {label && (
        <span className="mb-1.5 block text-[11px] font-medium text-[#958FA8]">
          {label} ({numbers.length.toLocaleString('pt-BR')})
        </span>
      )}
      <div
        className={`themed-scroll ${maxHeightClass} overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2`}
        tabIndex={0}
        aria-label={label ? `${label}: ${numbers.length} cotas` : `${numbers.length} cotas`}
      >
        <div className="flex flex-wrap gap-1.5">
          {shown.map((num) => (
            <span key={num} className={chipClassName}>
              {format(num)}
            </span>
          ))}
          {hidden > 0 && (
            <span className="px-2 py-0.5 text-[11px] text-[#958FA8]">
              + {hidden.toLocaleString('pt-BR')} cotas
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
