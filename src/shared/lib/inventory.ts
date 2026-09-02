export class InventoryRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "InventoryRequestError";
  }
}

export async function postInventory(action: string, data: Record<string, unknown> = {}) {
  const response = await fetch("/api/inventory", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    available?: number;
    movementId?: number;
    id?: number;
    number?: string;
    adjustments?: number;
    warehouse?: { id?: number };
  };
  if (!response.ok || !body.ok) {
    throw new InventoryRequestError(body.error ?? "Не удалось выполнить складскую операцию", response.status);
  }
  return body;
}
