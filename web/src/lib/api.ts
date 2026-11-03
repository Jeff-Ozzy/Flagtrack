export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public fieldErrors: Record<string, string> = {},
    public details?: unknown,
  ) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; raw?: Blob | ArrayBuffer; contentType?: string };

/** Offline build: data lives on the device and the API runs inside the app. */
export const IS_LOCAL = import.meta.env.VITE_LOCAL === 'true';

function toApiError(status: number, data: any): ApiError {
  const e = data?.error ?? {};
  const details = e.details && typeof e.details === 'object' ? e.details : {};
  const fieldErrors = e.code === 'VALIDATION' || e.code === 'EMAIL_TAKEN' || e.code === 'BAD_CREDENTIALS' ? (details as Record<string, string>) : {};
  return new ApiError(e.message ?? 'Não foi possível concluir a operação.', status, e.code, fieldErrors, details);
}

async function localApi<T>(path: string, opts: Opts): Promise<T> {
  const { localRequest } = await import('../local/backend');
  const method = opts.method ?? (opts.body !== undefined || opts.raw ? 'POST' : 'GET');
  const raw = opts.raw instanceof ArrayBuffer ? new Blob([opts.raw], { type: opts.contentType }) : opts.raw;
  const r = await localRequest(method, path, raw ?? opts.body);
  if (r.status >= 400) throw toApiError(r.status, r.data);
  return r.data as T;
}

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  if (IS_LOCAL) return localApi<T>(path, opts);
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers['Content-Type'] = opts.contentType ?? 'application/octet-stream';
    body = opts.raw;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'include' });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique sua internet — nada foi perdido.', 0, 'NETWORK');
  }
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('ft:unauthorized'));
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw toApiError(res.status, data);
  return data as T;
}

/** Saves a generated file: browser download, or Android share sheet inside the APK. */
export async function saveBlob(blob: Blob, name: string) {
  const { IS_NATIVE, nativeSaveFile } = await import('./native');
  if (IS_NATIVE) return nativeSaveFile(blob, name);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Downloads a generated report (PDF/XLSX) using the server-provided file name. */
export async function download(path: string) {
  if (IS_LOCAL) {
    // Reports are generated on the device.
    const m = /^\/reports\/(pdf|xlsx)\?(.*)$/.exec(path);
    if (!m) throw new ApiError('Download indisponível.', 404);
    const { localReport } = await import('../local/backend');
    try {
      const { blob, name } = await localReport(m[1] as 'pdf' | 'xlsx', m[2]);
      await saveBlob(blob, name);
      return { name, size: blob.size };
    } catch (e) {
      throw e instanceof Error ? new ApiError(e.message, (e as { status?: number }).status ?? 500) : e;
    }
  }
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.error?.message ?? 'Falha ao gerar o arquivo.', res.status, data?.error?.code);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'relatorio';
  await saveBlob(blob, name);
  return { name, size: blob.size };
}

export const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Erro inesperado.');
