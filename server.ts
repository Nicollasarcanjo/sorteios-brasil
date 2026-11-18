import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {createServer as createViteServer} from 'vite';
import {
  checkLoginRateLimit,
  clearAdminSessionCookie,
  clearLoginAttempts,
  getMaskedAdminEmailHint,
  getOrCreateBuyerSession,
  isCustomAdminConfigured,
  isValidSlug,
  maskBuyerDisplayName,
  maskContact,
  readAdminSession,
  readBuyerSession,
  recordFailedLoginAttempt,
  requireAdminMiddleware,
  sanitizeText,
  setAdminSessionCookie,
  verifyAdminCredentials,
} from './server/security.ts';
import {
  appendAuditLog,
  buildAdminReferralSummaries,
  buildPublicLivePartners,
  buildRafflePricing,
  parseProfitPct,
  getAllSoldNumbersForRaffle,
  getStorageBackend,
  initStore,
  isReservationHoldingNumbers,
  readDbSnapshot,
  toPublicRaffleProjection,
  withDbTransaction,
} from './server/store.ts';
import {
  checkAbacateTransparentPix,
  createAbacateTransparentPix,
  formatCpf,
  isAbacatePayConfigured,
  isAbacateWebhookConfigured,
  isValidBrazilianCpf,
  maskCpf,
  simulateAbacateTransparentPix,
  verifyAbacateWebhookSecret,
} from './server/abacatepay.ts';
import {
  isSafePublicHttpUrl,
  normalizeLiveLinks,
  resolvePartnerAvatarFromLinks,
} from './server/liveResolver.ts';
import {buildNewRaffle, parseRaffleInput} from './server/raffleFactory.ts';
import {
  isSocialPlatform,
  normalizeSocialHandle,
  socialAvatarUrl,
  socialProfileUrl,
} from './shared/social.ts';
import {mergeCategories, resolveCategory} from './shared/categories.ts';
import type {
  ProductBreakdownItem,
  ReferralPayoutRecord,
  ReferralWinnerAlert,
  StoredRaffle,
  StoredReferralCode,
  StoredReservation,
} from './server/types.ts';

const PORT = Number(process.env.PORT || 3000);
// `node server.ts --production` (npm start) liga o modo produção em qualquer SO.
if (process.argv.includes('--production')) {
  process.env.NODE_ENV = 'production';
}
const IS_PROD = process.env.NODE_ENV === 'production';

