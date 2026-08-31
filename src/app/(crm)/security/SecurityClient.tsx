"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock3, Laptop, LogOut, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";
import { Avatar, Badge, Card, PageHeader } from "@/shared/ui/kit";
import { dt, ROLE_LABEL } from "@/shared/lib/format";
import { useToast } from "@/shared/ui/Toast";

export interface SecuritySession {
  id: number;
  userId: number;
  userName: string;
  login: string;
  role: string;
  status: string;
  device: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface SecurityAuditEvent {
  id: number;
  actor: string;
  action: string;
  entity: string;
  entityType: string;
  entityId: number | null;
  eventType: string;
  severity: string;
  ip: string;
  createdAt: string;
}

const severityMeta: Record<string, { label: string; color: string }> = {
  info: { label: "Информация", color: "#3b82f6" },
  warning: { label: "Внимание", color: "#f59e0b" },
  critical: { label: "Критично", color: "#ef4444" },
};

const roleColor: Record<string, string> = {
  owner: "#f59e0b",
  admin: "#8b5cf6",
  manager: "#3b82f6",
  warehouse: "#14b8a6",
  agent: "#22c55e",
  support: "#ec4899",
  moderator: "#0ea5e9",
  operator: "#a855f7",
};

async function readResponse(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: string; currentSessionRevoked?: boolean; revokedSessions?: number };
  if (!response.ok) throw new Error(body.error ?? "Не удалось завершить сессию");
  return body;
}

