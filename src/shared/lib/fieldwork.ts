export class FieldworkRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "FieldworkRequestError";
  }
}

export async function postFieldwork(action: string, data: Record<string, unknown> = {}) {
  const response = await fetch("/api/fieldwork", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    id?: number;
    status?: string;
    duplicate?: boolean;
  };
  if (!response.ok || !body.ok) throw new FieldworkRequestError(body.error ?? "Не удалось выполнить полевую операцию", response.status);
  return body;
}
