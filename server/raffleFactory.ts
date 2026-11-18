import crypto from 'node:crypto';
import {sanitizeText} from './security.ts';
import {TARGET_PROFIT_RATE, buildRafflePricing, parseProfitPct} from './store.ts';
import type {PoolTier, ProductBreakdownItem, RaffleCategory, StoredRaffle} from './types.ts';
import {resolveCategory} from '../shared/categories.ts';
import {MAX_TOTAL_TICKETS, MIN_TOTAL_TICKETS} from '../shared/limits.ts';

/**
 * Validação + montagem de um novo sorteio.
 * Usado pela rota POST /api/admin/raffles e pelo seeder (scripts/seed.ts),
 * para que ambos calculem preço/cotas exatamente da mesma forma.
 */

export interface RaffleInput {
  title: string;
  shortTitle: string;
  subtitle: string;
  region: string;
  category: RaffleCategory;
  categoryLabel: string;
  poolTier: PoolTier;
  totalTickets: number;
  /** Mínimo de cotas por compra (1 a totalTickets). */
  minTicketsPerPurchase: number;
  /** Lucro sobre o valor dos prêmios (0 a 2 = 0% a 200%). */
  targetProfitRate: number;
  drawDate: string;
  drawTimestamp: string;
  orderBumpCount: number;
  orderBumpDiscountPct: number;
  image: string;
  description: string;
  drawRule: string;
  products: ProductBreakdownItem[];
}

export const DEFAULT_RAFFLE_IMAGE = '/src/assets/images/raffle_gta6_standard_1795020694086.jpg';
export const DEFAULT_DRAW_RULE =
  'Apuração transparente realizada ao vivo na plataforma com registro verificável.';

export function parseRaffleInput(
  body: Record<string, unknown>,
): {ok: true; input: RaffleInput} | {ok: false; error: string} {
  const title = sanitizeText(body.title, 120);
  const shortTitle = sanitizeText(body.shortTitle, 60) || title.slice(0, 40);
  const subtitle = sanitizeText(body.subtitle, 240);
  const region = sanitizeText(body.region, 60) || 'Vice City';
  const resolvedCategory = resolveCategory({
    category: body.category,
    categoryLabel: typeof body.categoryLabel === 'string' ? sanitizeText(body.categoryLabel, 60) : undefined,
  });
  if (!resolvedCategory) {
    return {ok: false, error: 'Escolha ou crie uma categoria (mínimo 2 caracteres).'};
  }
  const category: RaffleCategory = resolvedCategory.id;
  const categoryLabel = resolvedCategory.label;
  const poolTier: PoolTier = body.poolTier === 'exclusive' ? 'exclusive' : 'popular';
  const totalTickets = Number(body.totalTickets);
  const targetProfitRate = parseProfitPct(body.profitPct) ?? TARGET_PROFIT_RATE;
  const minTicketsRaw = Number(body.minTicketsPerPurchase ?? 1);
  const drawDate = sanitizeText(body.drawDate, 60) || 'Em breve';
  const drawTimestamp =
    typeof body.drawTimestamp === 'string' && !Number.isNaN(Date.parse(body.drawTimestamp))
      ? new Date(body.drawTimestamp).toISOString()
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const orderBumpCount = Math.max(1, Math.min(20, Number(body.orderBumpCount) || 2));
  const orderBumpDiscountPct = Math.max(5, Math.min(50, Number(body.orderBumpDiscountPct) || 30));
  const image = sanitizeText(body.image, 260) || DEFAULT_RAFFLE_IMAGE;
  const description = sanitizeText(body.description, 600) || subtitle;
  const drawRule = sanitizeText(body.drawRule, 400) || DEFAULT_DRAW_RULE;

  const rawProducts = Array.isArray(body.products) ? body.products : [];
  const products: ProductBreakdownItem[] = rawProducts
    .slice(0, 10)
    .map((p) => {
      const item = p as Record<string, unknown>;
      return {
        name: sanitizeText(item?.name, 120),
        retailPrice: Number(item?.retailPrice),
      };
    })
    .filter((p) => p.name.length >= 2 && Number.isFinite(p.retailPrice) && p.retailPrice > 0);

  if (title.length < 4 || subtitle.length < 6) {
    return {ok: false, error: 'Título e subtítulo são obrigatórios.'};
  }
  if (!Number.isInteger(totalTickets) || totalTickets < MIN_TOTAL_TICKETS || totalTickets > MAX_TOTAL_TICKETS) {
    return {ok: false, error: 'Informe uma quantidade de cotas válida.'};
  }
  if (!Number.isInteger(minTicketsRaw) || minTicketsRaw < 1 || minTicketsRaw > totalTickets) {
    return {ok: false, error: `A compra mínima deve ser entre 1 e ${totalTickets} cotas.`};
  }
  if (products.length === 0) {
    return {ok: false, error: 'Adicione ao menos 1 produto com valor válido.'};
  }

  return {
    ok: true,
    input: {
      title,
      shortTitle,
      subtitle,
      region,
      category,
      categoryLabel,
      poolTier,
      totalTickets,
      minTicketsPerPurchase: minTicketsRaw,
      targetProfitRate,
      drawDate,
      drawTimestamp,
      orderBumpCount,
      orderBumpDiscountPct,
      image,
      description,
      drawRule,
      products,
    },
  };
}

export function buildNewRaffle(input: RaffleInput): StoredRaffle {
  const pricing = buildRafflePricing(input.products, input.totalTickets, input.targetProfitRate);
  const slugBase = input.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  const slug = `${slugBase || 'sorteio'}-${crypto.randomBytes(2).toString('hex')}`;
  const id = `raf-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  return {
    id,
    slug,
    title: input.title,
    shortTitle: input.shortTitle,
    subtitle: input.subtitle,
    region: input.region,
    category: input.category,
    categoryLabel: input.categoryLabel,
    poolTier: input.poolTier,
    poolLabel:
      input.poolTier === 'exclusive' ? 'Menos Pessoas · Alta Chance' : 'Mais Gente · Valor Menor',
    ...pricing,
    minTicketsPerPurchase: input.minTicketsPerPurchase,
    initialSoldCount: 0,
    drawDate: input.drawDate,
    drawTimestamp: input.drawTimestamp,
    orderBumpCount: input.orderBumpCount,
    orderBumpDiscountPct: input.orderBumpDiscountPct,
    editionBadge: input.poolTier === 'exclusive' ? 'Grupo Exclusivo' : 'Cota Popular',
    image: input.image,
    galleryCaption: input.subtitle,
    description: input.description,
    drawRule: input.drawRule,
    status: 'active',
    winner: null,
    createdAt: now,
    updatedAt: now,
  };
}
