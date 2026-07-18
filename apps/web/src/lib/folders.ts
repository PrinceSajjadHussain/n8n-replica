import { api } from './api';

export interface Folder {
  id: string;
  workspaceId: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export interface FolderNode extends Folder {
  children: FolderNode[];
}

/** Turns the flat folder list the API returns into a tree keyed by parentId,
 *  the shape <FolderTree /> actually wants to render. */
export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  folders.forEach((f) => byId.set(f.id, { ...f, children: [] }));
  const roots: FolderNode[] = [];
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortByName = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sortByName(n.children));
  };
  sortByName(roots);
  return roots;
}

export async function listFolders(workspaceId: string): Promise<Folder[]> {
  const { data } = await api.get(`/workspaces/${workspaceId}/folders`);
  return data.folders;
}

export async function createFolder(workspaceId: string, name: string, parentId: string | null): Promise<Folder> {
  const { data } = await api.post(`/workspaces/${workspaceId}/folders`, { name, parentId });
  return data.folder;
}

export async function renameFolder(folderId: string, name: string): Promise<Folder> {
  const { data } = await api.patch(`/workspaces/folders/${folderId}`, { name });
  return data.folder;
}

export async function deleteFolder(folderId: string): Promise<void> {
  await api.delete(`/workspaces/folders/${folderId}`);
}

export async function moveWorkflowToFolder(workflowId: string, folderId: string | null): Promise<void> {
  await api.put(`/workflows/${workflowId}`, { folderId });
}
