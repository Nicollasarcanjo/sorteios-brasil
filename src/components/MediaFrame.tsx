import React, {useState} from 'react';
import {ImageOff} from 'lucide-react';

interface MediaFrameProps {
  src: string;
  alt: string;
  aspectClass?: string;
  className?: string;
  children?: React.ReactNode;
}

export function MediaFrame({
  src,
  alt,
  aspectClass = 'aspect-[4/3]',
  className = '',
  children,
}: MediaFrameProps) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`relative overflow-hidden bg-[#171422] ${aspectClass} ${className}`}
    >
      {!failed ? (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#231936] via-[#171422] to-[#2B1525] p-6 text-center">
          <ImageOff className="mb-2 h-6 w-6 text-[#FF4E8E]/70" aria-hidden="true" />
          <span className="font-display text-lg uppercase tracking-wide text-white/80">
            {alt}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
