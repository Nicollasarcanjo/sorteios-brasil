/**
 * Limites técnicos de sorteio (compartilhado entre servidor e front).
 * Não é regra de negócio: só evita valores que travariam o navegador/servidor.
 */
export const MIN_TOTAL_TICKETS = 1;
export const MAX_TOTAL_TICKETS = 1_000_000;
