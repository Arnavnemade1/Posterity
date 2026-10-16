export type ToastTone = 'default' | 'success' | 'error';

/** Say something short and brief: "Link copied". Safe to call from any client event handler. */
export function toast(message: string, tone: ToastTone = 'default') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('posterity:toast', { detail: { message, tone } }));
}
