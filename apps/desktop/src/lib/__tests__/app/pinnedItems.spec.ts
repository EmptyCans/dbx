import { describe, expect, it } from "vitest";
import { migrateLegacyPinnedTreeNodeIds, syncPinnedTreeNodeStateInPlace, treeNodePinKey, updatePinnedTreeNodeInPlace } from "@/lib/app/pinnedItems";
import { buildTreeNodesFromLayout } from "@/lib/sidebar/sidebarLayout";
import type { ConnectionConfig, SidebarLayout, TreeNode } from "@/types/database";

describe("sidebar pinned tree nodes", () => {
  it("reorders the pinned node within its parent", () => {
    const tree: TreeNode[] = [
      {
        id: "conn",
        label: "Connection",
        type: "connection",
        children: [
          { id: "conn:db:a", label: "A", type: "database" },
          { id: "conn:db:b", label: "B", type: "database" },
        ],
      },
    ];

    expect(updatePinnedTreeNodeInPlace(tree, tree[0].children![1], true)).toBe("siblings");

    expect(tree[0].children?.map((node) => node.id)).toEqual(["conn:db:b", "conn:db:a"]);
    expect(tree[0].children?.[0].pinned).toBe(true);
  });

  it("reorders pinned root nodes in place", () => {
    const tree: TreeNode[] = [
      { id: "group-a", label: "A", type: "connection-group" },
      { id: "group-b", label: "B", type: "connection-group" },
    ];

    expect(updatePinnedTreeNodeInPlace(tree, tree[1], true)).toBe("root");

    expect(tree.map((node) => node.id)).toEqual(["group-b", "group-a"]);
    expect(tree[0].pinned).toBe(true);
  });

  it("scopes duplicate node ids by database when pinning", () => {
    const databaseA: TreeNode = {
      id: "conn:a",
      label: "A",
      type: "database",
      children: [{ id: "duplicate-table-id", label: "users", type: "table", connectionId: "conn", database: "a" }],
    };
    const databaseB: TreeNode = {
      id: "conn:b",
      label: "B",
      type: "database",
      children: [{ id: "duplicate-table-id", label: "users", type: "table", connectionId: "conn", database: "b" }],
    };
    const tree: TreeNode[] = [{ id: "conn", label: "Connection", type: "connection", children: [databaseA, databaseB] }];

    expect(updatePinnedTreeNodeInPlace(tree, databaseA.children![0], true)).toBe("siblings");

    expect(databaseA.children![0].pinned).toBe(true);
    expect(databaseB.children![0].pinned).not.toBe(true);
  });

  it("clears stale legacy duplicate pins after switching to scoped keys", () => {
    const tableA: TreeNode = { id: "duplicate-table-id", label: "users", type: "table", connectionId: "conn", database: "a", pinned: true };
    const tableB: TreeNode = { id: "duplicate-table-id", label: "users", type: "table", connectionId: "conn", database: "b", pinned: true };
    const tree: TreeNode[] = [
      { id: "conn:a", label: "A", type: "database", children: [tableA] },
      { id: "conn:b", label: "B", type: "database", children: [tableB] },
    ];

    syncPinnedTreeNodeStateInPlace(tree, new Set([treeNodePinKey(tableA)]));

    expect(tableA.pinned).toBe(true);
    expect(tableB.pinned).toBe(false);
  });

  it("migrates a legacy id once instead of pinning every colliding node", () => {
    const tableA: TreeNode = { id: "duplicate-table-id", label: "users", type: "table", connectionId: "conn", database: "a" };
    const tableB: TreeNode = { id: "duplicate-table-id", label: "users", type: "table", connectionId: "conn", database: "b" };

    const migrated = migrateLegacyPinnedTreeNodeIds([tableA, tableB], new Set(["duplicate-table-id"]));

    expect(migrated.changed).toBe(true);
    expect(migrated.ids).toEqual(new Set([treeNodePinKey(tableA)]));
  });

  it("applies pinned state to connection groups when rebuilding from layout", () => {
    const layout: SidebarLayout = {
      groups: [
        { id: "group-a", name: "A", collapsed: false },
        { id: "group-b", name: "B", collapsed: false },
      ],
      order: [
        { type: "group", id: "group-a", children: [] },
        { type: "group", id: "group-b", children: [] },
      ],
    };
    const connections: ConnectionConfig[] = [];

    const nodes = buildTreeNodesFromLayout(layout, connections, new Set(["group-b"]));

    expect(nodes.map((node) => node.id)).toEqual(["group-b", "group-a"]);
    expect(nodes[0].pinned).toBe(true);
  });
});
