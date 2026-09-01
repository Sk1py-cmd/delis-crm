export class ManageRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ManageRequestError";
  }
}

export async function postManage(action: string, data: Record<string, unknown> = {}) {
  const res = await fetch("/api/manage", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    count?: number;
    id?: number;
    runs?: number;
    messages?: number;
    customers?: number;
    bonusGranted?: number;
  };
  if (!res.ok || json.error) throw new ManageRequestError(json.error ?? "Ошибка запроса", res.status);
  return json;
}
