import { connect as netConnect, Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export interface RedisProbeTarget {
  host: string;
  port: number;
  tls: boolean;
  username?: string;
  password?: string;
}

function encodeCommand(...args: string[]): string {
  return (
    `*${args.length}\r\n` +
    args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join('')
  );
}

/**
 * Sends (optional AUTH +) PING using the Redis wire protocol and expects
 * a `+PONG` reply. Any `-ERR` reply (e.g. wrong password) fails the probe.
 */
export function probeRedis(
  target: RedisProbeTarget,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const commands: string[] = [];
    if (target.password) {
      commands.push(
        target.username
          ? encodeCommand('AUTH', target.username, target.password)
          : encodeCommand('AUTH', target.password),
      );
    }
    commands.push(encodeCommand('PING'));

    const socket: Socket = target.tls
      ? tlsConnect({
          host: target.host,
          port: target.port,
          servername: target.host,
        })
      : netConnect({ host: target.host, port: target.port });

    let received = '';
    let settled = false;

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(timeoutMs, () =>
      finish(new Error(`timed out after ${timeoutMs}ms`)),
    );
    socket.once('error', (err) => finish(err));
    socket.once('close', () => finish(new Error('connection closed early')));
    socket.once(target.tls ? 'secureConnect' : 'connect', () =>
      socket.write(commands.join('')),
    );

    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8');
      // Only complete CRLF-terminated lines; the last element may be partial.
      const lines = received.split('\r\n').slice(0, -1);

      for (const line of lines) {
        if (line.startsWith('-')) {
          // Redis error replies never echo the password back.
          return finish(new Error(line.slice(1)));
        }
      }
      if (lines.length < commands.length) return;

      const last = lines[commands.length - 1];
      if (last === '+PONG') finish(null);
      else finish(new Error('unexpected PING reply'));
    });
  });
}
