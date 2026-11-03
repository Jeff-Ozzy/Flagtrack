/** Browser replacement for `node:crypto` (only randomUUID is used by the API). */
export const randomUUID = () => crypto.randomUUID();
