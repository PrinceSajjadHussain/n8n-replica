import { useStore } from '@xyflow/react';

/**
 * Mirrors n8n's `useZoomAdjustedValues` (canvas/composables): as the canvas
 * zooms out, port labels and the "+" affordance would otherwise shrink into
 * illegibility, so we scale them up inversely to zoom, and nudge the handle
 * border lightness so dots/diamonds keep contrast against the canvas at any
 * zoom level.
 */
export function useZoomCompensation() {
  const zoom = useStore((s) => s.transform[2]);

  // Inverse-scale, clamped so labels don't balloon at extreme zoom-out.
  const compensation = Math.min(1.6, Math.max(1, 1 / Math.max(zoom, 0.35)));

  // Slightly lighter borders once zoomed out past 70%, dark theme + light theme both read fine.
  const lightnessBoost = zoom < 0.7 ? Math.min(20, (0.7 - zoom) * 60) : 0;

  return {
    zoom,
    compensation,
    style: {
      '--canvas-zoom-compensation-factor': compensation,
      '--handle-border-lightness-boost': `${lightnessBoost}%`,
    } as React.CSSProperties,
  };
}
