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

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
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
  if (!res.ok) {
    const e = data?.error ?? {};
    const details = e.details && typeof e.details === 'object' ? e.details : {};
    const fieldErrors = e.code === 'VALIDATION' || e.code === 'EMAIL_TAKEN' || e.code === 'BAD_CREDENTIALS' ? (details as Record<string, string>) : {};
    throw new ApiError(e.message ?? 'Não foi possível concluir a operação.', res.status, e.code, fieldErrors, details);
  }
  return data as T;
}

/** Downloads a generated file (PDF/XLSX) and saves it with the server-provided name. */
export async function download(path: string) {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.error?.message ?? 'Falha ao gerar o arquivo.', res.status, data?.error?.code);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'relatorio';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { name, size: blob.size };
}

export const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Erro inesperado.');
