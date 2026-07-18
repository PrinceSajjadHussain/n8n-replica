import { memo } from 'react';
import { NodeResizer } from '@xyflow/react';

export interface GroupNodeData {
  label: string;
  [key: string]: unknown;
}

/** A resizable, labeled container node. Other nodes become children of a
 *  group by setting `parentId` to this node's id (and `extent: 'parent'`),
 *  which is how @xyflow/react natively models node grouping — dragging the
 *  group moves its children with it. Created via the "Group selection"
 *  command in the command palette / toolbar. */
function GroupNode({ data, selected }: { data: GroupNodeData; selected?: boolean }) {
  return (
    <div
      className="w-full h-full rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50/40"
      style={{ minWidth: 200, minHeight: 150 }}
    >
      <NodeResizer isVisible={selected} minWidth={200} minHeight={150} lineStyle={{ borderColor: '#818cf8' }} />
      <div className="px-2 py-1 text-xs font-medium text-indigo-700 bg-indigo-100/80 rounded-t-md inline-block nodrag">
        {data.label || 'Group'}
      </div>
    </div>
  );
}

export default memo(GroupNode);
