import Docker from 'dockerode';
import type { ActionResult } from '@theaiinc/realm-core';

/**
 * UbuntuDisplay — manages screen capture and input simulation
 * for Ubuntu Desktop containers via xdotool + ImageMagick.
 *
 * Uses lightweight CLI tools instead of Python/pyautogui
 * for faster execution and fewer dependencies.
 */
export class UbuntuDisplay {
  constructor(private readonly docker: Docker) {}

  /**
   * Capture the current screen as a PNG buffer.
   * Uses `import` (ImageMagick) to grab from the Xvfb display.
   */
  async capture(containerId: string): Promise<Buffer> {
    const container = this.docker.getContainer(containerId);
    try {
      const exec = await container.exec({
        Cmd: [
          'bash',
          '-c',
          'DISPLAY=:99 import -window root /tmp/screenshot.png 2>/dev/null && cat /tmp/screenshot.png || echo "capture-failed"',
        ],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false, Tty: false });
      return this.streamToBuffer(stream as NodeJS.ReadableStream);
    } catch {
      return Buffer.from('capture-unavailable');
    }
  }

  /**
   * Click at (x, y) using xdotool.
   */
  async click(
    containerId: string,
    x: number,
    y: number,
    button?: 'left' | 'right' | 'middle',
  ): Promise<ActionResult> {
    const btn = button ?? 'left';
    return this.runXdotool(containerId, `mousemove ${x} ${y} click ${btn}`);
  }

  /**
   * Type text using xdotool (types at current cursor position).
   */
  async typeText(
    containerId: string,
    text: string,
  ): Promise<ActionResult> {
    // Escape single quotes for bash, use xdotool type with --delay
    const escaped = text.replace(/'/g, "'\\''");
    return this.runXdotool(
      containerId,
      `type --delay 12 '${escaped}'`,
    );
  }

  /**
   * Press a key using xdotool.
   */
  async keyPress(
    containerId: string,
    key: string,
  ): Promise<ActionResult> {
    return this.runXdotool(containerId, `key ${key}`);
  }

  /**
   * Scroll using xdotool (click at center then scroll).
   */
  async scroll(
    containerId: string,
    _deltaX: number,
    deltaY: number,
  ): Promise<ActionResult> {
    const clicks = Math.min(Math.abs(Math.ceil(deltaY / 3)), 20);
    return this.runXdotool(
      containerId,
      `click --repeat ${clicks} 5`, // 5 = wheel down, 4 = wheel up
    );
  }

  /**
   * Get the current mouse position.
   */
  async getMousePosition(
    containerId: string,
  ): Promise<{ x: number; y: number }> {
    try {
      const exec = await this.docker.getContainer(containerId).exec({
        Cmd: [
          'bash',
          '-c',
          'DISPLAY=:99 xdotool getmouselocation --shell 2>/dev/null',
        ],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false, Tty: false });
      const buf = await this.streamToText(stream as NodeJS.ReadableStream);
      const lines = buf.toString().trim().split('\n');
      const x = parseInt(lines.find((l) => l.startsWith('X='))?.split('=')[1] ?? '0', 10);
      const y = parseInt(lines.find((l) => l.startsWith('Y='))?.split('=')[1] ?? '0', 10);
      return { x, y };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  private async runXdotool(
    containerId: string,
    xdotoolCmd: string,
  ): Promise<ActionResult> {
    const container = this.docker.getContainer(containerId);
    const startTime = Date.now();
    try {
      const exec = await container.exec({
        Cmd: [
          'bash',
          '-c',
          `DISPLAY=:99 xdotool ${xdotoolCmd} 2>/dev/null`,
        ],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false, Tty: false });
      const { stdout, stderr } = await this.streamToResult(
        stream as NodeJS.ReadableStream,
      );

      return {
        success: true,
        data: { stdout, stderr },
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private streamToBuffer(
    stream: NodeJS.ReadableStream,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private streamToText(
    stream: NodeJS.ReadableStream,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private streamToResult(
    stream: NodeJS.ReadableStream,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const stdoutBuf: Buffer[] = [];
      const stderrBuf: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => {
        for (let i = 0; i < chunk.length; ) {
          const streamType = chunk[i];
          if (streamType === undefined) break;
          const payloadLen =
            ((chunk[i + 4] ?? 0) << 24) |
            ((chunk[i + 5] ?? 0) << 16) |
            ((chunk[i + 6] ?? 0) << 8) |
            (chunk[i + 7] ?? 0);
          const payload = chunk.subarray(i + 8, i + 8 + payloadLen);
          if (streamType === 1) stdoutBuf.push(payload);
          else if (streamType === 2) stderrBuf.push(payload);
          i += 8 + payloadLen;
        }
      });

      stream.on('end', () =>
        resolve({
          stdout: Buffer.concat(stdoutBuf).toString(),
          stderr: Buffer.concat(stderrBuf).toString(),
        }),
      );
      stream.on('error', reject);
    });
  }
}
