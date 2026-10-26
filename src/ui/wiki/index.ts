import type { WikiEntry } from './types';

const modules = import.meta.glob<{ entries: WikiEntry[] }>('./*.ts', { eager: true });

export const WIKI: WikiEntry[] = Object.entries(modules)
  .filter(([path]) => !path.endsWith('/index.ts') && !path.endsWith('/types.ts'))
  .flatMap(([, m]) => m.entries ?? []);
