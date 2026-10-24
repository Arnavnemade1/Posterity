export type ToastTone = 'default' | 'success' | 'error';

export interface ToastOptions {
  /** One action beside the message, such as Undo. The toast closes when it is clicked. */
  action?: { label: string; run: () => void };
  /** How long it stays, in milliseconds. Hovering holds it. Default 3200 (5000 with an action). */
  duration?: number;
}

/**
 * Say something short and brief: "Link copied". Safe to call from any client event handler.
 * The second argument is the tone; pass options (an Undo, a longer stay) as the third.
 */
export function toast(message: string, tone: ToastTone = 'default', options: ToastOptions = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('posterity:toast', { detail: { message, tone, ...options } }));
}
