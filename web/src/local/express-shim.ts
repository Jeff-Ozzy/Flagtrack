/**
 * Minimal Express-compatible router so the API route modules from server/ run
 * unchanged in the browser (offline mode). Supports get/post/put/delete/use,
 * path params, nested routers and error propagation through next(err).
 */

export interface ShimRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  userId: string;
}

export interface ShimResponse {
  statusCode: number;
  status(code: number): ShimResponse;
  json(data: unknown): void;
  send(data: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
}

type Next = (err?: unknown) => void;
type Handler = (req: ShimRequest, res: ShimResponse, next: Next) => unknown;
type Layer = { method: string | null; path: string; handlers: (Handler | RouterShim)[] };

function compile(path: string, prefix: boolean) {
  const names: string[] = [];
  const src = path
    .replace(/\/$/, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, (_m, n) => {
      names.push(n);
      return '([^/]+)';
    });
  const re = new RegExp(`^${src}${prefix ? '(?=/|$)' : '/?$'}`);
  return (p: string) => {
    const m = re.exec(p);
    if (!m) return null;
    return { params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])), matched: m[0] };
  };
}

export class RouterShim {
  stack: Layer[] = [];
  private add(method: string | null, path: string, handlers: (Handler | RouterShim)[]) {
    this.stack.push({ method, path, handlers });
    return this;
  }
  get(path: string, ...h: Handler[]) { return this.add('GET', path, h); }
  post(path: string, ...h: Handler[]) { return this.add('POST', path, h); }
  put(path: string, ...h: Handler[]) { return this.add('PUT', path, h); }
  delete(path: string, ...h: Handler[]) { return this.add('DELETE', path, h); }
  use(pathOrHandler: string | Handler | RouterShim, ...h: (Handler | RouterShim)[]) {
    return typeof pathOrHandler === 'string' ? this.add(null, pathOrHandler, h) : this.add(null, '/', [pathOrHandler, ...h]);
  }

  /** Runs the request through this router; `done` is called when nothing handled it or on error. */
  handle(req: ShimRequest, res: ShimResponse, path: string, done: Next) {
    let i = 0;
    const nextLayer = (err?: unknown): void => {
      if (err) return done(err);
      const layer = this.stack[i++];
      if (!layer) return done();
      if (layer.method && layer.method !== req.method) return nextLayer();
      const m = compile(layer.path, layer.method === null)(path || '/');
      if (!m) return nextLayer();
      req.params = { ...req.params, ...m.params };
      const rest = layer.method === null ? path.slice(m.matched.length) || '/' : path;
      let j = 0;
      const nextHandler = (e?: unknown): void => {
        if (e) return done(e);
        const h = layer.handlers[j++];
        if (!h) return nextLayer();
        if (h instanceof RouterShim) return h.handle(req, res, rest, nextHandler);
        try {
          const r = h(req, res, nextHandler);
          if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(nextHandler);
        } catch (ex) {
          nextHandler(ex);
        }
      };
      nextHandler();
    };
    nextLayer();
  }
}

export function Router() {
  return new RouterShim();
}

const passthrough = () => (_req: ShimRequest, _res: ShimResponse, next: Next) => next();
const express = Object.assign(() => new RouterShim(), { Router, raw: passthrough, json: passthrough, static: passthrough });
export default express;