/** Em produção, não sobe sem os segredos essenciais (evita senha padrão de dev no ar). */
function assertProductionConfig(): void {
  if (!IS_PROD) return;
  const isSet = (name: string, minLen = 1) => {
    const v = process.env[name]?.trim() ?? '';
    return v.length >= minLen && !v.startsWith('CHANGE_ME') && !v.startsWith('MY_');
  };
  const missing = [
    !isSet('SUPABASE_URL') && 'SUPABASE_URL',
    !isSet('SUPABASE_SECRET_KEY') && !isSet('SUPABASE_SERVICE_ROLE_KEY') && 'SUPABASE_SECRET_KEY',
    !isSet('ADMIN_EMAIL') && 'ADMIN_EMAIL',
    !isSet('ADMIN_PASSWORD', 8) && 'ADMIN_PASSWORD (mín. 8 caracteres)',
    !isSet('SESSION_SECRET', 16) && 'SESSION_SECRET (mín. 16 caracteres)',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente obrigatórias ausentes em produção: ${missing.join(', ')}`);
  }
}

async function startServer() {
  assertProductionConfig();

  // Carrega o banco (Supabase ou arquivo local) antes de aceitar requisições.
  await initStore();

  const app = express();
  app.set('trust proxy', 1);

  // Express 4 não captura rejeições de handlers async: encaminha para o
  // error handler (ex.: falha ao gravar no Supabase) em vez de derrubar o processo.
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const original = app[method].bind(app) as (...args: unknown[]) => unknown;
    (app as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      if (args.length < 2) return original(...args); // app.get('setting')
      const wrapped = args.map((handler) => {
        if (typeof handler !== 'function' || handler.length >= 4) return handler;
        return (req: express.Request, res: express.Response, next: express.NextFunction) => {
          try {
            const out = handler(req, res, next);
            if (out && typeof (out as Promise<unknown>).then === 'function') {
              (out as Promise<unknown>).catch(next);
            }
          } catch (err) {
            next(err);
          }
        };
      });
      return original(...wrapped);
    };
  }

  // Strict payload size bound (Denial-of-Wallet / DoS guard)
  app.use(express.json({limit: '64kb'}));

  // Security headers (preserve iframe embedding in AI Studio preview)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // =========================================================================
  // PUBLIC CATALOG ROUTES (Strictly PII-free via toPublicRaffleProjection)
  // =========================================================================

  app.get('/api/raffles', (_req, res) => {
    const db = readDbSnapshot();
    const list = db.raffles.map((r) => toPublicRaffleProjection(r, db.reservations));
    res.json({raffles: list});
  });

  app.get('/api/raffles/:slug', (req, res) => {
    const {slug} = req.params;
    if (!isValidSlug(slug)) {
      res.status(400).json({error: 'Slug de sorteio inválido.'});
      return;
    }
    const db = readDbSnapshot();
    const raffle = db.raffles.find((r) => r.slug === slug);
    if (!raffle) {
      res.status(404).json({error: 'Sorteio não encontrado.'});
      return;
    }
    res.json({raffle: toPublicRaffleProjection(raffle, db.reservations)});
  });

  app.get('/api/referrals/validate', (req, res) => {
    const rawCode = sanitizeText(req.query.code, 24).toUpperCase();
    if (!rawCode || !/^[A-Z0-9_-]{3,24}$/.test(rawCode)) {
      res.json({valid: false});
      return;
    }
    const db = readDbSnapshot();
    const matched = db.referralCodes.find(
      (c) => c.code.toUpperCase() === rawCode && c.active,
    );
    if (!matched) {
      res.json({valid: false});
      return;
    }
    // Public response strictly omits promoter contact, commission %, and earnings
    res.json({
      valid: true,
      code: matched.code,
      promoterLabel: maskBuyerDisplayName(matched.promoterName),
    });
  });

  app.get('/api/live-partners', (_req, res) => {
    const db = readDbSnapshot();
    res.json({partners: buildPublicLivePartners(db)});
  });

  // =========================================================================
  // BUYER RLS ROUTES (Owner-scoped via signed HttpOnly buyer session cookie)
  // =========================================================================

  app.get('/api/my-reservations', (req, res) => {
    const session = readBuyerSession(req);
    if (!session) {
      res.json({reservations: []});
      return;
    }
    const db = readDbSnapshot();
    const nowMs = Date.now();
    // RLS Enforcement: ONLY return reservations owned by session.sub
    const ownReservations = db.reservations
      .filter(
        (r) =>
          r.ownerId === session.sub &&
          (r.status === 'confirmed' ||
            (r.status === 'pending_payment' && isReservationHoldingNumbers(r, nowMs)) ||
            r.status === 'expired'),
      )
      .slice(0, 50);
    res.json({reservations: ownReservations});
  });

  app.post('/api/reservations', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({error: 'Corpo da requisição inválido.'});
      return;
    }

    // Strict allowlist check (reject shadow / privilege-escalation fields)
    const allowedKeys = new Set([
      'raffleId',
      'numbers',
      'buyerName',
      'buyerEmail',
      'buyerPhone',
      'buyerTaxId',
      'buyerContact',
      'buyerSocialPlatform',
      'buyerSocialHandle',
      'applyOrderBump',
      'referralCode',
    ]);
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        res.status(400).json({error: `Campo não permitido no payload: ${key}`});
        return;
      }
    }

    const raffleId = sanitizeText(body.raffleId, 64);
    const buyerName = sanitizeText(body.buyerName, 80);
    const buyerEmail = sanitizeText(body.buyerEmail, 120).toLowerCase();
    const buyerPhone = sanitizeText(body.buyerPhone || body.buyerContact, 40);
    const buyerTaxIdRaw = sanitizeText(body.buyerTaxId, 20);
    const buyerSocialPlatform = isSocialPlatform(body.buyerSocialPlatform)
      ? body.buyerSocialPlatform
      : null;
    const buyerSocialHandle = buyerSocialPlatform
      ? normalizeSocialHandle(buyerSocialPlatform, sanitizeText(body.buyerSocialHandle, 200))
      : null;
    const applyOrderBump = body.applyOrderBump === true;
    const referralCodeInput = sanitizeText(body.referralCode, 24).toUpperCase();
    const rawNumbers = body.numbers;

    if (!raffleId || !/^[a-zA-Z0-9_-]+$/.test(raffleId)) {
      res.status(400).json({error: 'Identificador do sorteio inválido.'});
      return;
    }
    if (buyerName.length < 3) {
      res.status(400).json({error: 'Informe seu nome completo (mínimo 3 caracteres).'});
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      res.status(400).json({error: 'Informe um e-mail válido para receber seu comprovante.'});
      return;
    }
    if (buyerPhone.replace(/\D/g, '').length < 10) {
      res.status(400).json({error: 'Informe um WhatsApp/celular válido com DDD.'});
      return;
    }
    if (!buyerSocialPlatform || !buyerSocialHandle) {
      res.status(400).json({
        error: 'Informe sua rede social (Instagram, TikTok, X ou Facebook) com um @ válido.',
      });
      return;
    }
    if (!isValidBrazilianCpf(buyerTaxIdRaw)) {
      res.status(400).json({error: 'Informe um CPF válido (necessário para emissão do PIX AbacatePay).'});
      return;
    }
    if (!Array.isArray(rawNumbers) || rawNumbers.length === 0 || rawNumbers.length > 200) {
      res.status(400).json({error: 'Selecione entre 1 e 200 cotas por reserva.'});
      return;
    }

    if (!isAbacatePayConfigured()) {
      res.status(503).json({
        error:
          'Gateway AbacatePay não configurado. Adicione a chave ABACATEPAY_API_KEY nos Secrets do ambiente para gerar cobranças PIX.',
        gatewayNotConfigured: true,
      });
      return;
    }

    const requestedNumbers = Array.from(
      new Set(
        rawNumbers.map((n) => (typeof n === 'number' && Number.isInteger(n) ? n : -1)),
      ),
    );
    if (requestedNumbers.some((n) => n < 1)) {
      res.status(400).json({error: 'Lista de números contém valores inválidos.'});
      return;
    }

    const {session: buyerSession, token: buyerToken} = getOrCreateBuyerSession(req, res);

    try {
      // Step 1: Atomically lock the requested numbers as pending_payment
      const holdResult = await withDbTransaction((db) => {
        const raffle = db.raffles.find((r) => r.id === raffleId);
        if (!raffle) {
          return {status: 404 as const, payload: {error: 'Sorteio não encontrado.'}};
        }
        if (raffle.status !== 'active') {
          return {
            status: 409 as const,
            payload: {error: 'Este sorteio já foi encerrado e não aceita novas cotas.'},
          };
        }
        if (requestedNumbers.some((n) => n > raffle.totalTickets)) {
          return {
            status: 400 as const,
            payload: {
              error: `Os números devem estar entre 1 e ${raffle.totalTickets}.`,
            },
          };
        }

        const soldSet = getAllSoldNumbersForRaffle(raffle, db.reservations);
        const conflicts = requestedNumbers.filter((n) => soldSet.has(n));
        if (conflicts.length > 0) {
          return {
            status: 409 as const,
            payload: {
              error: `As cotas ${conflicts.join(', ')} já foram reservadas ou estão aguardando PIX. Atualize sua seleção.`,
            },
          };
        }

        const selectedSet = new Set(requestedNumbers);
        const bonusNumbers: number[] = [];

        if (applyOrderBump && raffle.orderBumpCount > 0) {
          const availableForBump: number[] = [];
          for (let i = 1; i <= raffle.totalTickets; i++) {
            if (!soldSet.has(i) && !selectedSet.has(i)) {
              availableForBump.push(i);
            }
          }
          const bumpTarget = Math.min(raffle.orderBumpCount, availableForBump.length);
          for (let i = 0; i < bumpTarget; i++) {
            const idx = Math.floor(Math.random() * availableForBump.length);
            bonusNumbers.push(availableForBump[idx]);
            availableForBump.splice(idx, 1);
          }
        }

        const finalNumbers = [...requestedNumbers, ...bonusNumbers].sort((a, b) => a - b);

        let matchedReferral: StoredReferralCode | undefined;
        if (referralCodeInput.length > 0) {
          if (!/^[A-Z0-9_-]{3,24}$/.test(referralCodeInput)) {
            return {
              status: 400 as const,
              payload: {error: 'Formato de código de indicação inválido.'},
            };
          }
          matchedReferral = db.referralCodes.find(
            (c) => c.code.toUpperCase() === referralCodeInput && c.active,
          );
          if (!matchedReferral) {
            return {
              status: 400 as const,
              payload: {error: 'Código de indicação inválido ou inativo no momento.'},
            };
          }
        }

        // Server-Authoritative Pricing Calculation (zero trust on client totals)
        const baseCost = requestedNumbers.length * raffle.ticketPrice;
        const bumpCost =
          bonusNumbers.length *
          raffle.ticketPrice *
          (1 - raffle.orderBumpDiscountPct / 100);
        const totalPaid = Number((baseCost + bumpCost).toFixed(2));

        const referralCommissionPct = matchedReferral ? matchedReferral.commissionPct : undefined;
        const referralCommissionAmount = matchedReferral
          ? Number((totalPaid * (matchedReferral.commissionPct / 100)).toFixed(2))
          : undefined;

        const reservationId = `LND-${crypto.randomInt(10000, 99999)}`;
        const nowMs = Date.now();
        const holdRecord: StoredReservation = {
          id: reservationId,
          ownerId: buyerSession.sub,
          raffleId: raffle.id,
          raffleSlug: raffle.slug,
          raffleTitle: raffle.title,
          raffleImage: raffle.image,
          numbers: finalNumbers,
          totalPaid,
          buyerName,
          buyerContact: `${buyerPhone} · ${buyerEmail}`,
          buyerEmail,
          buyerPhone,
          buyerTaxIdMasked: maskCpf(buyerTaxIdRaw),
          buyerSocialPlatform,
          buyerSocialHandle,
          orderBumpApplied: bonusNumbers.length > 0,
          ...(matchedReferral
            ? {
                referralCode: matchedReferral.code,
                referralPromoterName: matchedReferral.promoterName,
                referralCommissionPct,
                referralCommissionAmount,
              }
            : {}),
          paymentGateway: 'abacatepay',
          paymentStatus: 'PENDING',
          paymentExpiresAt: new Date(nowMs + 15 * 60 * 1000).toISOString(),
          status: 'pending_payment',
          createdAt: new Date(nowMs).toISOString(),
        };

        db.reservations.unshift(holdRecord);
        return {
          status: 200 as const,
          hold: holdRecord,
          raffleTitle: raffle.shortTitle,
        };
      });

      if (holdResult.status !== 200) {
        res.status(holdResult.status).json(holdResult.payload);
        return;
      }

      const hold = holdResult.hold;

      // Step 2: Create Transparent PIX charge in AbacatePay v2
      let pixCharge;
      try {
        pixCharge = await createAbacateTransparentPix({
          amountCents: Math.round(hold.totalPaid * 100),
          description: `${holdResult.raffleTitle} (${hold.numbers.length} cotas) - ${hold.id}`,
          externalId: hold.id,
          expiresInSeconds: 900,
          customer: {
            name: buyerName,
            email: buyerEmail,
            cellphone: buyerPhone,
            taxId: buyerTaxIdRaw,
          },
          metadata: {
            reservationId: hold.id,
            raffleId: hold.raffleId,
            raffleSlug: hold.raffleSlug,
            ticketCount: hold.numbers.length,
            ...(hold.referralCode ? {referralCode: hold.referralCode} : {}),
          },
        });
      } catch (gwErr) {
        // Release the temporary number hold immediately if AbacatePay creation fails
        await withDbTransaction((db) => {
          const target = db.reservations.find((r) => r.id === hold.id);
          if (target && target.status === 'pending_payment') {
            target.status = 'cancelled';
            target.paymentStatus = 'CANCELLED';
          }
        });
        const message =
          gwErr instanceof Error
            ? gwErr.message
            : 'Falha ao gerar cobrança PIX na AbacatePay.';
        res.status(502).json({error: message});
        return;
      }

      // Step 3: Save AbacatePay charge details onto reservation
      const finalized = await withDbTransaction((db) => {
        const target = db.reservations.find((r) => r.id === hold.id);
        const raffle = db.raffles.find((r) => r.id === hold.raffleId);
        if (!target || !raffle) return null;

        target.paymentId = pixCharge.id;
        target.paymentBrCode = pixCharge.brCode;
        target.paymentBrCodeBase64 = pixCharge.brCodeBase64;
        target.paymentExpiresAt = pixCharge.expiresAt || target.paymentExpiresAt;
        target.paymentDevMode = Boolean(pixCharge.devMode);
        target.paymentReceiptUrl = pixCharge.receiptUrl || undefined;
        target.paymentStatus = pixCharge.status;

        if (pixCharge.status === 'PAID' || pixCharge.status === 'APPROVED') {
          target.status = 'confirmed';
          target.paidAt = new Date().toISOString();
          appendAuditLog(
            db,
            buyerEmail,
            'PAYMENT_CONFIRMED',
            target.id,
            `Pagamento AbacatePay ${pixCharge.id} confirmado (${target.numbers.length} cotas · R$ ${target.totalPaid.toFixed(2)}).`,
          );
        } else {
          appendAuditLog(
            db,
            buyerEmail,
            'PAYMENT_CREATED',
            target.id,
            `Cobrança PIX AbacatePay ${pixCharge.id} gerada para ${target.numbers.length} cotas (R$ ${target.totalPaid.toFixed(2)}).`,
          );
        }

        return {
          reservation: target,
          raffle: toPublicRaffleProjection(raffle, db.reservations),
        };
      });

      if (!finalized) {
        res.status(500).json({error: 'Erro ao vincular cobrança PIX à reserva.'});
        return;
      }

      res.status(201).json({
        reservation: finalized.reservation,
        raffle: finalized.raffle,
        buyerToken,
      });
    } catch (err) {
      console.error('Erro ao registrar reserva AbacatePay:', err);
      res.status(500).json({error: 'Erro interno ao processar reserva.'});
    }
  });

  app.get('/api/payments/:reservationId/status', async (req, res) => {
    const reservationId = sanitizeText(req.params.reservationId, 64);
    const buyerSession = readBuyerSession(req);
    const adminSession = readAdminSession(req);

    const snapshot = readDbSnapshot();
    const existing = snapshot.reservations.find((r) => r.id === reservationId);
    if (!existing) {
      res.status(404).json({error: 'Reserva não encontrada.'});
      return;
    }

    const isOwner = Boolean(buyerSession && existing.ownerId === buyerSession.sub);
    if (!isOwner && !adminSession) {
      res.status(403).json({error: 'Sem permissão para consultar este pagamento.'});
      return;
    }

    if (
      existing.status === 'pending_payment' &&
      existing.paymentId &&
      isAbacatePayConfigured()
    ) {
      try {
        const pixCheck = await checkAbacateTransparentPix(existing.paymentId);
        await withDbTransaction((db) => {
          const target = db.reservations.find((r) => r.id === reservationId);
          if (!target || target.status !== 'pending_payment') return;

          target.paymentStatus = pixCheck.status;
          if (pixCheck.receiptUrl) target.paymentReceiptUrl = pixCheck.receiptUrl;

          if (pixCheck.status === 'PAID' || pixCheck.status === 'APPROVED') {
            target.status = 'confirmed';
            target.paidAt = new Date().toISOString();
            appendAuditLog(
              db,
              target.buyerEmail || 'abacatepay',
              'PAYMENT_CONFIRMED',
              target.id,
              `Pagamento PIX AbacatePay ${target.paymentId} confirmado via consulta (${target.numbers.length} cotas · R$ ${target.totalPaid.toFixed(2)}).`,
            );
          } else if (pixCheck.status === 'EXPIRED') {
            target.status = 'expired';
            appendAuditLog(
              db,
              'abacatepay',
              'PAYMENT_EXPIRED',
              target.id,
              `Cobrança PIX ${target.paymentId} expirada. Cotas devolvidas ao painel.`,
            );
          } else if (pixCheck.status === 'CANCELLED') {
            target.status = 'cancelled';
          }
        });
      } catch {
        // Keep current snapshot state on transient AbacatePay check error
      }
    }

    const updatedDb = readDbSnapshot();
    const latest = updatedDb.reservations.find((r) => r.id === reservationId);
    const raffle = latest
      ? updatedDb.raffles.find((rf) => rf.id === latest.raffleId)
      : undefined;

    res.json({
      reservation: latest,
      confirmed: latest?.status === 'confirmed',
      paymentStatus: latest?.paymentStatus || 'PENDING',
      raffle: raffle ? toPublicRaffleProjection(raffle, updatedDb.reservations) : null,
    });
  });

  app.post('/api/payments/:reservationId/simulate', async (req, res) => {
    const reservationId = sanitizeText(req.params.reservationId, 64);
    const buyerSession = readBuyerSession(req);
    const adminSession = readAdminSession(req);

    const snapshot = readDbSnapshot();
    const existing = snapshot.reservations.find((r) => r.id === reservationId);
    if (!existing) {
      res.status(404).json({error: 'Reserva não encontrada.'});
      return;
    }

    const isOwner = Boolean(buyerSession && existing.ownerId === buyerSession.sub);
    if (!isOwner && !adminSession) {
      res.status(403).json({error: 'Sem permissão para simular este pagamento.'});
      return;
    }

    if (!existing.paymentId || !existing.paymentDevMode) {
      res.status(400).json({
        error: 'A simulação só está disponível para cobranças criadas no Modo Teste (Sandbox) da AbacatePay.',
      });
      return;
    }

    if (existing.status === 'confirmed') {
      const raffle = snapshot.raffles.find((rf) => rf.id === existing.raffleId);
      res.json({
        reservation: existing,
        confirmed: true,
        paymentStatus: 'PAID',
        raffle: raffle ? toPublicRaffleProjection(raffle, snapshot.reservations) : null,
      });
      return;
    }

    try {
      const sim = await simulateAbacateTransparentPix(existing.paymentId);
      const updated = await withDbTransaction((db) => {
        const target = db.reservations.find((r) => r.id === reservationId);
        const raffle = target ? db.raffles.find((rf) => rf.id === target.raffleId) : undefined;
        if (!target) return null;

        target.status = 'confirmed';
        target.paymentStatus = sim.status || 'PAID';
        target.paidAt = new Date().toISOString();
        if (sim.receiptUrl) target.paymentReceiptUrl = sim.receiptUrl;

        appendAuditLog(
          db,
          adminSession?.email || target.buyerEmail || 'sandbox',
          'PAYMENT_CONFIRMED',
          target.id,
          `Pagamento PIX AbacatePay ${target.paymentId} simulado em Modo Teste (${target.numbers.length} cotas · R$ ${target.totalPaid.toFixed(2)}).`,
        );

        return {
          reservation: target,
          raffle: raffle ? toPublicRaffleProjection(raffle, db.reservations) : null,
        };
      });

      res.json({
        reservation: updated?.reservation || existing,
        confirmed: true,
        paymentStatus: 'PAID',
        raffle: updated?.raffle || null,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Erro ao simular pagamento na AbacatePay.';
      res.status(502).json({error: msg});
    }
  });

  app.post('/api/webhooks/abacatepay', async (req, res) => {
    const querySecret =
      typeof req.query.webhookSecret === 'string' ? req.query.webhookSecret : '';
    const headerSecret =
      typeof req.headers['x-webhook-secret'] === 'string'
        ? req.headers['x-webhook-secret']
        : '';
    const providedSecret = querySecret || headerSecret;

    if (!isAbacateWebhookConfigured() || !verifyAbacateWebhookSecret(providedSecret)) {
      res.status(401).json({error: 'Webhook secret inválido.'});
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    const event = typeof body?.event === 'string' ? body.event : '';
    const data = (body?.data as Record<string, unknown> | undefined) || {};
    const transparent = (data.transparent as Record<string, unknown> | undefined) || {};
    const checkout = (data.checkout as Record<string, unknown> | undefined) || {};

    const paymentId =
      typeof transparent.id === 'string'
        ? transparent.id
        : typeof checkout.id === 'string'
          ? checkout.id
          : '';
    const externalId =
      typeof transparent.externalId === 'string'
        ? transparent.externalId
        : typeof checkout.externalId === 'string'
          ? checkout.externalId
          : '';
    const receiptUrl =
      typeof transparent.receiptUrl === 'string'
        ? transparent.receiptUrl
        : typeof checkout.receiptUrl === 'string'
          ? checkout.receiptUrl
          : undefined;

    if (!paymentId && !externalId) {
      res.status(200).json({received: true, ignored: true});
      return;
    }

    await withDbTransaction((db) => {
      const target = db.reservations.find(
        (r) =>
          (paymentId && r.paymentId === paymentId) ||
          (externalId && r.id === externalId),
      );
      if (!target) return;

      if (event === 'transparent.completed' || event === 'checkout.completed') {
        if (target.status !== 'confirmed') {
          target.status = 'confirmed';
          target.paymentStatus = 'PAID';
          target.paidAt = new Date().toISOString();
          if (receiptUrl) target.paymentReceiptUrl = receiptUrl;
          appendAuditLog(
            db,
            'abacatepay-webhook',
            'PAYMENT_CONFIRMED',
            target.id,
            `Webhook ${event} confirmou pagamento AbacatePay ${paymentId || target.id} (R$ ${target.totalPaid.toFixed(2)}).`,
          );
        }
      } else if (event === 'transparent.refunded' || event === 'checkout.refunded') {
        target.status = 'cancelled';
        target.paymentStatus = 'REFUNDED';
        appendAuditLog(
          db,
          'abacatepay-webhook',
          'PAYMENT_REFUNDED',
          target.id,
          `Webhook ${event} estornou pagamento ${paymentId || target.id}. Cotas devolvidas ao painel.`,
        );
      } else if (event === 'transparent.expired') {
        if (target.status === 'pending_payment') {
          target.status = 'expired';
          target.paymentStatus = 'EXPIRED';
          appendAuditLog(
            db,
            'abacatepay-webhook',
            'PAYMENT_EXPIRED',
            target.id,
            `Webhook ${event} expirou cobrança ${paymentId || target.id}. Cotas liberadas.`,
          );
        }
      }
    });

    res.status(200).json({received: true});
  });

  // =========================================================================
  // ADMIN AUTHENTICATION ROUTES
  // =========================================================================

  app.get('/api/admin/session', (req, res) => {
    const session = readAdminSession(req);
    if (!session) {
      res.json({
        authenticated: false,
        email: null,
        customSecretsConfigured: isCustomAdminConfigured(),
        maskedEmailHint: getMaskedAdminEmailHint(),
      });
      return;
    }
    res.json({authenticated: true, email: session.email || null});
  });

  app.post('/api/admin/login', async (req, res) => {
    const clientIp = req.ip || 'unknown';
    const rateCheck = checkLoginRateLimit(clientIp);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: `Muitas tentativas de login. Aguarde ${rateCheck.retryAfterSec}s antes de tentar novamente.`,
      });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    const email = sanitizeText(body?.email, 120);
    const password = typeof body?.password === 'string' ? body.password.slice(0, 128) : '';

    if (!email || !password) {
      res.status(400).json({error: 'Informe e-mail e senha administrativa.'});
      return;
    }

    const valid = verifyAdminCredentials(email, password);
    if (!valid) {
      recordFailedLoginAttempt(clientIp);
      await withDbTransaction((db) => {
        appendAuditLog(
          db,
          email,
          'ADMIN_LOGIN_FAILED',
          'auth',
          `Tentativa de login administrativo recusada (IP: ${clientIp}).`,
        );
      });
      res.status(401).json({error: 'Credenciais administrativas inválidas.'});
      return;
    }

    clearLoginAttempts(clientIp);
    const adminToken = setAdminSessionCookie(req, res, email.toLowerCase());
    await withDbTransaction((db) => {
      appendAuditLog(
        db,
        email.toLowerCase(),
        'ADMIN_LOGIN',
        'auth',
        'Sessão administrativa autenticada via token HMAC assinado.',
      );
    });

    res.json({authenticated: true, email: email.toLowerCase(), token: adminToken});
  });

  app.post('/api/admin/logout', (req, res) => {
    clearAdminSessionCookie(req, res);
    res.json({authenticated: false});
  });

  // =========================================================================
  // PROTECTED ADMIN MANAGEMENT ROUTES (Strict RBAC via requireAdminMiddleware)
  // =========================================================================

  app.get('/api/admin/overview', requireAdminMiddleware, (_req, res) => {
    const db = readDbSnapshot();
    const raffles = db.raffles.map((raffle) => {
      const publicProj = toPublicRaffleProjection(raffle, db.reservations);
      const raffleReservations = db.reservations.filter(
        (r) => r.raffleId === raffle.id && r.status === 'confirmed',
      );
      const recordedRevenue = raffleReservations.reduce((sum, r) => sum + r.totalPaid, 0);
      return {
        ...raffle,
        soldCount: publicProj.soldCount,
        reservationsCount: raffleReservations.length,
        recordedRevenue: Number(recordedRevenue.toFixed(2)),
      };
    });

    res.json({
      raffles,
      referralCodes: buildAdminReferralSummaries(db),
      referralAlerts: db.referralAlerts,
      referralPayouts: db.referralPayouts || [],
      auditLogs: db.auditLogs.slice(0, 60),
      gateway: {
        provider: 'abacatepay',
        configured: isAbacatePayConfigured(),
        webhookConfigured: isAbacateWebhookConfigured(),
      },
    });
  });

  app.get('/api/admin/raffles/:id/ledger', requireAdminMiddleware, (req, res) => {
    const raffleId = sanitizeText(req.params.id, 64);
    const db = readDbSnapshot();
    const raffle = db.raffles.find((r) => r.id === raffleId);
    if (!raffle) {
      res.status(404).json({error: 'Sorteio não encontrado.'});
      return;
    }

    const nowMs = Date.now();
    const activeReservations = db.reservations.filter(
      (r) => r.raffleId === raffle.id && isReservationHoldingNumbers(r, nowMs),
    );

    // Map every occupied ticket number -> exact buyer record (pago ou aguardando PIX)
    const numberOwnerMap: Record<
      number,
      {
        source: 'reservation';
        reservationId?: string;
        buyerName: string;
        buyerContact: string;
        status?: 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';
        paymentId?: string;
        createdAt?: string;
        orderBumpApplied?: boolean;
        referralCode?: string;
        referralCommissionPct?: number;
        referralCommissionAmount?: number;
      }
    > = {};

    for (const resItem of activeReservations) {
      for (const num of resItem.numbers) {
        numberOwnerMap[num] = {
          source: 'reservation',
          reservationId: resItem.id,
          buyerName: resItem.buyerName,
          buyerContact: resItem.buyerContact,
          status: resItem.status,
          paymentId: resItem.paymentId,
          createdAt: resItem.createdAt,
          orderBumpApplied: resItem.orderBumpApplied,
          referralCode: resItem.referralCode,
          referralCommissionPct: resItem.referralCommissionPct,
          referralCommissionAmount: resItem.referralCommissionAmount,
        };
      }
    }

    const soldCount = Object.keys(numberOwnerMap).length;

    res.json({
      raffle,
      soldCount,
      reservations: activeReservations,
      numberOwnerMap,
    });
  });

  app.post('/api/admin/raffles', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({error: 'Payload inválido.'});
      return;
    }

    const parsed = parseRaffleInput(body);
    if (!parsed.ok) {
      res.status(400).json({error: parsed.error});
      return;
    }
    const newRaffle = buildNewRaffle(parsed.input);

    const created = await withDbTransaction((db) => {
      db.raffles.unshift(newRaffle);
      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'CREATE_RAFFLE',
        newRaffle.id,
        `Criado sorteio "${newRaffle.title}" (${newRaffle.totalTickets} cotas × R$ ${newRaffle.ticketPrice.toFixed(2)} · taxa AbacatePay simulada R$ ${newRaffle.estimatedGatewayFees.toFixed(2)}).`,
      );
      return newRaffle;
    });

    res.status(201).json({raffle: created});
  });

  app.patch('/api/admin/raffles/:id', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const raffleId = sanitizeText(req.params.id, 64);
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({error: 'Payload inválido.'});
      return;
    }

    const result = await withDbTransaction((db) => {
      const raffle = db.raffles.find((r) => r.id === raffleId);
      if (!raffle) {
        return {status: 404 as const, payload: {error: 'Sorteio não encontrado.'}};
      }

      if (typeof body.title === 'string' && sanitizeText(body.title, 120).length >= 4) {
        raffle.title = sanitizeText(body.title, 120);
      }
      if (typeof body.shortTitle === 'string' && sanitizeText(body.shortTitle, 60).length >= 3) {
        raffle.shortTitle = sanitizeText(body.shortTitle, 60);
      }
      if (typeof body.subtitle === 'string' && sanitizeText(body.subtitle, 240).length >= 4) {
        raffle.subtitle = sanitizeText(body.subtitle, 240);
      }
      if (typeof body.region === 'string' && sanitizeText(body.region, 60).length >= 2) {
        raffle.region = sanitizeText(body.region, 60);
      }
      if (typeof body.drawDate === 'string' && sanitizeText(body.drawDate, 60).length >= 2) {
        raffle.drawDate = sanitizeText(body.drawDate, 60);
      }
      if (typeof body.drawTimestamp === 'string' && !Number.isNaN(Date.parse(body.drawTimestamp))) {
        raffle.drawTimestamp = new Date(body.drawTimestamp).toISOString();
      }
      if (typeof body.description === 'string' && sanitizeText(body.description, 600).length >= 4) {
        raffle.description = sanitizeText(body.description, 600);
      }
      if (body.categoryLabel !== undefined || body.category !== undefined) {
        const resolved = resolveCategory({
          category: body.category,
          categoryLabel:
            typeof body.categoryLabel === 'string' ? sanitizeText(body.categoryLabel, 60) : undefined,
        });
        if (resolved) {
          raffle.category = resolved.id;
          raffle.categoryLabel = resolved.label;
        }
      }
      if (body.poolTier === 'popular' || body.poolTier === 'exclusive') {
        raffle.poolTier = body.poolTier;
        raffle.poolLabel =
          body.poolTier === 'exclusive'
            ? 'Menos Pessoas · Alta Chance'
            : 'Mais Gente · Valor Menor';
      }
      if (typeof body.image === 'string' && sanitizeText(body.image, 260).length >= 5) {
        raffle.image = sanitizeText(body.image, 260);
      }
      if (body.status === 'active' || body.status === 'finalized') {
        raffle.status = body.status;
      }

      if (Array.isArray(body.products)) {
        const parsedProducts = body.products
          .slice(0, 10)
          .map((p) => {
            const item = p as Record<string, unknown>;
            return {
              name: sanitizeText(item?.name, 120),
              retailPrice: Number(item?.retailPrice),
            };
          })
          .filter((p) => p.name.length >= 2 && Number.isFinite(p.retailPrice) && p.retailPrice > 0);
        if (parsedProducts.length > 0) {
          raffle.products = parsedProducts;
        }
      }

      if (typeof body.totalTickets === 'number' && Number.isInteger(body.totalTickets)) {
        const soldSet = getAllSoldNumbersForRaffle(raffle, db.reservations);
        const maxSoldNumber = soldSet.size > 0 ? Math.max(...soldSet) : 0;
        if (body.totalTickets < maxSoldNumber) {
          return {
            status: 409 as const,
            payload: {
              error: `Não é possível reduzir cotas abaixo do maior número já vendido (${maxSoldNumber}).`,
            },
          };
        }
        if (body.totalTickets >= 10 && body.totalTickets <= 20000) {
          raffle.totalTickets = body.totalTickets;
        }
      }

      // Mantém o lucro do sorteio, a menos que o painel envie um novo percentual.
      const profitRate =
        parseProfitPct(body.profitPct) ??
        (typeof raffle.targetProfitRate === 'number' ? raffle.targetProfitRate : undefined);
      const repriced = buildRafflePricing(raffle.products, raffle.totalTickets, profitRate);
      raffle.productsTotalValue = repriced.productsTotalValue;
      raffle.targetProfitRate = repriced.targetProfitRate;
      raffle.pixFeePerTransaction = repriced.pixFeePerTransaction;
      raffle.estimatedGatewayFees = repriced.estimatedGatewayFees;
      raffle.netRevenueAfterPixFees = repriced.netRevenueAfterPixFees;
      raffle.totalRevenue = repriced.totalRevenue;
      raffle.ticketPrice = repriced.ticketPrice;
      raffle.updatedAt = new Date().toISOString();

      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'UPDATE_RAFFLE',
        raffle.id,
        `Sorteio "${raffle.title}" atualizado (${raffle.totalTickets} cotas × R$ ${raffle.ticketPrice.toFixed(2)}).`,
      );

      return {status: 200 as const, payload: {raffle}};
    });

    res.status(result.status).json(result.payload);
  });

  app.post('/api/admin/raffles/:id/finalize', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const raffleId = sanitizeText(req.params.id, 64);
    const body = req.body as Record<string, unknown> | undefined;
    const reopen = body?.reopen === true;

    const result = await withDbTransaction((db) => {
      const raffle = db.raffles.find((r) => r.id === raffleId);
      if (!raffle) {
        return {status: 404 as const, payload: {error: 'Sorteio não encontrado.'}};
      }

      raffle.status = reopen ? 'active' : 'finalized';
      if (reopen) {
        raffle.winner = null;
        db.referralAlerts = db.referralAlerts.filter((a) => a.raffleId !== raffle.id);
      }
      raffle.updatedAt = new Date().toISOString();

      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'FINALIZE_RAFFLE',
        raffle.id,
        reopen
          ? `Sorteio "${raffle.title}" reaberto para vendas.`
          : `Sorteio "${raffle.title}" finalizado (vendas encerradas).`,
      );

      return {status: 200 as const, payload: {raffle}};
    });

    res.status(result.status).json(result.payload);
  });

  app.post('/api/admin/raffles/:id/winner', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const raffleId = sanitizeText(req.params.id, 64);
    const body = req.body as Record<string, unknown> | undefined;
    const selectionMode = body?.mode === 'manual' ? 'manual' : 'random_sold';
    const manualNumber =
      typeof body?.winningNumber === 'number' ? Math.trunc(body.winningNumber) : null;

    const result = await withDbTransaction((db) => {
      const raffle = db.raffles.find((r) => r.id === raffleId);
      if (!raffle) {
        return {status: 404 as const, payload: {error: 'Sorteio não encontrado.'}};
      }

      // Only confirmed (paid via AbacatePay PIX) tickets are eligible to win
      const soldSet = new Set<number>();
      for (const resItem of db.reservations) {
        if (resItem.raffleId === raffle.id && resItem.status === 'confirmed') {
          for (const n of resItem.numbers) {
            if (n >= 1 && n <= raffle.totalTickets) {
              soldSet.add(n);
            }
          }
        }
      }
      const soldArray = Array.from(soldSet).sort((a, b) => a - b);

      if (soldArray.length === 0) {
        return {
          status: 409 as const,
          payload: {error: 'Não há nenhuma cota confirmada/paga neste sorteio para definir ganhador.'},
        };
      }

      let chosenNumber: number;
      if (selectionMode === 'manual') {
        if (!manualNumber || manualNumber < 1 || manualNumber > raffle.totalTickets) {
          return {
            status: 400 as const,
            payload: {error: `Informe um número entre 1 e ${raffle.totalTickets}.`},
          };
        }
        if (!soldSet.has(manualNumber)) {
          return {
            status: 409 as const,
            payload: {
              error: `O número ${manualNumber} não foi pago/confirmado. Escolha um número já confirmado.`,
            },
          };
        }
        chosenNumber = manualNumber;
      } else {
        const randIdx = crypto.randomInt(0, soldArray.length);
        chosenNumber = soldArray[randIdx];
      }

      const matchingReservation = db.reservations.find(
        (r) =>
          r.raffleId === raffle.id &&
          r.status === 'confirmed' &&
          r.numbers.includes(chosenNumber),
      );

      if (!matchingReservation) {
        return {
          status: 409 as const,
          payload: {error: 'Reserva confirmada do número sorteado não encontrada.'},
        };
      }

      const buyerName = matchingReservation.buyerName;
      const buyerContact = matchingReservation.buyerContact;

      let referralWinnerAlert: ReferralWinnerAlert | null = null;
      const refCodeUsed = matchingReservation?.referralCode?.toUpperCase();
      let referralPromoterName: string | undefined;
      let referralWinnerBonusPct: number | undefined;
      let referralWinnerBonusAmount: number | undefined;

      // Remove stale alert if winner is being re-declared for this raffle
      db.referralAlerts = db.referralAlerts.filter((a) => a.raffleId !== raffle.id);

      if (refCodeUsed) {
        const refRecord = db.referralCodes.find(
          (c) => c.code.toUpperCase() === refCodeUsed,
        );
        referralPromoterName =
          refRecord?.promoterName || matchingReservation?.referralPromoterName || refCodeUsed;
        referralWinnerBonusPct = 5;
        referralWinnerBonusAmount = Number((raffle.productsTotalValue * 0.05).toFixed(2));

        referralWinnerAlert = {
          id: `ref-alert-${crypto.randomBytes(4).toString('hex')}`,
          raffleId: raffle.id,
          raffleTitle: raffle.title,
          winningNumber: chosenNumber,
          totalTickets: raffle.totalTickets,
          buyerName,
          reservationId: matchingReservation?.id || 'LOTE',
          referralCode: refCodeUsed,
          promoterName: referralPromoterName,
          promoterContact: refRecord?.promoterContact || 'Contato não cadastrado',
          prizeValue: raffle.productsTotalValue,
          bonusPct: 5,
          bonusAmount: referralWinnerBonusAmount,
          acknowledged: false,
          createdAt: new Date().toISOString(),
        };
        db.referralAlerts.unshift(referralWinnerAlert);

        appendAuditLog(
          db,
          adminSession?.email || 'admin',
          'REFERRAL_WINNER_BONUS',
          raffle.id,
          `INDICAÇÃO PREMIADA (${refCodeUsed} · ${referralPromoterName}): ganhador ${buyerName} (#${chosenNumber}). Bônus extra de 5% do prêmio = R$ ${referralWinnerBonusAmount.toFixed(2)}.`,
        );
      }

      raffle.status = 'finalized';
      raffle.winner = {
        winningNumber: chosenNumber,
        buyerName,
        buyerContactMasked: maskContact(buyerContact),
        reservationId: matchingReservation?.id || 'LOTE-INICIAL',
        declaredAt: new Date().toISOString(),
        declaredBy: adminSession?.email || 'admin',
        selectionMode,
        ...(matchingReservation.buyerSocialPlatform && matchingReservation.buyerSocialHandle
          ? {
              socialPlatform: matchingReservation.buyerSocialPlatform,
              socialHandle: matchingReservation.buyerSocialHandle,
              socialUrl: socialProfileUrl(
                matchingReservation.buyerSocialPlatform,
                matchingReservation.buyerSocialHandle,
              ),
              avatarUrl:
                socialAvatarUrl(
                  matchingReservation.buyerSocialPlatform,
                  matchingReservation.buyerSocialHandle,
                ) ?? undefined,
            }
          : {}),
        ...(refCodeUsed
          ? {
              referralCode: refCodeUsed,
              referralPromoterName,
              referralWinnerBonusPct,
              referralWinnerBonusAmount,
            }
          : {}),
      };
      raffle.updatedAt = new Date().toISOString();

      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'SET_WINNER',
        raffle.id,
        `Ganhador definido em "${raffle.title}": número ${chosenNumber} (${buyerName}).`,
      );

      return {status: 200 as const, payload: {raffle, referralWinnerAlert}};
    });

    res.status(result.status).json(result.payload);
  });

  // Catálogo para o formulário do painel: categorias e produtos já usados em sorteios.
  app.get('/api/admin/catalog', requireAdminMiddleware, (_req, res) => {
    const db = readDbSnapshot();
    const byRecent = [...db.raffles].sort(
      (a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt),
    );
    const products = new Map<string, ProductBreakdownItem>();
    for (const raffle of byRecent) {
      for (const p of raffle.products) {
        const key = p.name.trim().toLowerCase();
        if (key && !products.has(key)) products.set(key, {name: p.name.trim(), retailPrice: p.retailPrice});
      }
    }
    res.json({
      categories: mergeCategories(db.raffles),
      products: [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    });
  });

  // Foto do ganhador definida manualmente (ex.: Instagram, que não tem foto automática).
  app.patch('/api/admin/raffles/:id/winner-avatar', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const raffleId = sanitizeText(req.params.id, 64);
    const body = req.body as Record<string, unknown> | undefined;
    const rawUrl = sanitizeText(body?.avatarUrl, 1000);
    const parsedUrl = rawUrl ? isSafePublicHttpUrl(rawUrl) : null;
    if (rawUrl && (!parsedUrl || parsedUrl.protocol !== 'https:')) {
      res.status(400).json({error: 'Informe um link https válido para a imagem.'});
      return;
    }

    const result = await withDbTransaction((db) => {
      const raffle = db.raffles.find((r) => r.id === raffleId);
      if (!raffle?.winner) {
        return {status: 404 as const, payload: {error: 'Sorteio sem ganhador definido.'}};
      }
      if (parsedUrl) {
        raffle.winner.avatarUrl = parsedUrl.toString();
      } else {
        delete raffle.winner.avatarUrl;
      }
      raffle.updatedAt = new Date().toISOString();
      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'UPDATE_RAFFLE',
        raffle.id,
        parsedUrl ? 'Foto do ganhador atualizada.' : 'Foto do ganhador removida.',
      );
      return {status: 200 as const, payload: {raffle}};
    });

    res.status(result.status).json(result.payload);
  });

  app.delete('/api/admin/reservations/:id', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const reservationId = sanitizeText(req.params.id, 64);

    const result = await withDbTransaction((db) => {
      const target = db.reservations.find((r) => r.id === reservationId);
      if (!target) {
        return {status: 404 as const, payload: {error: 'Reserva não encontrada.'}};
      }
      target.status = 'cancelled';
      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'CANCEL_RESERVATION',
        target.id,
        `Reserva ${target.id} (${target.buyerName}, ${target.numbers.length} cotas) cancelada e devolvida ao painel.`,
      );
      return {status: 200 as const, payload: {cancelledId: target.id}};
    });

    res.status(result.status).json(result.payload);
  });

  // =========================================================================
  // ADMIN REFERRAL MANAGEMENT ROUTES (5% - 10% Sales Bonus + 5% Winner Bonus)
  // =========================================================================

  app.post('/api/admin/referrals', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({error: 'Payload inválido.'});
      return;
    }

    const code = sanitizeText(body.code, 24).toUpperCase().replace(/\s+/g, '');
    const promoterName = sanitizeText(body.promoterName, 80);
    const promoterContact = sanitizeText(body.promoterContact, 120);
    const commissionPct = Number(body.commissionPct);
    const active = body.active !== false;

    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) {
      res.status(400).json({
        error: 'O código deve ter entre 3 e 24 caracteres (letras maiúsculas, números, _ ou -).',
      });
      return;
    }
    if (promoterName.length < 2) {
      res.status(400).json({error: 'Informe o nome do indicador / parceiro.'});
      return;
    }
    if (!Number.isFinite(commissionPct) || commissionPct < 5 || commissionPct > 10) {
      res.status(400).json({error: 'O bônus por venda deve estar entre 5% e 10%.'});
      return;
    }

    const roundedPct = Number(commissionPct.toFixed(2));
    const liveLinks = normalizeLiveLinks(body.liveLinks);
    const isLive = typeof body.isLive === 'boolean' ? body.isLive : liveLinks.length > 0;
    const manualAvatarRaw = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : '';
    const manualAvatar =
      manualAvatarRaw && isSafePublicHttpUrl(manualAvatarRaw) ? manualAvatarRaw : undefined;
    const resolvedAvatar =
      manualAvatar || (liveLinks.length > 0 ? await resolvePartnerAvatarFromLinks(liveLinks) : null);

    const now = new Date().toISOString();

    const result = await withDbTransaction((db) => {
      const exists = db.referralCodes.some((c) => c.code.toUpperCase() === code);
      if (exists) {
        return {
          status: 409 as const,
          payload: {error: `Já existe um código de indicação chamado "${code}".`},
        };
      }

      const created: StoredReferralCode = {
        id: `ref-${crypto.randomBytes(3).toString('hex')}`,
        code,
        promoterName,
        promoterContact: promoterContact || 'Não informado',
        commissionPct: roundedPct,
        active,
        liveLinks,
        ...(resolvedAvatar ? {avatarUrl: resolvedAvatar} : {}),
        isLive,
        createdAt: now,
        updatedAt: now,
      };
      db.referralCodes.unshift(created);
      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'CREATE_REFERRAL_CODE',
        created.id,
        `Criado código de indicação ${code} (${promoterName} · ${roundedPct}% por venda · ${liveLinks.length} link(s) de live).`,
      );
      return {status: 201 as const, payload: {referralCode: created}};
    });

    res.status(result.status).json(result.payload);
  });

  app.patch('/api/admin/referrals/:id', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const refId = sanitizeText(req.params.id, 64);
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({error: 'Payload inválido.'});
      return;
    }

    const hasLiveLinksUpdate = Array.isArray(body.liveLinks);
    const nextLiveLinks = hasLiveLinksUpdate ? normalizeLiveLinks(body.liveLinks) : null;
    const manualAvatarRaw = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : undefined;
    const manualAvatar =
      manualAvatarRaw && isSafePublicHttpUrl(manualAvatarRaw) ? manualAvatarRaw : undefined;
    const refreshAvatar = body.refreshAvatar === true;

    let fetchedAvatar: string | null | undefined;
    if (!manualAvatar && (hasLiveLinksUpdate || refreshAvatar)) {
      const snapshot = readDbSnapshot();
      const existing = snapshot.referralCodes.find((c) => c.id === refId);
      const linksToResolve = nextLiveLinks ?? existing?.liveLinks ?? [];
      if (linksToResolve.length > 0) {
        fetchedAvatar = await resolvePartnerAvatarFromLinks(linksToResolve);
      } else if (hasLiveLinksUpdate) {
        fetchedAvatar = null;
      }
    }

    const result = await withDbTransaction((db) => {
      const ref = db.referralCodes.find((c) => c.id === refId);
      if (!ref) {
        return {status: 404 as const, payload: {error: 'Código de indicação não encontrado.'}};
      }

      if (typeof body.promoterName === 'string' && sanitizeText(body.promoterName, 80).length >= 2) {
        ref.promoterName = sanitizeText(body.promoterName, 80);
      }
      if (typeof body.promoterContact === 'string') {
        ref.promoterContact = sanitizeText(body.promoterContact, 120) || 'Não informado';
      }
      if (typeof body.commissionPct === 'number') {
        if (!Number.isFinite(body.commissionPct) || body.commissionPct < 5 || body.commissionPct > 10) {
          return {
            status: 400 as const,
            payload: {error: 'O bônus por venda deve estar entre 5% e 10%.'},
          };
        }
        ref.commissionPct = Number(body.commissionPct.toFixed(2));
      }
      if (typeof body.active === 'boolean') {
        ref.active = body.active;
      }
      if (nextLiveLinks !== null) {
        ref.liveLinks = nextLiveLinks;
        if (typeof body.isLive !== 'boolean') {
          ref.isLive = nextLiveLinks.length > 0 ? ref.isLive : false;
        }
      }
      if (typeof body.isLive === 'boolean') {
        ref.isLive = body.isLive;
      }
      if (manualAvatar) {
        ref.avatarUrl = manualAvatar;
      } else if (fetchedAvatar !== undefined) {
        if (fetchedAvatar) {
          ref.avatarUrl = fetchedAvatar;
        } else if (nextLiveLinks !== null && nextLiveLinks.length === 0) {
          delete ref.avatarUrl;
        }
      }
      ref.updatedAt = new Date().toISOString();

      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'UPDATE_REFERRAL_CODE',
        ref.id,
        `Código ${ref.code} atualizado (${ref.promoterName} · ${ref.commissionPct}% · ${ref.liveLinks.length} live(s) · ${ref.active ? 'Ativo' : 'Pausado'}).`,
      );
      return {status: 200 as const, payload: {referralCode: ref}};
    });

    res.status(result.status).json(result.payload);
  });

  app.delete('/api/admin/referrals/:id', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const refId = sanitizeText(req.params.id, 64);

    const result = await withDbTransaction((db) => {
      const idx = db.referralCodes.findIndex((c) => c.id === refId);
      if (idx === -1) {
        return {status: 404 as const, payload: {error: 'Código de indicação não encontrado.'}};
      }
      const [removed] = db.referralCodes.splice(idx, 1);
      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'DELETE_REFERRAL_CODE',
        removed.id,
        `Código ${removed.code} (${removed.promoterName}) removido do catálogo ativo.`,
      );
      return {status: 200 as const, payload: {deletedId: removed.id}};
    });

    res.status(result.status).json(result.payload);
  });

  app.post('/api/admin/referral-alerts/:id/ack', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const alertId = sanitizeText(req.params.id, 64);

    const result = await withDbTransaction((db) => {
      const alert = db.referralAlerts.find((a) => a.id === alertId);
      if (!alert) {
        return {status: 404 as const, payload: {error: 'Alerta de indicação não encontrado.'}};
      }
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'ACK_REFERRAL_ALERT',
        alert.id,
        `Bônus de 5% do prêmio (R$ ${alert.bonusAmount.toFixed(2)}) para ${alert.referralCode} (${alert.promoterName}) marcado como pago/ciente.`,
      );
      return {status: 200 as const, payload: {alert}};
    });

    res.status(result.status).json(result.payload);
  });

  app.post('/api/admin/referrals/:id/payout', requireAdminMiddleware, async (req, res) => {
    const adminSession = (req as express.Request & {adminSession?: {email?: string}}).adminSession;
    const refId = sanitizeText(req.params.id, 64);
    const body = (req.body as Record<string, unknown> | undefined) || {};
    const note = typeof body.note === 'string' ? sanitizeText(body.note, 200) : '';

    const result = await withDbTransaction((db) => {
      const ref = db.referralCodes.find((c) => c.id === refId);
      if (!ref) {
        return {status: 404 as const, payload: {error: 'Código de indicação não encontrado.'}};
      }

      const codeUpper = ref.code.toUpperCase();
      const unpaidSales = db.reservations.filter(
        (resItem) =>
          resItem.status === 'confirmed' &&
          resItem.referralCode?.toUpperCase() === codeUpper &&
          !resItem.referralCommissionPaidAt,
      );
      const unpaidAlerts = db.referralAlerts.filter(
        (alert) => alert.referralCode.toUpperCase() === codeUpper && !alert.bonusPaidAt,
      );

      const salesCommissionPaid = Number(
        unpaidSales
          .reduce((sum, resItem) => {
            if (typeof resItem.referralCommissionAmount === 'number') {
              return sum + resItem.referralCommissionAmount;
            }
            const pct = resItem.referralCommissionPct ?? ref.commissionPct;
            return sum + resItem.totalPaid * (pct / 100);
          }, 0)
          .toFixed(2),
      );
      const winnerBonusPaid = Number(
        unpaidAlerts.reduce((sum, alert) => sum + alert.bonusAmount, 0).toFixed(2),
      );
      const totalPaid = Number((salesCommissionPaid + winnerBonusPaid).toFixed(2));

      if (totalPaid <= 0) {
        return {
          status: 400 as const,
          payload: {error: 'Não há valor pendente para dar baixa neste código de indicação.'},
        };
      }

      const now = new Date().toISOString();
      const payoutId = `pay-${crypto.randomBytes(3).toString('hex')}`;

      for (const sale of unpaidSales) {
        sale.referralCommissionPaidAt = now;
        sale.referralPayoutId = payoutId;
      }
      for (const alert of unpaidAlerts) {
        alert.bonusPaidAt = now;
        alert.referralPayoutId = payoutId;
        if (!alert.acknowledged) {
          alert.acknowledged = true;
          alert.acknowledgedAt = now;
        }
      }

      const payoutRecord: ReferralPayoutRecord = {
        id: payoutId,
        referralId: ref.id,
        referralCode: ref.code,
        promoterName: ref.promoterName,
        promoterContact: ref.promoterContact,
        salesCommissionPaid,
        winnerBonusPaid,
        totalPaid,
        settledSalesCount: unpaidSales.length,
        settledAlertsCount: unpaidAlerts.length,
        reservationIds: unpaidSales.map((s) => s.id),
        alertIds: unpaidAlerts.map((a) => a.id),
        ...(note ? {note} : {}),
        paidBy: adminSession?.email || 'admin',
        paidAt: now,
      };

      if (!Array.isArray(db.referralPayouts)) {
        db.referralPayouts = [];
      }
      db.referralPayouts.unshift(payoutRecord);

      appendAuditLog(
        db,
        adminSession?.email || 'admin',
        'PAYOUT_REFERRAL',
        payoutId,
        `Baixa registrada para ${ref.code} (${ref.promoterName}): total pago R$ ${totalPaid.toFixed(2)} (${unpaidSales.length} venda(s) + ${unpaidAlerts.length} bônus prêmio)${note ? ` · Obs: ${note}` : ''}.`,
      );

      return {status: 201 as const, payload: {payout: payoutRecord}};
    });

    res.status(result.status).json(result.payload);
  });

  // =========================================================================
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC SERVING
  // =========================================================================

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      // SPA fallback (Express 4): qualquer rota fora de /api devolve o index.html.
      app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('[api] Erro não tratado:', err);
      if (res.headersSent) {
        next(err);
        return;
      }
      res.status(500).json({error: 'Erro interno ao processar a solicitação. Tente novamente.'});
    },
  );

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Sorteios Brasil server listening on http://0.0.0.0:${PORT} (db: ${getStorageBackend()})`,
    );
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
