interface CanvasHandlePlusProps {
  visible: boolean;
  color: string;
  onClick: () => void;
  title?: string;
}

/**
 * n8n's "+" affordance on an empty output/input handle. Scale+opacity
 * transition mirrors CanvasHandleMainOutput's `.canvas-node-handle-main-output-*`
 * transition classes (0.2s ease, origin at the handle).
 */
export default function CanvasHandlePlus({ visible, color, onClick, title }: CanvasHandlePlusProps) {
  return (
    <button
      type="button"
      title={title ?? 'Add connected node'}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="focus-ring flex items-center justify-center rounded-full border transition-[transform,opacity] duration-200 ease-out hover:scale-110"
      style={{
        width: 16,
        height: 16,
        borderColor: color,
        color,
        background: 'rgb(var(--color-panel))',
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1)' : 'scale(0)',
        pointerEvents: visible ? 'auto' : 'none',
        fontSize: 11,
        lineHeight: 1,
      }}
    >
      +
    </button>
  );
}
