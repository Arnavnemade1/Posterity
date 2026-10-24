'use client';

import { useSyncExternalStore } from 'react';

// Whether the visitor has paused the hero's animation. Held outside React so the canvas loop can read it every
// frame without a re-render, and the composer and the control both follow the same flag.
let paused = false;
const listeners = new Set<() => void>();

export const isMotionPaused = () => paused;

export function setMotionPaused(next: boolean) {
  paused = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useMotionPaused = () => useSyncExternalStore(subscribe, isMotionPaused, () => false);

const subscribeReduced = (onChange: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The visitor's system setting. When it is on there is nothing to pause: the sky is a still frame. */
export const useReducedMotion = () => useSyncExternalStore(subscribeReduced, prefersReduced, () => false);
