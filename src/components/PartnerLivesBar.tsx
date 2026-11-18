import React, {useState} from 'react';
import {ExternalLink, Radio} from 'lucide-react';
import {LivePlatformName, PublicLivePartner} from '../data/raffles';

interface PartnerLivesBarProps {
  partners: PublicLivePartner[];
  onSelectReferralCode?: (code: string) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'LV';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function platformDotColor(platform: LivePlatformName): string {
  switch (platform) {
    case 'Twitch':
      return 'text-[#A970FF] hover:text-white';
    case 'YouTube':
      return 'text-[#FF5555] hover:text-white';
    case 'Kick':
      return 'text-[#53FC18] hover:text-white';
    case 'TikTok':
      return 'text-[#7AE0FF] hover:text-white';
    case 'Instagram':
      return 'text-[#FF7EB3] hover:text-white';
    case 'Facebook':
      return 'text-[#60A5FA] hover:text-white';
    default:
      return 'text-[#FFD166] hover:text-white';
  }
}

export function PartnerLivesBar({partners}: PartnerLivesBarProps) {
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  if (partners.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Lives Parceiras"
      className="border-b border-white/10 bg-[#0E0C15]"
    >
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2.5 shrink-0">
            <Radio className="h-4 w-4 text-red-500" aria-hidden="true" />
            <div>
              <h2 className="font-display text-xl font-bold tracking-wide text-white">
                Lives Parceiras
              </h2>
              <p className="text-xs text-[#958FA8]">
                Criadores transmitindo agora · use o cupom na sua cota
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 sm:gap-8">
            {partners.map((partner) => {
              const primaryUrl = partner.platforms[0]?.url || '#';
              const showFallback = !partner.avatarUrl || failedImages[partner.id];

              return (
                <div
                  key={partner.id}
                  className="flex items-center gap-4"
                >
                  {/* Round profile photo with red border and right-side Live indicator */}
                  <a
                    href={primaryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Assistir live de ${partner.promoterName}`}
                    className="group relative block shrink-0 focus-visible:outline-none"
                  >
                    <div className="h-16 w-16 overflow-hidden rounded-full border-2 border-red-500 bg-[#1A1625] p-0.5 ring-2 ring-red-500/25 transition-transform duration-200 group-hover:scale-105">
                      {showFallback ? (
                        <div className="flex h-full w-full items-center justify-center rounded-full bg-[#241E33] font-display text-lg font-bold text-white">
                          {getInitials(partner.promoterName)}
                        </div>
                      ) : (
                        <img
                          src={partner.avatarUrl!}
                          alt={`Foto de perfil de ${partner.promoterName}`}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setFailedImages((prev) => ({...prev, [partner.id]: true}))
                          }
                          className="h-full w-full rounded-full object-cover"
                        />
                      )}
                    </div>

                    {/* Bolinha na lateral direita inferior escrito Live */}
                    <span className="absolute -bottom-0.5 -right-2 flex items-center gap-1 rounded-full border-2 border-[#0E0C15] bg-red-600 px-2 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
                      <span>Live</span>
                    </span>
                  </a>

                  {/* Partner name, referral code & all live platforms for this user */}
                  <div className="min-w-0 pl-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white">
                        {partner.promoterName}
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-[#FFD166]">
                        · {partner.code}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      {partner.platforms.map((plat, idx) => (
                        <React.Fragment key={`${plat.url}-${idx}`}>
                          {idx > 0 && (
                            <span className="text-[10px] text-white/25" aria-hidden="true">
                              ·
                            </span>
                          )}
                          <a
                            href={plat.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-1 text-xs font-medium transition-colors whitespace-nowrap ${platformDotColor(
                              plat.platform,
                            )}`}
                          >
                            <span>{plat.platform}</span>
                            <ExternalLink className="h-3 w-3 opacity-70" aria-hidden="true" />
                          </a>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
