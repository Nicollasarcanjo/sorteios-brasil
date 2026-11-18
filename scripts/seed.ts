/**
 * Seeder: cria os sorteios iniciais no banco (Supabase, ou db.json se não configurado).
 *
 *   npm run seed
 *
 * Idempotente: pula um sorteio se já existir um ATIVO com o mesmo título.
 * Preços de referência: varejo brasileiro em 18/11/2026 (Amazon, Fast Shop, Havan,
 * Magalu, preço oficial Sony/Rockstar). Ajuste aqui quando o mercado mudar.
 *
 * Rode com o servidor PARADO (o servidor mantém o banco em memória e só
 * enxerga os novos sorteios depois de reiniciar).
 */
import 'dotenv/config';
import {appendAuditLog, getStorageBackend, initStore, readDbSnapshot, withDbTransaction} from '../server/store.ts';
import {buildNewRaffle, parseRaffleInput} from '../server/raffleFactory.ts';

const PRICES = {
  ps5SlimDigital: {name: 'PlayStation 5 Slim Edição Digital 825GB', retailPrice: 4099.9},
  ps5Slim: {name: 'PlayStation 5 Slim com leitor de disco 1TB', retailPrice: 4599.9},
  gta6: {name: 'Grand Theft Auto VI (PS5) — Edição Standard', retailPrice: 449.9},
  dualSense: {name: 'Controle DualSense extra (sem fio)', retailPrice: 429.0},
  tv50: {name: 'Smart TV 50" 4K UHD', retailPrice: 2149.0},
};

/** Data do sorteio: daqui a N dias, 20h no horário de Brasília (UTC-3). */
function drawAt(daysFromNow: number) {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const brt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 0, 0));
  const dd = String(brt.getUTCDate()).padStart(2, '0');
  const mm = String(brt.getUTCMonth() + 1).padStart(2, '0');
  return {drawTimestamp: brt.toISOString(), drawDate: `${dd}/${mm} às 20h00`};
}

const SEEDS = [
  {
    title: 'PS5 + GTA VI',
    shortTitle: 'PS5 + GTA VI',
    subtitle: 'PlayStation 5 Slim Digital com GTA VI para jogar no dia do lançamento.',
    description:
      'Leve um PlayStation 5 Slim Edição Digital (825GB) junto com Grand Theft Auto VI, o lançamento mais aguardado do ano. Prêmio novo, lacrado e com nota fiscal.',
    region: 'Vice City',
    category: 'gta6-ps5',
    poolTier: 'popular',
    totalTickets: 1000,
    image: '/src/assets/images/raffle_ps5_gta6_combo_1795020696195.jpg',
    products: [PRICES.ps5SlimDigital, PRICES.gta6],
    ...drawAt(7),
  },
  {
    title: 'PS5 Slim + DualSense + GTA VI',
    shortTitle: 'PS5 + 2 Controles + GTA VI',
    subtitle: 'PS5 Slim com leitor, controle DualSense extra e GTA VI: pronto para jogar a dois.',
    description:
      'Combo completo: PlayStation 5 Slim com leitor de disco (1TB), um controle DualSense extra e Grand Theft Auto VI. Prêmio novo, lacrado e com nota fiscal.',
    region: 'Vice Beach',
    category: 'gta6-ps5',
    poolTier: 'popular',
    totalTickets: 1000,
    image: '/src/assets/images/raffle_ps5_vip_duo_1795020696967.jpg',
    products: [PRICES.ps5Slim, PRICES.dualSense, PRICES.gta6],
    ...drawAt(10),
  },
  {
    title: 'PS5 + TV 50" 4K + GTA VI',
    shortTitle: 'PS5 + TV 50" + GTA VI',
    subtitle: 'Setup completo: PS5 Slim, Smart TV 50" 4K e GTA VI para jogar em tela grande.',
    description:
      'O setup completo para Leonida: PlayStation 5 Slim com leitor de disco (1TB), Smart TV 50" 4K UHD e Grand Theft Auto VI. Prêmio novo, lacrado e com nota fiscal.',
    region: 'Leonida Keys',
    category: 'gta6-ps5',
    poolTier: 'exclusive',
    totalTickets: 500,
    image: '/src/assets/images/raffle_ps5_setup_4k_1795020697296.jpg',
    products: [PRICES.ps5Slim, PRICES.tv50, PRICES.gta6],
    ...drawAt(14),
  },
];

await initStore();
console.log(`Banco: ${getStorageBackend()}`);

const existingActiveTitles = new Set(
  readDbSnapshot()
    .raffles.filter((r) => r.status === 'active')
    .map((r) => r.title.toLowerCase()),
);

// Insere do último para o primeiro: a galeria mostra o mais recente primeiro,
// então o combo mais barato fica em primeiro na tela.
for (const seed of [...SEEDS].reverse()) {
  if (existingActiveTitles.has(seed.title.toLowerCase())) {
    console.log(`= já existe, pulando: ${seed.title}`);
    continue;
  }
  const parsed = parseRaffleInput(seed as unknown as Record<string, unknown>);
  if (!parsed.ok) throw new Error(`${seed.title}: ${parsed.error}`);
  const raffle = buildNewRaffle(parsed.input);
  await withDbTransaction((db) => {
    db.raffles.unshift(raffle);
    appendAuditLog(
      db,
      'seed',
      'CREATE_RAFFLE',
      raffle.id,
      `Seed: "${raffle.title}" (${raffle.totalTickets} cotas × R$ ${raffle.ticketPrice.toFixed(2)}).`,
    );
  });
  console.log(
    `+ ${raffle.title}: prêmios R$ ${raffle.productsTotalValue.toFixed(2)} · ${raffle.totalTickets} cotas × R$ ${raffle.ticketPrice.toFixed(2)} · arrecadação R$ ${raffle.totalRevenue.toFixed(2)} · sorteio ${raffle.drawDate}`,
  );
}

console.log('Seed concluído.');
