/** Bound the whole read, including any wait for the auth client's session lock. */
export async function withPortalReadTimeout(read, timeoutMs = 15_000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Liste bağlantısı zaman aşımına uğradı. Bağlantını kontrol edip yeniden dene.'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => read(controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