export function SecurityClient({ sessions, audit }: { sessions: SecuritySession[]; audit: SecurityAuditEvent[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const sessionsByUser = sessions.reduce<Record<number, number>>((counts, session) => {
    counts[session.userId] = (counts[session.userId] ?? 0) + 1;
    return counts;
  }, {});
  const activeUsers = Object.keys(sessionsByUser).length;
  const currentUserId = sessions.find((session) => session.isCurrent)?.userId;
  const criticalEvents = audit.filter((event) => event.severity === "critical").length;

  const revoke = async (
    key: string,
    body: Record<string, unknown>,
    confirmation: string,
    success: string,
  ) => {
    if (!window.confirm(confirmation)) return;
    setBusyKey(key);
    try {
      const result = await readResponse(
        await fetch("/api/security/sessions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      toast(result.revokedSessions !== undefined ? `${success}: ${result.revokedSessions}` : success);
      if (result.currentSessionRevoked) {
        window.location.assign("/");
        return;
      }
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Центр безопасности"
        subtitle="Owner-only контроль входов, активных устройств и критичных событий. Пароли и токены никогда не выводятся в журнал."
        actions={
          <div className="flex gap-2 flex-wrap">
            <button className="btn" disabled={Boolean(busyKey)} onClick={() => router.refresh()}>
              <RefreshCw size={15} /> Обновить
            </button>
            <button
              className="btn"
              disabled={Boolean(busyKey) || sessions.every((session) => session.role === "owner")}
              style={{ color: "var(--error)", borderColor: "color-mix(in srgb, var(--error) 35%, transparent)" }}
              onClick={() => void revoke(
                "all-employees",
                { mode: "allEmployees" },
                "Завершить все активные сессии сотрудников? Owner останется в системе.",
                "Сессии сотрудников завершены",
              )}
            >
              <AlertTriangle size={15} /> Завершить сессии сотрудников
            </button>
          </div>
        }
      />

      <div className="grid gap-[var(--gap)] md:grid-cols-3 mb-[var(--gap)]">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold">{sessions.length}</div>
              <div className="text-sm muted mt-1">Активных сессий</div>
            </div>
            <div className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "color-mix(in srgb, #3b82f6 14%, transparent)" }}>
              <Laptop size={19} color="#3b82f6" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold">{activeUsers}</div>
              <div className="text-sm muted mt-1">Пользователей с активной сессией</div>
            </div>
            <div className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "color-mix(in srgb, #22c55e 14%, transparent)" }}>
              <UsersRound size={19} color="#22c55e" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold">{criticalEvents}</div>
              <div className="text-sm muted mt-1">Критичных событий в журнале</div>
            </div>
            <div className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "color-mix(in srgb, #ef4444 14%, transparent)" }}>
              <ShieldCheck size={19} color="#ef4444" />
            </div>
          </div>
        </Card>
      </div>

      <Card hover={false} className="!p-0 mb-[var(--gap)]">
        <div className="card-pad flex items-start justify-between gap-4 pb-2">
          <div>
            <h3 className="font-semibold flex items-center gap-2"><Laptop size={16} color="var(--accent)" /> Активные устройства и сессии</h3>
            <p className="text-xs muted mt-1">Сессия завершается сразу: следующий запрос с этого устройства потребует входа.</p>
          </div>
          <Badge color="#3b82f6">{sessions.length} активных</Badge>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Устройство</th>
                <th>IP</th>
                <th className="hidden lg:table-cell">Начало</th>
                <th className="hidden xl:table-cell">Истекает</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const userSessions = sessionsByUser[session.userId] ?? 1;
                const singleKey = `session-${session.id}`;
                const userKey = `user-${session.userId}`;
                return (
                  <tr key={session.id}>
                    <td>
                      <div className="flex items-center gap-2.5 h-[var(--row)]">
                        <Avatar name={session.userName} color={roleColor[session.role] ?? "#64748b"} size={32} />
                        <div className="min-w-0">
                          <div className="text-[0.85rem] truncate max-w-[180px] flex items-center gap-1.5">
                            {session.userName}
                            {session.isCurrent && <Badge color="#22c55e">Это устройство</Badge>}
                          </div>
                          <div className="text-xs muted">@{session.login} · {ROLE_LABEL[session.role] ?? session.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-xs muted max-w-[250px] truncate">{session.device || "Браузер не определён"}</td>
                    <td className="text-xs font-mono whitespace-nowrap">{session.ip || "—"}</td>
                    <td className="text-xs muted whitespace-nowrap hidden lg:table-cell">{dt(session.createdAt)}</td>
                    <td className="text-xs muted whitespace-nowrap hidden xl:table-cell">{dt(session.expiresAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button
                          className="btn !px-2 !py-1"
                          disabled={Boolean(busyKey)}
                          title="Завершить эту сессию"
                          onClick={() => void revoke(
                            singleKey,
                            { mode: "session", sessionId: session.id },
                            `Завершить сессию пользователя ${session.userName}?`,
                            "Сессия завершена",
                          )}
                        >
                          <LogOut size={14} color="var(--error)" />
                        </button>
                        <button
                          className="btn !px-2 !py-1 text-xs"
                          disabled={Boolean(busyKey)}
                          title={session.userId === currentUserId ? "Завершить другие сессии этого пользователя" : "Завершить все сессии пользователя"}
                          onClick={() => void revoke(
                            userKey,
                            { mode: "user", userId: session.userId },
                            session.userId === currentUserId
                              ? "Завершить все остальные сессии вашего аккаунта? Текущая сессия останется активной."
                              : `Завершить все ${userSessions} сессии пользователя ${session.userName}?`,
                            "Сессии пользователя завершены",
                          )}
                        >
                          Все ({userSessions})
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sessions.length === 0 && (
                <tr><td colSpan={6} className="text-center muted py-8">Активных сессий нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card hover={false} className="!p-0">
        <div className="card-pad flex items-start justify-between gap-4 pb-2">
          <div>
            <h3 className="font-semibold flex items-center gap-2"><Clock3 size={16} color="var(--accent)" /> Расширенный журнал аудита</h3>
            <p className="text-xs muted mt-1">Последние {audit.length} событий: входы, действия с аккаунтами и завершения сессий.</p>
          </div>
          <Badge color="#8b5cf6">Защищённый журнал</Badge>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Уровень</th>
                <th>Событие</th>
                <th>Инициатор</th>
                <th>Объект</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((event) => {
                const meta = severityMeta[event.severity] ?? { label: event.severity || "Информация", color: "#64748b" };
                return (
                  <tr key={event.id}>
                    <td className="text-xs muted whitespace-nowrap">{dt(event.createdAt)}</td>
                    <td><Badge color={meta.color}>{meta.label}</Badge></td>
                    <td className="text-sm">{event.action}</td>
                    <td className="text-sm whitespace-nowrap">{event.actor}</td>
                    <td className="text-xs muted max-w-[250px] truncate">{event.entity || event.entityType || "—"}</td>
                    <td className="text-xs font-mono whitespace-nowrap">{event.ip || "—"}</td>
                  </tr>
                );
              })}
              {audit.length === 0 && (
                <tr><td colSpan={6} className="text-center muted py-8">Событий пока нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
