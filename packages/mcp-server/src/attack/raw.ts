import { connect } from "node:net";

export type RawResponse = {
  status: number;
  headers: [string, string][];
  body: string;
  raw: string;
};

// Attack tests need to send what fetch() won't: a repeated header, a Host that
// isn't the address, a broken request line. This writes the bytes exactly as
// given over a plain socket and reads whatever comes back, however odd. It adds
// Content-Length and Connection: close unless the caller already set them, and
// never a Host: the caller chooses it, or leaves it out.
export function buildRequest(opts: {
  method?: string;
  path?: string;
  headers?: [string, string][];
  body?: string;
}): string {
  const headers = [...(opts.headers ?? [])];
  const has = (name: string) => headers.some(([n]) => n.toLowerCase() === name);
  const body = opts.body ?? "";
  if (!has("content-length") && body)
    headers.push(["Content-Length", String(Buffer.byteLength(body))]);
  if (!has("connection")) headers.push(["Connection", "close"]);
  const head = headers.map(([n, v]) => `${n}: ${v}`).join("\r\n");
  return `${opts.method ?? "POST"} ${opts.path ?? "/mcp"} HTTP/1.1\r\n${head}\r\n\r\n${body}`;
}

export function parseResponse(raw: string): RawResponse {
  const split = raw.indexOf("\r\n\r\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split + 4);
  const [statusLine = "", ...lines] = head.split("\r\n");
  const status = Number(/^HTTP\/\d\.\d (\d{3})/.exec(statusLine)?.[1] ?? 0);
  const headers = lines.map((l): [string, string] => {
    const i = l.indexOf(":");
    return [l.slice(0, i).toLowerCase(), l.slice(i + 1).trim()];
  });
  return { status, headers, body, raw };
}

// True once the head and as many body bytes as Content-Length promised have
// arrived, so a keep-alive reply does not make a test wait for the socket to idle.
function complete(raw: string): boolean {
  const split = raw.indexOf("\r\n\r\n");
  if (split === -1) return false;
  const length = /\r\ncontent-length: *(\d+)/i.exec(raw.slice(0, split))?.[1];
  return length !== undefined && raw.length - split - 4 >= Number(length);
}

// status 0 means the server sent nothing back before it closed or timed out.
export function rawHttp(
  port: number,
  request: string | Buffer,
  timeoutMs = 3000,
): Promise<RawResponse> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(parseResponse(Buffer.concat(chunks).toString("latin1")));
    };
    socket.setTimeout(timeoutMs, finish);
    socket.on("connect", () => socket.write(request));
    socket.on("data", (c) => {
      chunks.push(c);
      if (complete(Buffer.concat(chunks).toString("latin1"))) finish();
    });
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", finish);
  });
}
