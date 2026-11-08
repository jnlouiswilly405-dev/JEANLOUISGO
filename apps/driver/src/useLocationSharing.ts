import { useEffect, useRef, useState } from 'react';

export interface GeoLike {
  watchPosition(ok: (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void, err: (e: { message: string }) => void, opts?: object): number;
  clearWatch(id: number): void;
}

export interface LocationSharingOptions {
  enabled: boolean;
  /** minimum milliseconds between uploads */
  intervalMs?: number;
  send(point: { lat: number; lng: number; accuracyM: number }): Promise<unknown>;
  geolocation?: GeoLike | null;
}

/** Streams the device position while enabled, at most once per interval; stops cleanly on disable/unmount. */
export function useLocationSharing({ enabled, intervalMs = 10_000, send, geolocation }: LocationSharingOptions) {
  const [error, setError] = useState<string | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const geo = geolocation === undefined ? (typeof navigator === 'undefined' ? null : (navigator.geolocation as unknown as GeoLike | undefined) ?? null) : geolocation;

  useEffect(() => {
    if (!enabled) return;
    if (!geo) { setError('Location is not available on this device'); return; }
    setError(null);
    let last = 0;
    const id = geo.watchPosition(
      (p) => {
        const now = Date.now();
        if (now - last < intervalMs) return;
        last = now;
        sendRef.current({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy })
          .then(() => setLastSentAt(now))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not send location'));
      },
      (e) => setError(e.message),
      { enableHighAccuracy: true },
    );
    return () => geo.clearWatch(id);
  }, [enabled, intervalMs, geo]);

  return { error, lastSentAt };
}
