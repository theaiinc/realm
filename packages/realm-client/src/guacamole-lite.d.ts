// guacamole-lite (https://github.com/vadimpronin/guacamole-lite) ships no
// published TypeScript types. This declares only the shape this package
// actually uses.
declare module 'guacamole-lite' {
  import type { Server as HttpServer } from 'node:http';

  export interface WebSocketOptions {
    port?: number;
    server?: HttpServer;
  }

  export interface GuacdOptions {
    host: string;
    port: number;
  }

  export interface ConnectionSettings {
    connection: {
      type: string;
      settings: Record<string, string>;
    };
  }

  export interface ClientOptions {
    crypt: {
      cypher: string;
      key: string;
    };
    log?: { level?: string };
    connectionDefaultSettings?: Record<string, Record<string, unknown>>;
    processConnectionSettings?: (
      settings: ConnectionSettings,
      callback: (err: Error | null, settings?: ConnectionSettings) => void,
    ) => void;
  }

  export interface ClientConnection {
    connectionId: string;
    query: Record<string, string>;
  }

  export default class GuacamoleLite {
    constructor(websocketOptions: WebSocketOptions, guacdOptions: GuacdOptions, clientOptions?: ClientOptions);
    on(event: 'open' | 'close', listener: (clientConnection: ClientConnection) => void): void;
    on(event: 'error', listener: (clientConnection: ClientConnection, error: Error) => void): void;
  }
}
