export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
  delayMs = 2000
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        console.warn(`[retry] ${label} 第 ${attempt}/${maxAttempts} 次失敗：${String(err)}`);
        console.warn(`[retry] ${delayMs / 1000}s 後重試...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  console.error(`[retry] ${label} 已達最大重試次數 (${maxAttempts})，放棄`);
  throw lastErr;
}
