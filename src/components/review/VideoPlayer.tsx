"use client";

import type { RefObject } from "react";

type Props = {
  src: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  label: string;
  muted?: boolean;
  onTimeUpdate?: (t: number) => void;
};

export function VideoPlayer({ src, videoRef, label, muted = false, onTimeUpdate }: Props) {
  return (
    <video
      ref={videoRef}
      src={src}
      controls
      playsInline
      muted={muted}
      preload="metadata"
      aria-label={label}
      onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
      className="aspect-[9/16] max-h-[70vh] w-full rounded-lg bg-black"
    />
  );
}
