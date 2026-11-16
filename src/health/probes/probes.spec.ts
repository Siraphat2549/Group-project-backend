import { AddressInfo, createServer, Server, Socket } from 'node:net';
import { probeMysql } from './mysql.probe';
import { probeRedis } from './redis.probe';

function listen(onConnection: (socket: Socket) => void): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(onConnection);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const portOf = (server: Server) => (server.address() as AddressInfo).port;
const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

function mysqlPacket(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3);
  header[3] = 0; // sequence id
  return Buffer.concat([header, payload]);
}

describe('probeMysql', () => {
  it('resolves with the server version from a v10 handshake', async () => {
    const server = await listen((socket) => {
      const payload = Buffer.concat([
        Buffer.from([0x0a]),
        Buffer.from('8.4.0\0', 'utf8'),
        Buffer.alloc(20),
      ]);
      // Split across two writes to exercise buffering.
      const packet = mysqlPacket(payload);
      socket.write(packet.subarray(0, 3));
      setTimeout(() => socket.write(packet.subarray(3)), 10);
    });
    await expect(
      probeMysql('127.0.0.1', portOf(server), 1000),
    ).resolves.toEqual({ serverVersion: '8.4.0' });
    await close(server);
  });

  it('rejects on an error packet', async () => {
    const server = await listen((socket) => {
      const payload = Buffer.concat([
        Buffer.from([0xff, 0x6a, 0x04]),
        Buffer.from("Host 'x' is not allowed", 'utf8'),
      ]);
      socket.end(mysqlPacket(payload));
    });
    await expect(probeMysql('127.0.0.1', portOf(server), 1000)).rejects.toThrow(
      /not allowed/,
    );
    await close(server);
  });

  it('times out when the server never speaks', async () => {
    const server = await listen(() => undefined);
    await expect(probeMysql('127.0.0.1', portOf(server), 200)).rejects.toThrow(
      /timed out/,
    );
    await close(server);
  });
});

describe('probeRedis', () => {
  function fakeRedis(password?: string) {
    return listen((socket) => {
      let buffered = '';
      socket.on('data', (chunk) => {
        buffered += chunk.toString();
        if (!buffered.includes('PING')) return;
        const replies: string[] = [];
        if (buffered.includes('AUTH')) {
          replies.push(
            password && buffered.includes(password)
              ? '+OK'
              : '-WRONGPASS invalid username-password pair',
          );
        }
        replies.push(
          password && !buffered.includes('AUTH')
            ? '-NOAUTH Authentication required.'
            : '+PONG',
        );
        socket.write(replies.map((r) => `${r}\r\n`).join(''));
      });
    });
  }

  it('resolves on +PONG', async () => {
    const server = await fakeRedis();
    await expect(
      probeRedis({ host: '127.0.0.1', port: portOf(server), tls: false }, 1000),
    ).resolves.toBeUndefined();
    await close(server);
  });

  it('authenticates before PING when a password is set', async () => {
    const server = await fakeRedis('pw');
    const target = { host: '127.0.0.1', port: portOf(server), tls: false };
    await expect(
      probeRedis({ ...target, password: 'pw' }, 1000),
    ).resolves.toBeUndefined();
    await expect(
      probeRedis({ ...target, password: 'nope' }, 1000),
    ).rejects.toThrow(/WRONGPASS/);
    await expect(probeRedis(target, 1000)).rejects.toThrow(/NOAUTH/);
    await close(server);
  });
});
