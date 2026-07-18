import { useEffect, useState } from 'react';

/** Subscribes to a CSS media query and re-renders on change. Used to switch
 *  between the full drag-and-drop canvas (desktop/tablet) and the read-only
 *  execution monitor (phones) — the canvas' multi-panel drag interactions
 *  don't translate to a touch/narrow viewport. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));

  useEffect(() => {
    const mql = window.matchMedia(query);
    const listener = () => setMatches(mql.matches);
    listener();
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

/** Matches Tailwind's `sm` breakpoint — below this we treat the client as a phone. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 640px)');
}
