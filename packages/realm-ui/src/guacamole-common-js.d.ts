// guacamole-common-js (https://github.com/apache/guacamole-client) ships no
// published TypeScript types. This declares only the shape this package uses.
declare module 'guacamole-common-js' {
  namespace Guacamole {
    class Tunnel {}

    class WebSocketTunnel extends Tunnel {
      constructor(url: string);
    }

    class Display {
      getElement(): HTMLElement;
      getWidth(): number;
      getHeight(): number;
      scale(factor: number): void;
      onresize: ((width: number, height: number) => void) | null;
    }

    class Client {
      constructor(tunnel: Tunnel);
      connect(data?: string): void;
      disconnect(): void;
      getDisplay(): Display;
      sendKeyEvent(pressed: 0 | 1, keysym: number): void;
      sendMouseState(state: MouseState): void;
      onerror: ((status: { message?: string; code?: number }) => void) | null;
      onstatechange: ((state: number) => void) | null;
    }

    interface MouseState {
      x: number;
      y: number;
      left: boolean;
      middle: boolean;
      right: boolean;
      up: boolean;
      down: boolean;
    }

    class Mouse {
      constructor(element: HTMLElement);
      onmousedown: ((state: MouseState) => void) | null;
      onmouseup: ((state: MouseState) => void) | null;
      onmousemove: ((state: MouseState) => void) | null;
    }

    class Keyboard {
      constructor(element: HTMLElement | Document);
      onkeydown: ((keysym: number) => void) | null;
      onkeyup: ((keysym: number) => void) | null;
    }
  }

  export = Guacamole;
}
