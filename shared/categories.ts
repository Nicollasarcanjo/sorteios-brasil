/**
 * Categorias de sorteio (livres). Compartilhado entre servidor e front.
 * O admin escolhe uma existente ou cria uma nova pelo nome; o id é derivado do nome.
 * As duas categorias originais mantêm os ids antigos ('gta6', 'gta6-ps5') para
 * não quebrar sorteios e links já existentes.
 */

export interface CategoryOption {
  id: string;
  label: string;
}

export const DEFAULT_CATEGORIES: ReadonlyArray<CategoryOption> = [
  {id: 'gta6', label: 'Somente GTA VI'},
  {id: 'gta6-ps5', label: 'GTA VI + PS5'},
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\+/g, ' mais ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function normalizeCategoryLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function categoryIdFromLabel(label: string): string {
  const clean = normalizeCategoryLabel(label);
  const known = DEFAULT_CATEGORIES.find((c) => c.label.toLowerCase() === clean.toLowerCase());
  return known ? known.id : slugify(clean);
}

/** Resolve categoria a partir do nome (novo formato) ou do id antigo. Inválida → null. */
export function resolveCategory(input: {category?: unknown; categoryLabel?: unknown}): CategoryOption | null {
  if (typeof input.categoryLabel === 'string' && input.categoryLabel.trim()) {
    const label = normalizeCategoryLabel(input.categoryLabel);
    const id = categoryIdFromLabel(label);
    if (label.length < 2 || !id) return null;
    const known = DEFAULT_CATEGORIES.find((c) => c.id === id);
    return {id, label: known ? known.label : label};
  }
  if (typeof input.category === 'string') {
    const known = DEFAULT_CATEGORIES.find((c) => c.id === input.category);
    if (known) return {...known};
  }
  return null;
}

/** Lista única de categorias (padrões + as usadas nos sorteios), na ordem de aparição. */
export function mergeCategories(used: Array<{category: string; categoryLabel: string}>): CategoryOption[] {
  const out = new Map<string, CategoryOption>();
  for (const c of DEFAULT_CATEGORIES) out.set(c.id, {...c});
  for (const r of used) {
    if (r.category && !out.has(r.category)) out.set(r.category, {id: r.category, label: r.categoryLabel});
  }
  return [...out.values()];
}
