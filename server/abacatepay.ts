import crypto from 'node:crypto';

const ABACATEPAY_BASE_URL = 'https://api.abacatepay.com/v2';

export interface AbacateCustomerPayload {
  name: string;
  email: string;
  cellphone: string;
  taxId: string;
}

export interface AbacateTransparentPixResponse {
  id: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'APPROVED' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';
  devMode: boolean;
  brCode: string;
  brCodeBase64: string;
  expiresAt: string;
  receiptUrl?: string | null;
}

interface AbacateApiEnvelope<T> {
  data?: T;
  success?: boolean;
  error?: string | {message?: string} | null;
}

function getAbacateApiKey(): string {
  return (process.env.ABACATEPAY_API_KEY || '').trim();
}

function getAbacateWebhookSecret(): string {
  return (process.env.ABACATEPAY_WEBHOOK_SECRET || '').trim();
}

export function isAbacatePayConfigured(): boolean {
  return getAbacateApiKey().length >= 8;
}

export function isAbacateWebhookConfigured(): boolean {
  return getAbacateWebhookSecret().length >= 8;
}

export function verifyAbacateWebhookSecret(providedSecret: string): boolean {
  const expected = getAbacateWebhookSecret();
  if (!expected || !providedSecret) return false;
  const a = Buffer.from(providedSecret, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isValidBrazilianCpf(rawCpf: string): boolean {
  const digits = rawCpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * (10 - i);
  }
  let check1 = (sum * 10) % 11;
  if (check1 === 10) check1 = 0;
  if (check1 !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * (11 - i);
  }
  let check2 = (sum * 10) % 11;
  if (check2 === 10) check2 = 0;
  return check2 === Number(digits[10]);
}

export function formatCpf(rawCpf: string): string {
  const d = rawCpf.replace(/\D/g, '').slice(0, 11);
  if (d.length !== 11) return rawCpf.trim();
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

export function maskCpf(rawCpf: string): string {
  const d = rawCpf.replace(/\D/g, '');
  if (d.length !== 11) return '***.***.***-**';
  return `***.${d.slice(3, 6)}.***-${d.slice(9, 11)}`;
}

function extractApiErrorMessage(payload: AbacateApiEnvelope<unknown> | null, fallback: string): string {
  if (!payload || !payload.error) return fallback;
  if (typeof payload.error === 'string') return payload.error;
  if (typeof payload.error === 'object' && typeof payload.error.message === 'string') {
    return payload.error.message;
  }
  return fallback;
}

export const ABACATEPAY_PIX_FEE_BRL = 0.8;

async function tryCreateOrSyncAbacateCustomer(
  apiKey: string,
  customer: AbacateCustomerPayload,
): Promise<string | undefined> {
  try {
    const res = await fetch(`${ABACATEPAY_BASE_URL}/customers/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name: customer.name,
        email: customer.email,
        cellphone: customer.cellphone,
        taxId: formatCpf(customer.taxId),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as AbacateApiEnvelope<{id?: string}>;
    return typeof json?.data?.id === 'string' && json.data.id ? json.data.id : undefined;
  } catch {
    return undefined;
  }
}

export async function createAbacateTransparentPix(params: {
  amountCents: number;
  description: string;
  externalId: string;
  expiresInSeconds?: number;
  customer: AbacateCustomerPayload;
  metadata?: Record<string, string | number | boolean>;
}): Promise<AbacateTransparentPixResponse> {
  const apiKey = getAbacateApiKey();
  if (!apiKey) {
    throw new Error('ABACATEPAY_NOT_CONFIGURED');
  }

  const customerId = await tryCreateOrSyncAbacateCustomer(apiKey, params.customer);

  const payloadData: Record<string, unknown> = {
    amount: Math.round(params.amountCents),
    description: params.description.slice(0, 140),
    expiresIn: params.expiresInSeconds ?? 900,
    externalId: params.externalId,
    customer: {
      name: params.customer.name,
      email: params.customer.email,
      cellphone: params.customer.cellphone,
      taxId: formatCpf(params.customer.taxId),
    },
  };

  if (customerId) {
    payloadData.customerId = customerId;
  }
  if (params.metadata && Object.keys(params.metadata).length > 0) {
    payloadData.metadata = params.metadata;
  }

  const res = await fetch(`${ABACATEPAY_BASE_URL}/transparents/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      method: 'PIX',
      data: payloadData,
    }),
    signal: AbortSignal.timeout(10000),
  });

  let json: AbacateApiEnvelope<AbacateTransparentPixResponse> | null = null;
  try {
    json = (await res.json()) as AbacateApiEnvelope<AbacateTransparentPixResponse>;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.data) {
    const msg = extractApiErrorMessage(json, `Erro HTTP ${res.status} na AbacatePay.`);
    throw new Error(`AbacatePay: ${msg}`);
  }

  return json.data;
}

export async function checkAbacateTransparentPix(
  paymentId: string,
): Promise<AbacateTransparentPixResponse> {
  const apiKey = getAbacateApiKey();
  if (!apiKey) {
    throw new Error('ABACATEPAY_NOT_CONFIGURED');
  }

  const res = await fetch(
    `${ABACATEPAY_BASE_URL}/transparents/check?id=${encodeURIComponent(paymentId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  let json: AbacateApiEnvelope<AbacateTransparentPixResponse> | null = null;
  try {
    json = (await res.json()) as AbacateApiEnvelope<AbacateTransparentPixResponse>;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.data) {
    const msg = extractApiErrorMessage(json, `Erro HTTP ${res.status} ao consultar cobrança PIX.`);
    throw new Error(`AbacatePay: ${msg}`);
  }

  return json.data;
}

export async function simulateAbacateTransparentPix(
  paymentId: string,
): Promise<AbacateTransparentPixResponse> {
  const apiKey = getAbacateApiKey();
  if (!apiKey) {
    throw new Error('ABACATEPAY_NOT_CONFIGURED');
  }

  const res = await fetch(
    `${ABACATEPAY_BASE_URL}/transparents/simulate-payment?id=${encodeURIComponent(paymentId)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    },
  );

  let json: AbacateApiEnvelope<AbacateTransparentPixResponse> | null = null;
  try {
    json = (await res.json()) as AbacateApiEnvelope<AbacateTransparentPixResponse>;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.data) {
    const msg = extractApiErrorMessage(
      json,
      `Erro HTTP ${res.status} ao simular pagamento na AbacatePay.`,
    );
    throw new Error(`AbacatePay: ${msg}`);
  }

  return json.data;
}
