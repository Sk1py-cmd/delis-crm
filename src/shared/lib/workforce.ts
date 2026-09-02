export async function postWorkforce(action: string, data: Record<string, unknown> = {}) {
  const response = await fetch("/api/workforce", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; id?: number; status?: string };
  if (!response.ok || !body.ok) throw new Error(body.error ?? "Не удалось выполнить операцию команды");
  return body;
}
