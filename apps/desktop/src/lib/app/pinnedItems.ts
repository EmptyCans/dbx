import type { TreeNode } from "@/types/database";

export type PinnedTreeNodeUpdateScope = "missing" | "root" | "siblings";

export function treeNodePinKey(node: TreeNode): string {
  if (!node.connectionId) return node.id;
  const identity = [node.database || "", node.schema || "", node.catalog || "", node.type, node.objectName || node.tableName || node.label, node.signature || "", node.id];
  return `${node.connectionId}:pin:v2:${encodeURIComponent(JSON.stringify(identity))}`;
}

export function migrateLegacyPinnedTreeNodeIds(nodes: readonly TreeNode[], pinnedIds: Set<string>): { ids: Set<string>; changed: boolean } {
  const next = new Set(pinnedIds);
  let changed = false;
  const visit = (items: readonly TreeNode[]) => {
    for (const node of items) {
      const pinKey = treeNodePinKey(node);
      if (pinKey !== node.id && next.has(node.id) && !next.has(pinKey)) {
        // A legacy id cannot distinguish colliding nodes. Claim it once for the
        // first matching loaded node, then persist the fully scoped identity.
        next.delete(node.id);
        next.add(pinKey);
        changed = true;
      }
      if (node.children) visit(node.children);
      if (node.hiddenChildren) visit(node.hiddenChildren);
    }
  };
  visit(nodes);
  return { ids: next, changed };
}

export function orderPinnedFirst<T>(items: T[], isPinned: (item: T) => boolean): T[] {
  const pinned: T[] = [];
  const unpinned: T[] = [];

  for (const item of items) {
    if (isPinned(item)) pinned.push(item);
    else unpinned.push(item);
  }

  return [...pinned, ...unpinned];
}

function findTreeNodeLocation(nodes: TreeNode[], target: TreeNode, parent: TreeNode | null = null): { node: TreeNode; parent: TreeNode | null } | null {
  const targetKey = treeNodePinKey(target);
  for (const node of nodes) {
    if (node === target || treeNodePinKey(node) === targetKey) return { node, parent };
    if (node.children) {
      const found = findTreeNodeLocation(node.children, target, node);
      if (found) return found;
    }
  }
  return null;
}

export function updatePinnedTreeNodeInPlace(nodes: TreeNode[], target: TreeNode, pinned: boolean): PinnedTreeNodeUpdateScope {
  const location = findTreeNodeLocation(nodes, target);
  if (!location) return "missing";

  location.node.pinned = pinned;
  const siblings = location.parent?.children ?? nodes;
  const ordered = orderPinnedFirst(siblings, (node) => !!node.pinned);

  if (location.parent) {
    location.parent.children = ordered;
    return "siblings";
  }

  nodes.splice(0, nodes.length, ...ordered);
  return "root";
}

function clonePinnedTreeNode(node: TreeNode, pinnedIds: Set<string>, clones: WeakMap<TreeNode, TreeNode>): TreeNode {
  const existing = clones.get(node);
  if (existing) return existing;
  const clone: TreeNode = {
    ...node,
    pinned: pinnedIds.has(treeNodePinKey(node)) || pinnedIds.has(node.id),
  };
  clones.set(node, clone);
  if (node.children) clone.children = applyPinnedTreeNodeStateInternal(node.children, pinnedIds, clones);
  if (node.hiddenChildren) clone.hiddenChildren = applyPinnedTreeNodeStateInternal(node.hiddenChildren, pinnedIds, clones);
  return clone;
}

function applyPinnedTreeNodeStateInternal(nodes: TreeNode[], pinnedIds: Set<string>, clones: WeakMap<TreeNode, TreeNode>): TreeNode[] {
  return orderPinnedFirst(
    nodes.map((node) => clonePinnedTreeNode(node, pinnedIds, clones)),
    (node) => !!node.pinned,
  );
}

export function applyPinnedTreeNodeState(nodes: TreeNode[], pinnedIds: Set<string>): TreeNode[] {
  return applyPinnedTreeNodeStateInternal(nodes, pinnedIds, new WeakMap());
}

function syncPinnedTreeNodeStateInPlaceInternal(nodes: TreeNode[], pinnedIds: Set<string>, visited: WeakSet<TreeNode>): void {
  for (const node of nodes) {
    if (visited.has(node)) continue;
    visited.add(node);
    node.pinned = pinnedIds.has(treeNodePinKey(node)) || pinnedIds.has(node.id);
    if (node.children) {
      syncPinnedTreeNodeStateInPlaceInternal(node.children, pinnedIds, visited);
      node.children = orderPinnedFirst(node.children, (child) => !!child.pinned);
    }
    if (node.hiddenChildren) {
      syncPinnedTreeNodeStateInPlaceInternal(node.hiddenChildren, pinnedIds, visited);
      node.hiddenChildren = orderPinnedFirst(node.hiddenChildren, (child) => !!child.pinned);
    }
  }
  nodes.splice(0, nodes.length, ...orderPinnedFirst(nodes, (node) => !!node.pinned));
}

export function syncPinnedTreeNodeStateInPlace(nodes: TreeNode[], pinnedIds: Set<string>): void {
  syncPinnedTreeNodeStateInPlaceInternal(nodes, pinnedIds, new WeakSet());
}
