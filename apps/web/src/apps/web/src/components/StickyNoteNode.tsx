import { memo, useState } from 'react';
import { NodeResizer } from '@xyflow/react';

export interface StickyNoteData {
  text: string;
  color?: string;
  [key: string]: unknown;
}

const COLORS = ['#fef3c7', '#dbeafe', '#dcfce7', '#fce7f3', '#e0e7ff'];

/** A freeform annotation on the canvas — doesn't participate in workflow
 *  execution, just documentation for collaborators (n8n/Make-style sticky
 *  notes). Resizable and recolorable; text is stored on the node's data so
 *  it round-trips through the same save/load path as real nodes (params
 *  stays empty for this type, since the executor should skip it). */
function StickyNoteNode({ data, selected, id }: { data: StickyNoteData; selected?: boolean; id: string }) {
  const [text, setText] = useState(data.text ?? '');

  return (
    <div
      className="rounded-md shadow-sm border border-black/10 p-3 flex flex-col"
      style={{ background: data.color ?? COLORS[0], width: '100%', height: '100%', minWidth: 160, minHeight: 120 }}
    >
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} />
      <div className="flex gap-1 mb-1 nodrag">
        {COLORS.map((c) => (
          <button
            key={c}
            aria-label={`sticky note color ${c}`}
            className="w-4 h-4 rounded-full border border-black/20"
            style={{ background: c }}
            onClick={() => {
              data.color = c;
              const evt = new CustomEvent('flowforge:sticky-color', { detail: { id, color: c } });
              window.dispatchEvent(evt);
            }}
          />
        ))}
      </div>
      <textarea
        className="flex-1 bg-transparent resize-none outline-none text-sm nodrag"
        placeholder="Note..."
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          data.text = e.target.value;
          window.dispatchEvent(new CustomEvent('flowforge:sticky-text', { detail: { id, text: e.target.value } }));
        }}
      />
    </div>
  );
}

export default memo(StickyNoteNode);
