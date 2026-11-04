// State for library management (administrators): the right-click menu, the dialog it
// opens, and multi-select. A tiny external store so a card only re-renders when its own
// selected state changes.

import { useSyncExternalStore } from "react";
import type { BaseItem } from "@/api/types";

export type DialogKind = "delete" | "refresh" | "collection" | "playlist" | "info" | "metadata" | "images" | "subtitles";

export interface MenuState {
  item: BaseItem;
  /** Where to open: a pointer position, or the button that opened it. */
  x: number;
  y: number;
  /** Opened from a button (the menu then sits below it, keyboard-focused). */
  fromButton: boolean;
}

interface State {
  menu: MenuState | null;
  dialog: { kind: DialogKind; items: BaseItem[] } | null;
  /** null when not selecting. */
  selection: Map<string, BaseItem> | null;
}

let state: State = { menu: null, dialog: null, selection: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function openMenu(item: BaseItem, at: { x: number; y: number }, fromButton = false) {
  set({ menu: { item, x: at.x, y: at.y, fromButton } });
}

export const closeMenu = () => set({ menu: null });

export function openDialog(kind: DialogKind, items: BaseItem[]) {
  set({ menu: null, dialog: { kind, items } });
}

export const closeDialog = () => set({ dialog: null });

export function startSelection(item?: BaseItem) {
  set({ menu: null, selection: new Map(item ? [[item.Id, item]] : []) });
}

export function toggleSelected(item: BaseItem) {
  if (!state.selection) return;
  const selection = new Map(state.selection);
  if (selection.has(item.Id)) selection.delete(item.Id);
  else selection.set(item.Id, item);
  set({ selection });
}

export const endSelection = () => set({ selection: null });

export const useManageState = () => useSyncExternalStore(subscribe, () => state);
export const useSelecting = () => useSyncExternalStore(subscribe, () => state.selection !== null);
export const useIsSelected = (id: string) => useSyncExternalStore(subscribe, () => state.selection?.has(id) ?? false);
