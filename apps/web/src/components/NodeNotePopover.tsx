/** Read-only popover that reveals a node's freeform note on hover/click of
 *  the note affordance in FlowNode.tsx — mirrors NodeInspectPopover's
 *  absolute-positioned card styling so canvas popovers feel consistent.
 *  Editing happens in NodeConfigPanel's Notes field, not here. */
export default function NodeNotePopover({ notes, onClose }: { notes: string; onClose: () => void }) {
  return (
    <div
      className="absolute z-40 top-full mt-2 left-1/2 -translate-x-1/2 w-64 max-h-56 flex flex-col bg-panel border border-panelBorder rounded-lg shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-panelBorder">
        <p className="text-xs font-medium text-muted uppercase tracking-wide">Note</p>
        <button onClick={onClose} className="focus-ring text-muted hover:text-ink text-xs leading-none px-1">
          ✕
        </button>
      </div>
      <p className="flex-1 overflow-auto m-3 mt-2 text-[11px] leading-snug whitespace-pre-wrap break-words">
        {notes}
      </p>
    </div>
  );
}
