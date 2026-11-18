import fs from 'node:fs';
import path from 'node:path';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {DatabaseState} from './types.ts';

/**
 * Persistência do estado da aplicação.
 *
 * - Com SUPABASE_URL + SUPABASE_SECRET_KEY: Postgres no Supabase (produção).
 *   Cada coleção é uma tabela (id text, data jsonb) — ver supabase/migrations.
 * - Sem elas: arquivo local server/data/db.json (apenas desenvolvimento).
 *
 * O estado fica em memória (leituras síncronas). Toda escrita passa por
 * withDbTransaction, que serializa as escritas e grava no banco apenas as linhas
 * alteradas/criadas/removidas. Pressupõe UMA instância do servidor.
 */

type CollectionKey = keyof DatabaseState;
type Row = {id: string};

const TABLES: Record<CollectionKey, string> = {
  raffles: 'raffles',
  reservations: 'reservations',
  referralCodes: 'referral_codes',
  referralAlerts: 'referral_alerts',
  referralPayouts: 'referral_payouts',
  auditLogs: 'audit_logs',
};
const COLLECTIONS = Object.keys(TABLES) as CollectionKey[];

const DB_DIR = path.resolve(process.cwd(), 'server/data');
const DB_PATH = path.join(DB_DIR, 'db.json');
const PAGE_SIZE = 1000;
const WRITE_CHUNK = 500;

let supabase: SupabaseClient | null = null;
let cachedDb: DatabaseState | null = null;
/** id -> JSON da última versão gravada, por coleção (base para o diff). */
let persisted = new Map<CollectionKey, Map<string, string>>();
let writeQueue: Promise<void> = Promise.resolve();

function createEmptyDatabase(): DatabaseState {
  return {
    raffles: [],
    reservations: [],
    referralCodes: [],
    referralAlerts: [],
    referralPayouts: [],
    auditLogs: [],
  };
}

/** Garante todas as coleções e migra campos antigos. */
function normalizeDatabase(parsed: Partial<DatabaseState>): DatabaseState {
  const db = createEmptyDatabase();
  for (const key of COLLECTIONS) {
    const value = parsed[key];
    if (Array.isArray(value)) {
      (db[key] as unknown[]) = value;
    }
  }
  db.referralCodes = db.referralCodes.map((ref) =>
    Array.isArray(ref.liveLinks) ? ref : {...ref, liveLinks: [], isLive: false},
  );
  return db;
}

function snapshotRows(db: DatabaseState): Map<CollectionKey, Map<string, string>> {
  const snap = new Map<CollectionKey, Map<string, string>>();
  for (const key of COLLECTIONS) {
    const rows = new Map<string, string>();
    for (const item of db[key] as Row[]) {
      rows.set(item.id, JSON.stringify(item));
    }
    snap.set(key, rows);
  }
  return snap;
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  return url && key ? {url, key} : null;
}

export function getStorageBackend(): 'supabase' | 'file' {
  return supabase ? 'supabase' : 'file';
}

// ---------------------------------------------------------------------------
// Arquivo local
// ---------------------------------------------------------------------------

function readLocalFile(): DatabaseState | null {
  if (!fs.existsSync(DB_PATH)) return null;
  return normalizeDatabase(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
}

function writeLocalFile(db: DatabaseState): void {
  fs.mkdirSync(DB_DIR, {recursive: true});
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

async function loadFromSupabase(client: SupabaseClient): Promise<DatabaseState> {
  const parsed: Partial<DatabaseState> = {};
  for (const key of COLLECTIONS) {
    const items: unknown[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const {data, error} = await client
        .from(TABLES[key])
        .select('data')
        .order('seq', {ascending: false}) // coleções guardam o mais novo primeiro
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`Supabase: falha ao ler "${TABLES[key]}": ${error.message}`);
      }
      items.push(...(data ?? []).map((row) => row.data));
      if (!data || data.length < PAGE_SIZE) break;
    }
    (parsed[key] as unknown[]) = items;
  }
  return normalizeDatabase(parsed);
}

