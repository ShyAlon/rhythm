/** Tiny registry so any view can ask the running sync engine to sync now. */
let handler: (() => void) | null = null;

export function registerSyncNow(fn: (() => void) | null): void {
  handler = fn;
}

export function syncNow(): void {
  handler?.();
}
