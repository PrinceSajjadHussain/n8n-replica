import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

/**
 * Default edge renderer for the canvas. Behaves exactly like React Flow's
 * built-in bezier edge (same path math, honors whatever `style`/`animated`/
 * `className` CanvasPage sets on the edge — see setEdgesActive and
 * onConnect's edge-connect-pulse), but additionally draws a small traveling
 * dot along the path while the edge is "active" (a run is currently
 * flowing through this connection). This is make.com's signature look —
 * data visibly moving from node to node — rather than just a dashed
 * marching-ants stroke.
 */
export default function PelletEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  animated,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // CanvasPage flips `animated: true` + a signal-colored stroke on an edge
  // for exactly as long as data is actively flowing through it during a
  // run (see setEdgesActive in CanvasPage.tsx) — that's also our cue to
  // render the pellet.
  const isActive = Boolean(animated);

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {isActive && (
        <EdgeLabelRenderer>
          <svg width="0" height="0" style={{ position: 'absolute' }}>
            <defs>
              <path id={`pellet-path-${id}`} d={edgePath} />
            </defs>
          </svg>
        </EdgeLabelRenderer>
      )}
      {isActive && (
        <circle
          r={3.5}
          className="edge-pellet"
          style={{
            offsetPath: `path('${edgePath}')`,
            fill: 'rgb(var(--color-signal))',
            filter: 'drop-shadow(0 0 4px rgb(var(--color-signal) / 0.9))',
          }}
        />
      )}
    </>
  );
}