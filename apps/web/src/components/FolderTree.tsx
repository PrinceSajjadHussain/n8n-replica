import { useState } from 'react';
import type { FolderNode } from '../lib/folders';

interface FolderTreeProps {
  nodes: FolderNode[];
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onCreateChild: (parentId: string | null) => void;
  onRename: (folderId: string, currentName: string) => void;
  onDelete: (folderId: string) => void;
  /** Called when a workflow chip (dragged from the list) is dropped on a folder row. */
  onDropWorkflow: (workflowId: string, folderId: string | null) => void;
  counts: Record<string, number>;
}

/** One row + its children, recursively. Kept as a separate component (rather
 *  than inlining the recursion in FolderTree) so each row can hold its own
 *  "expanded" and "menu open" state without re-rendering siblings. */
function FolderRow({
  node,
  depth,
  selectedFolderId,
  onSelect,
  onCreateChild,
  onRename,
  onDelete,
  onDropWorkflow,
  counts,
}: FolderTreeProps & { node: FolderNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-flowforge-workflow')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const workflowId = e.dataTransfer.getData('application/x-flowforge-workflow');
          if (workflowId) onDropWorkflow(workflowId, node.id);
        }}
        className={`group flex items-center gap-1 rounded-md pr-1 text-sm transition-default ${
          selectedFolderId === node.id ? 'bg-signal/10 text-signal' : 'text-muted hover:text-ink hover:bg-canvas'
        } ${dragOver ? 'ring-1 ring-signal' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className={`focus-ring w-4 h-4 shrink-0 grid place-items-center text-[10px] ${hasChildren ? '' : 'opacity-0'}`}
          aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button onClick={() => onSelect(node.id)} className="focus-ring flex-1 flex items-center gap-1.5 py-1.5 text-left truncate">
          <span aria-hidden>📁</span>
          <span className="truncate">{node.name}</span>
          {counts[node.id] > 0 && <span className="text-[10px] text-muted">{counts[node.id]}</span>}
        </button>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="focus-ring opacity-0 group-hover:opacity-100 w-5 h-5 grid place-items-center text-xs rounded hover:bg-panelBorder/40"
            aria-label="Folder actions"
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-6 z-10 w-36 bg-panel border border-panelBorder rounded-md shadow-lg py-1"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onCreateChild(node.id);
                }}
                className="focus-ring w-full text-left px-3 py-1.5 text-xs text-muted hover:text-ink hover:bg-canvas"
              >
                + Subfolder
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onRename(node.id, node.name);
                }}
                className="focus-ring w-full text-left px-3 py-1.5 text-xs text-muted hover:text-ink hover:bg-canvas"
              >
                Rename
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(node.id);
                }}
                className="focus-ring w-full text-left px-3 py-1.5 text-xs text-alert hover:bg-canvas"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      {expanded &&
        node.children.map((child) => (
          <FolderRow
            key={child.id}
            node={child}
            depth={depth + 1}
            nodes={[]}
            selectedFolderId={selectedFolderId}
            onSelect={onSelect}
            onCreateChild={onCreateChild}
            onRename={onRename}
            onDelete={onDelete}
            onDropWorkflow={onDropWorkflow}
            counts={counts}
          />
        ))}
    </div>
  );
}

export default function FolderTree(props: FolderTreeProps) {
  const { nodes, selectedFolderId, onSelect, onCreateChild, onDropWorkflow, counts } = props;
  const [rootDragOver, setRootDragOver] = useState(false);

  return (
    <div className="w-56 shrink-0 border-r border-panelBorder pr-3 mr-5">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[10px] uppercase tracking-wider text-muted">Folders</span>
        <button
          onClick={() => onCreateChild(null)}
          className="focus-ring text-[11px] text-muted hover:text-signal transition-default"
          aria-label="New root folder"
        >
          + New
        </button>
      </div>

      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-flowforge-workflow')) {
            e.preventDefault();
            setRootDragOver(true);
          }
        }}
        onDragLeave={() => setRootDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setRootDragOver(false);
          const workflowId = e.dataTransfer.getData('application/x-flowforge-workflow');
          if (workflowId) onDropWorkflow(workflowId, null);
        }}
        onClick={() => onSelect(null)}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-default mb-1 ${
          selectedFolderId === null ? 'bg-signal/10 text-signal' : 'text-muted hover:text-ink hover:bg-canvas'
        } ${rootDragOver ? 'ring-1 ring-signal' : ''}`}
      >
        <span aria-hidden>🗂</span>
        All workflows
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        {nodes.map((node) => (
          <FolderRow key={node.id} node={node} depth={0} {...props} />
        ))}
      </div>

      {nodes.length === 0 && <p className="text-[11px] text-muted px-2 mt-1">No folders yet — create one to organize workflows.</p>}
    </div>
  );
}
