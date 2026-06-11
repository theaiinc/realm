import Docker from 'dockerode';
import type { FileRef } from '@theaiinc/realm-core';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * UbuntuFilesystem — manages file import/export between host and Ubuntu container.
 *
 * Uses Docker tar streams for efficient file transfer
 * without requiring bind mounts.
 */
export class UbuntuFilesystem {
  constructor(private readonly docker: Docker) {}

  async importFile(
    containerId: string,
    sourcePath: string,
    destPath: string,
  ): Promise<FileRef> {
    const container = this.docker.getContainer(containerId);
    const destDir = path.dirname(destPath);

    // Create destination directory inside container
    await this.execInContainer(container, ['mkdir', '-p', destDir]);

    // Read the source file and create a tar containing it
    const content = await fs.promises.readFile(sourcePath);
    const tarBuffer = this.createSingleFileTar(content, path.basename(sourcePath));

    // Put the archive into the container
    await container.putArchive(tarBuffer, { path: destDir });

    const stat = await fs.promises.stat(sourcePath);
    return {
      path: destPath,
      name: path.basename(sourcePath),
      sizeBytes: stat.size,
    };
  }

  async exportFile(
    containerId: string,
    sourcePath: string,
    destPath: string,
  ): Promise<FileRef> {
    const container = this.docker.getContainer(containerId);

    // Get archive from container
    const tarStream = await container.getArchive({ path: sourcePath });
    const chunks: Buffer[] = [];
    for await (const chunk of tarStream) {
      if (Buffer.isBuffer(chunk) || typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk));
      }
    }

    // Ensure destination directory exists
    const resolvedDest = path.resolve(destPath);
    await fs.promises.mkdir(path.dirname(resolvedDest), { recursive: true });

    // Write the raw archive to destination
    await fs.promises.writeFile(resolvedDest, Buffer.concat(chunks));

    const stat = await fs.promises.stat(resolvedDest);
    return {
      path: resolvedDest,
      name: path.basename(resolvedDest),
      sizeBytes: stat.size,
    };
  }

  async listFiles(
    containerId: string,
    dirPath: string,
  ): Promise<FileRef[]> {
    const container = this.docker.getContainer(containerId);
    const { stdout } = await this.execInContainer(container, [
      'bash',
      '-c',
      `ls -la "${dirPath}" | tail -n +2 | awk '{print $5, $9}'`,
    ]);

    const files: FileRef[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      const size = parts[0] ?? '0';
      const name = parts.slice(1).join(' ');
      files.push({
        path: path.join(dirPath, name),
        name,
        sizeBytes: parseInt(size, 10) || 0,
      });
    }
    return files;
  }

  private createSingleFileTar(content: Buffer, filename: string): Buffer {
    const header = Buffer.alloc(512);
    const nameBuf = Buffer.from(filename, 'utf-8');
    nameBuf.copy(header, 0, 0, Math.min(nameBuf.length, 100));
    const sizeStr = content.length.toString(8).padStart(11, '0');
    header.write(sizeStr, 124, 11, 'ascii');
    header[156] = 0x30; // Regular file
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i]!;
    header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
    header[154] = 0x20;

    const paddedLen = Math.ceil(content.length / 512) * 512;
    const padded = Buffer.alloc(paddedLen);
    content.copy(padded);

    const end = Buffer.alloc(1024);
    return Buffer.concat([header, padded, end]);
  }

  private execInContainer(
    container: Docker.Container,
    cmd: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      container.exec(
        {
          Cmd: cmd,
          AttachStdout: true,
          AttachStderr: true,
        },
        (err, exec) => {
          if (err) return reject(err);
          if (!exec) return reject(new Error('Failed to create exec'));

          exec.start({ Detach: false, Tty: false }, (startErr, stream) => {
            if (startErr) return reject(startErr);
            if (!stream) return reject(new Error('Failed to start exec'));

            const stdoutBuf: Buffer[] = [];
            const stderrBuf: Buffer[] = [];

            stream.on('data', (chunk: Buffer) => {
              for (let i = 0; i < chunk.length; ) {
                const streamType = chunk[i];
                if (streamType === undefined) break;
                const len =
                  ((chunk[i + 4] ?? 0) << 24) |
                  ((chunk[i + 5] ?? 0) << 16) |
                  ((chunk[i + 6] ?? 0) << 8) |
                  (chunk[i + 7] ?? 0);
                const payload = chunk.subarray(i + 8, i + 8 + len);
                if (streamType === 1) stdoutBuf.push(payload);
                else if (streamType === 2) stderrBuf.push(payload);
                i += 8 + len;
              }
            });

            stream.on('end', () => {
              resolve({
                stdout: Buffer.concat(stdoutBuf).toString(),
                stderr: Buffer.concat(stderrBuf).toString(),
              });
            });
            stream.on('error', reject);
          });
        },
      );
    });
  }
}
