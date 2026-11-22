declare module '*/mock-server.mjs' {
  import type { Server } from 'node:http';
  export function createMockServer(opts?: { statePath?: string }): Server;
}
