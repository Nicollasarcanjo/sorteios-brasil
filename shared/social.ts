/**
 * Rede social do comprador (usada no checkout e na exibição do ganhador).
 * Compartilhado entre servidor (server.ts) e front (RaffleDetailPage), sem dependências.
 */

export type SocialPlatform = 'instagram' | 'tiktok' | 'x' | 'facebook';

export const SOCIAL_PLATFORMS: ReadonlyArray<{id: SocialPlatform; label: string}> = [
  {id: 'instagram', label: 'Instagram'},
  {id: 'tiktok', label: 'TikTok'},
  {id: 'x', label: 'X (Twitter)'},
  {id: 'facebook', label: 'Facebook'},
];

const HANDLE_RULES: Record<SocialPlatform, RegExp> = {
  instagram: /^[a-z0-9._]{1,30}$/i,
  tiktok: /^[a-z0-9._]{2,24}$/i,
  x: /^[a-z0-9_]{1,15}$/i,
  facebook: /^[a-z0-9.]{5,50}$/i,
};

const PROFILE_HOSTS: Record<SocialPlatform, string[]> = {
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  x: ['x.com', 'twitter.com'],
  facebook: ['facebook.com', 'fb.com'],
};

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && value in HANDLE_RULES;
}

/**
 * Aceita "@usuario", "usuario" ou o link do perfil (instagram.com/usuario, tiktok.com/@usuario...).
 * Retorna o @ normalizado (sem "@") ou null se inválido.
 */
export function normalizeSocialHandle(platform: SocialPlatform, raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;

  if (/^(https?:\/\/)?(www\.|m\.)?[a-z0-9.-]+\.[a-z]{2,}\//i.test(value)) {
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
      if (!PROFILE_HOSTS[platform].some((h) => host === h || host.endsWith(`.${h}`))) return null;
      value = url.pathname.split('/').filter(Boolean)[0] ?? '';
    } catch {
      return null;
    }
  }

  value = value.replace(/^@+/, '').replace(/\/+$/, '');
  return HANDLE_RULES[platform].test(value) ? value : null;
}

export function socialProfileUrl(platform: SocialPlatform, handle: string): string {
  const h = encodeURIComponent(handle);
  switch (platform) {
    case 'instagram':
      return `https://www.instagram.com/${h}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${h}`;
    case 'x':
      return `https://x.com/${h}`;
    case 'facebook':
      return `https://www.facebook.com/${h}`;
  }
}

/**
 * Foto de perfil automática via unavatar.io (grátis só para TikTok e X; Instagram e
 * Facebook exigem plano pago lá). Sem foto automática → null: o admin pode colar o
 * link de uma foto no painel, e o front mostra as iniciais enquanto isso.
 */
export function socialAvatarUrl(platform: SocialPlatform, handle: string): string | null {
  if (platform !== 'tiktok' && platform !== 'x') return null;
  return `https://unavatar.io/${platform}/${encodeURIComponent(handle)}?fallback=false`;
}

export function socialPlatformLabel(platform: SocialPlatform): string {
  return SOCIAL_PLATFORMS.find((p) => p.id === platform)?.label ?? platform;
}
