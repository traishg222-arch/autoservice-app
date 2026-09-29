// Единая обёртка над fetch: JSON, токен владельца, понятные ошибки.
export async function api(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('Нет соединения с сервером. Проверьте интернет.');
    err.offline = true;
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* пустой ответ */ }
  if (!res.ok) {
    const err = new Error(data?.error || 'Не удалось выполнить запрос');
    err.status = res.status;
    throw err;
  }
  return data;
}
