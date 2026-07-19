import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** ms before auto-dismiss; 0 disables auto-dismiss */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, variant?: ToastVariant, duration?: number) => string;
  dismiss: (id: string) => void;
}

let counter = 0;

/**
 * Lightweight global toast store. Any component/module (including
 * non-React code like the Socket.IO handlers in CanvasPage) can call
 * `toast.success(...)`/`toast.error(...)`/`toast.info(...)` — see the
 * `toast` helper exported below — without needing to be inside a
 * provider tree. `<ToastViewport />` (mounted once in AppShell) renders
 * whatever is in the store.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, variant = 'info', duration = 3500) => {
    const id = `toast_${Date.now()}_${counter++}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant, duration }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper for firing toasts from anywhere (event handlers,
 *  socket callbacks, non-component utility code). */
export const toast = {
  success: (message: string, duration?: number) => useToastStore.getState().push(message, 'success', duration),
  error: (message: string, duration?: number) => useToastStore.getState().push(message, 'error', duration),
  info: (message: string, duration?: number) => useToastStore.getState().push(message, 'info', duration),
};
