export interface ResolvedLivePlatform {
  platform: 'Twitch' | 'YouTube' | 'Kick' | 'TikTok' | 'Instagram' | 'Facebook' | 'Live';
  url: string;
}

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/i,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd/i,
  /\.local$/i,
  /\.internal$/i,
];

export function isSafePublicHttpUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (!host || BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function detectPlatformFromUrl(url: string): ResolvedLivePlatform['platform'] {
  const parsed = isSafePublicHttpUrl(url);
  if (!parsed) return 'Live';
  const host = parsed.hostname.toLowerCase();
  if (host.includes('twitch.tv')) return 'Twitch';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube';
  if (host.includes('kick.com')) return 'Kick';
  if (host.includes('tiktok.com')) return 'TikTok';
  if (host.includes('instagram.com')) return 'Instagram';
  if (host.includes('facebook.com') || host.includes('fb.gg')) return 'Facebook';
  return 'Live';
}

export function normalizeLiveLinks(rawLinks: unknown): string[] {
  if (!Array.isArray(rawLinks)) return [];
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const entry of rawLinks) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim().slice(0, 320);
    if (!trimmed) continue;
    const parsed = isSafePublicHttpUrl(trimmed);
    if (!parsed) continue;
    const normalized = parsed.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      valid.push(normalized);
    }
    if (valid.length >= 6) break;
  }
  return valid;
}

function extractMetaImage(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match && match[1]) {
      const candidate = match[1].replace(/&amp;/g, '&').trim();
      if (isSafePublicHttpUrl(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

async function resolveSingleLinkAvatar(urlStr: string): Promise<string | null> {
  const parsed = isSafePublicHttpUrl(urlStr);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split('/').filter(Boolean);

  // 1. Twitch channel avatar via DecAPI (direct profile picture CDN URL)
  if (host.includes('twitch.tv') && pathParts.length >= 1) {
    const channel = pathParts[0].toLowerCase();
    if (channel && /^[a-z0-9_]{2,32}$/.test(channel)) {
      try {
        const res = await fetch(`https://decapi.me/twitch/avatar/${encodeURIComponent(channel)}`, {
          signal: AbortSignal.timeout(3500),
          headers: {'User-Agent': 'SorteiosBrasil/1.0'},
        });
        if (res.ok) {
          const text = (await res.text()).trim();
          if (
            isSafePublicHttpUrl(text) &&
            !text.toLowerCase().includes('error') &&
            !text.toLowerCase().includes('twitch_logo')
          ) {
            return text;
          }
        }
      } catch {
        // Fallback to HTML meta extraction below
      }
    }
  }

  // 2. Kick public channel API
  if (host.includes('kick.com') && pathParts.length >= 1) {
    const channel = pathParts[0].toLowerCase();
    if (channel && /^[a-z0-9_-]{2,40}$/.test(channel)) {
      try {
        const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, {
          signal: AbortSignal.timeout(3500),
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SorteiosBrasil/1.0)',
            Accept: 'application/json',
          },
        });
        if (res.ok) {
          const json = (await res.json()) as {user?: {profile_pic?: string}};
          const pic = json?.user?.profile_pic;
          if (typeof pic === 'string' && isSafePublicHttpUrl(pic)) {
            return pic;
          }
        }
      } catch {
        // Fallback to HTML meta extraction below
      }
    }
  }

  // 3. Generic HTML og:image / YouTube channel avatar / TikTok avatarLarger
  try {
    const res = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(3500),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // TikTok JSON avatarLarger / avatarMedium
    if (host.includes('tiktok.com')) {
      const ttMatch = html.match(/"avatar(?:Larger|Medium)"\s*:\s*"([^"]+)"/);
      if (ttMatch && ttMatch[1]) {
        const decoded = ttMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, '');
        if (isSafePublicHttpUrl(decoded)) return decoded;
      }
    }

    // YouTube channel / video owner avatar
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const ytAvatarMatch = html.match(
        /https:\/\/yt3\.(?:googleusercontent|ggpht)\.com\/[A-Za-z0-9_=-]+/,
      );
      if (ytAvatarMatch && isSafePublicHttpUrl(ytAvatarMatch[0])) {
        return ytAvatarMatch[0];
      }
    }

    const ogImg = extractMetaImage(html);
    if (ogImg) return ogImg;
  } catch {
    return null;
  }

  return null;
}

export async function resolvePartnerAvatarFromLinks(links: string[]): Promise<string | null> {
  for (const link of links) {
    const resolved = await resolveSingleLinkAvatar(link);
    if (resolved) return resolved;
  }
  return null;
}