async function writeDiffToSupabase(
  client: SupabaseClient,
  db: DatabaseState,
  previous: Map<CollectionKey, Map<string, string>>,
  next: Map<CollectionKey, Map<string, string>>,
): Promise<void> {
  const now = new Date().toISOString();
  for (const key of COLLECTIONS) {
    const table = TABLES[key];
    const before = previous.get(key) ?? new Map<string, string>();
    const after = next.get(key)!;

    const deletedIds = [...before.keys()].filter((id) => !after.has(id));
    for (let i = 0; i < deletedIds.length; i += WRITE_CHUNK) {
      const {error} = await client
        .from(table)
        .delete()
        .in('id', deletedIds.slice(i, i + WRITE_CHUNK));
      if (error) throw new Error(`Supabase: falha ao remover de "${table}": ${error.message}`);
    }

    // Percorre do fim para o início: itens mais antigos são inseridos antes,
    // mantendo a ordem (seq) igual à do array em memória.
    const items = db[key] as Row[];
    const upserts: Array<{id: string; data: Row; updated_at: string}> = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (before.get(item.id) !== after.get(item.id)) {
        upserts.push({id: item.id, data: item, updated_at: now});
      }
    }
    for (let i = 0; i < upserts.length; i += WRITE_CHUNK) {
      const {error} = await client
        .from(table)
        .upsert(upserts.slice(i, i + WRITE_CHUNK), {onConflict: 'id'});
      if (error) throw new Error(`Supabase: falha ao gravar em "${table}": ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// API pública do módulo
// ---------------------------------------------------------------------------

/** Deve ser chamado (e aguardado) antes do servidor aceitar requisições. */
export async function initStore(): Promise<void> {
  const config = getSupabaseConfig();

  if (!config) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[db] SUPABASE_URL/SUPABASE_SECRET_KEY ausentes — usando arquivo local. Os dados serão perdidos a cada deploy!',
      );
    }
    cachedDb = readLocalFile() ?? createEmptyDatabase();
    writeLocalFile(cachedDb);
    persisted = snapshotRows(cachedDb);
    console.log(`[db] Armazenamento: arquivo local (${DB_PATH})`);
    return;
  }

  supabase = createClient(config.url, config.key, {
    auth: {persistSession: false, autoRefreshToken: false},
  });
  const db = await loadFromSupabase(supabase);
  const isEmpty = COLLECTIONS.every((key) => db[key].length === 0);
  persisted = snapshotRows(db);
  cachedDb = db;

  // Primeira execução: importa o que existir no db.json local.
  const local = isEmpty ? readLocalFile() : null;
  if (local && COLLECTIONS.some((key) => local[key].length > 0)) {
    const next = snapshotRows(local);
    await writeDiffToSupabase(supabase, local, persisted, next);
    cachedDb = local;
    persisted = next;
    console.log('[db] Dados do server/data/db.json importados para o Supabase.');
  }

  const counts = COLLECTIONS.map((key) => `${key}=${cachedDb![key].length}`).join(' ');
  console.log(`[db] Armazenamento: Supabase (${new URL(config.url).host}) — ${counts}`);
}

export function readDbSnapshot(): DatabaseState {
  if (!cachedDb) {
    throw new Error('Banco não inicializado: chame initStore() antes de usar o store.');
  }
  return cachedDb;
}

export function withDbTransaction<T>(fn: (db: DatabaseState) => T): Promise<T> {
  const run = writeQueue.then(async () => {
    const db = readDbSnapshot();
    const result = fn(db);
    const next = snapshotRows(db);

    if (supabase) {
      try {
        await writeDiffToSupabase(supabase, db, persisted, next);
      } catch (err) {
        // Memória pode ter ficado à frente do banco: volta ao estado do banco.
        console.error('[db] Falha ao gravar no Supabase; recarregando estado.', err);
        try {
          cachedDb = await loadFromSupabase(supabase);
          persisted = snapshotRows(cachedDb);
        } catch (reloadErr) {
          console.error('[db] Falha ao recarregar do Supabase.', reloadErr);
        }
        throw err;
      }
    } else {
      writeLocalFile(db);
    }

    persisted = next;
    return result;
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function resetCachedDbForCleanState(): Promise<void> {
  await withDbTransaction((db) => {
    for (const key of COLLECTIONS) {
      (db[key] as unknown[]) = [];
    }
  });
}
