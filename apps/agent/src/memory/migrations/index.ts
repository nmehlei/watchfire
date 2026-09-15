import m0001 from './0001-init.js';
import m0002 from './0002-mutes.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Ordered by version. New migrations append here.
export const migrations: Migration[] = [m0001, m0002];
