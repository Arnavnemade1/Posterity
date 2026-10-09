import { cache } from 'react';

/** One timestamp per server request, shared by every component in the render. */
export const requestTime = cache(() => Date.now());
