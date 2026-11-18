import React, {useState} from 'react';
import {ExternalLink} from 'lucide-react';
import type {RaffleWinnerPublic} from '../data/raffles';
import {socialPlatformLabel} from '../../shared/social.ts';

function initials(name: string): string {
  const parts = name.replace(/\./g, '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** Ganhador: foto de perfil (ou iniciais), nome e @ com link para a rede social. */
export function WinnerProfile({winner}: {winner: RaffleWinnerPublic}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = Boolean(winner.avatarUrl) && !avatarFailed;
  const hasSocial = Boolean(winner.socialHandle && winner.socialUrl && winner.socialPlatform);

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-[#FFD166] bg-[#2A2235] shadow-[0_0_24px_rgba(255,209,102,0.25)]">
        {showAvatar ? (
          <img
            src={winner.avatarUrl!}
            alt={`Foto de perfil de ${winner.buyerDisplayName}`}
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setAvatarFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center font-display text-xl font-bold text-[#FFD166]"
          >
            {initials(winner.buyerDisplayName)}
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#FFD166]">Ganhador</p>
        <p className="truncate text-lg font-bold text-white">{winner.buyerDisplayName}</p>
        {hasSocial && (
          <a
            href={winner.socialUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-[#FF7EB3] hover:text-white"
          >
            <span className="truncate">@{winner.socialHandle}</span>
            <span className="text-xs text-[#A59FB8]">· {socialPlatformLabel(winner.socialPlatform!)}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}
