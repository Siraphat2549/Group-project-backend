import { connect } from 'node:net';

export interface MysqlProbeResult {
  serverVersion: string;
}

const HANDSHAKE_V10 = 0x0a;
const ERR_PACKET = 0xff;

/**
 * Opens a TCP connection and reads the MySQL initial handshake packet.
 * MySQL sends this greeting before authentication, so a valid packet proves
 * the server is up and accepting connections from this host.
 *
 * Packet layout: [3-byte LE payload length][1-byte seq][payload...]
 */
export function probeMysql(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<MysqlProbeResult> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (error: Error | null, result?: MysqlProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result as MysqlProbeResult);
    };

    socket.setTimeout(timeoutMs, () =>
      finish(new Error(`timed out after ${timeoutMs}ms`)),
    );
    socket.once('error', (err) => finish(err));
    socket.once('close', () =>
      finish(new Error('connection closed before handshake')),
    );

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 5) return;

      const payloadLength = buffer.readUIntLE(0, 3);
      if (buffer.length < 4 + payloadLength) return;

      const marker = buffer[4];
      if (marker === HANDSHAKE_V10) {
        const versionEnd = buffer.indexOf(0x00, 5);
        const serverVersion = buffer.toString(
          'utf8',
          5,
          versionEnd === -1 ? 4 + payloadLength : versionEnd,
        );
        finish(null, { serverVersion });
      } else if (marker === ERR_PACKET) {
        // [0xff][2-byte error code][message]
        const message = buffer.toString('utf8', 7, 4 + payloadLength);
        finish(new Error(`server refused connection: ${message}`));
      } else {
        finish(new Error('unexpected handshake packet'));
      }
    });
  });
}
