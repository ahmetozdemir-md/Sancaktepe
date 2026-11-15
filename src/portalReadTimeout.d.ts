export function withPortalReadTimeout<T>(read: (signal: AbortSignal) => PromiseLike<T>, timeoutMs?: number): Promise<T>;
