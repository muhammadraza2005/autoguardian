import { runtime } from '@/config/runtime';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  accessToken: string;
  body?: unknown;
  signal?: AbortSignal;
  idempotencyKey?: string;
};

export type AuthenticatedRequest = <T>(path: string, options?: Omit<ApiOptions, 'accessToken'>) => Promise<T>;

// Supply a current verified session token at call time. No token logging or storage here.
export async function apiRequest<T>(path: string, options: ApiOptions): Promise<T> {
  if (runtime.isDemo) throw new Error('Live API calls are disabled in design preview.');
  if (!runtime.apiBaseUrl || !options.accessToken) throw new Error('API configuration and a verified session are required.');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || path.includes('\\')) {
    throw new Error('Use a relative API path.');
  }
  const url = new URL(runtime.apiBaseUrl.replace(/\/$/, '') + path);
  const developmentLoopback = runtime.developmentEmailAuth && url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname);
  if (url.protocol !== 'https:' && !developmentLoopback) throw new Error('The live API must use HTTPS.');
  const response = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    signal: options.signal,
    headers: {
      Authorization: 'Bearer ' + options.accessToken,
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  // Do not put a raw server response (possibly containing PII) into a UI error.
  if (!response.ok) throw new ApiError(response.status, 'The request could not be completed.');
  return (response.status === 204 ? undefined : await response.json()) as T;
}
