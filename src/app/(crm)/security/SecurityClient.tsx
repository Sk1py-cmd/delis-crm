"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock3, Copy, KeyRound, Laptop, LogOut, RefreshCw, ShieldCheck, Smartphone, UsersRound } from "lucide-react";
import { Avatar, Badge, Card, Modal, PageHeader } from "@/shared/ui/kit";
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

type SecurityResponse = {
  error?: string;
  currentSessionRevoked?: boolean;
  revokedSessions?: number;
  qrCodeDataUrl?: string;
  manualKey?: string;
  expiresAt?: string;
  recoveryCodes?: string[];
};

type Enrollment = Required<Pick<SecurityResponse, "qrCodeDataUrl" | "manualKey" | "expiresAt">>;

async function readResponse(response: Response, fallback = "Не удалось выполнить операцию") {
  const body = (await response.json().catch(() => ({}))) as SecurityResponse;
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body;
}

export function SecurityClient({
  sessions,
  audit,
  twoFactorEnabled: initialTwoFactorEnabled,
}: {
  sessions: SecuritySession[];
  audit: SecurityAuditEvent[];
  twoFactorEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(initialTwoFactorEnabled);
  const [setupPasswordOpen, setSetupPasswordOpen] = useState(false);
  const [setupPassword, setSetupPassword] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [recoveryCodeOpen, setRecoveryCodeOpen] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

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

  const startTwoFactorEnrollment = async () => {
    if (!setupPassword) {
      toast("Подтвердите текущий пароль Owner", "err");
      return;
    }
    setBusyKey("start-two-factor");
    try {
      const result = await readResponse(
        await fetch("/api/security/two-factor", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: setupPassword }),
        }),
        "Не удалось начать настройку 2FA",
      );
      if (!result.qrCodeDataUrl || !result.manualKey || !result.expiresAt) {
        throw new Error("Сервер вернул неполные данные настройки 2FA");
      }
      setSetupPassword("");
      setSetupPasswordOpen(false);
      setEnrollment({
        qrCodeDataUrl: result.qrCodeDataUrl,
        manualKey: result.manualKey,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setSetupPassword("");
      setBusyKey(null);
    }
  };

  const cancelEnrollment = async () => {
    setBusyKey("cancel-two-factor");
    try {
      await readResponse(
        await fetch("/api/security/two-factor", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancelEnrollment" }),
        }),
        "Не удалось отменить настройку 2FA",
      );
      setEnrollment(null);
      setSetupCode("");
      toast("Настройка двухфакторной защиты отменена");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setBusyKey(null);
    }
  };

  const confirmEnrollment = async () => {
    if (!setupCode.trim()) {
      toast("Введите код из приложения-аутентификатора", "err");
      return;
    }
    setBusyKey("confirm-two-factor");
    try {
      const result = await readResponse(
        await fetch("/api/security/two-factor", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "confirmEnrollment", code: setupCode }),
        }),
        "Не удалось подтвердить двухфакторную защиту",
      );
      if (!result.recoveryCodes?.length) throw new Error("Сервер не выдал recovery-коды");
      setEnrollment(null);
      setSetupCode("");
      setTwoFactorEnabled(true);
      setBackupCodes(result.recoveryCodes);
      toast("Двухфакторная защита включена");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setSetupCode("");
      setBusyKey(null);
    }
  };

  const regenerateRecoveryCodes = async () => {
    if (!recoveryCode.trim()) {
      toast("Введите код из приложения или recovery-код", "err");
      return;
    }
    setBusyKey("regenerate-recovery-codes");
    try {
      const result = await readResponse(
        await fetch("/api/security/two-factor", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "regenerateRecoveryCodes", code: recoveryCode }),
        }),
        "Не удалось выпустить recovery-коды",
      );
      if (!result.recoveryCodes?.length) throw new Error("Сервер не выдал recovery-коды");
      setRecoveryCode("");
      setRecoveryCodeOpen(false);
      setBackupCodes(result.recoveryCodes);
      toast("Предыдущие recovery-коды отозваны и заменены");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setRecoveryCode("");
      setBusyKey(null);
    }
  };

  const turnOffTwoFactor = async () => {
    if (!disableCode.trim()) {
      toast("Введите код двухфакторной защиты", "err");
      return;
    }
    setBusyKey("disable-two-factor");
    try {
      await readResponse(
        await fetch("/api/security/two-factor", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "disable", code: disableCode }),
        }),
        "Не удалось отключить двухфакторную защиту",
      );
      setDisableCode("");
      setDisableOpen(false);
      setTwoFactorEnabled(false);
      toast("Двухфакторная защита отключена", "err");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setDisableCode("");
      setBusyKey(null);
    }
  };

  const copyText = async (value: string, successMessage: string) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API недоступен");
      await navigator.clipboard.writeText(value);
      toast(successMessage);
    } catch {
      toast("Не удалось скопировать. Сохраните данные вручную.", "err");
    }
  };

  const closeBackupCodes = () => {
    setBackupCodes(null);
    router.refresh();
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

      <Card className="mb-[var(--gap)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: "color-mix(in srgb, #8b5cf6 14%, transparent)" }}>
              <Smartphone size={19} color="#8b5cf6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold">Двухфакторная аутентификация Owner</h3>
                <Badge color={twoFactorEnabled ? "#22c55e" : "#f59e0b"}>{twoFactorEnabled ? "Включена" : "Не настроена"}</Badge>
              </div>
              <p className="text-sm muted mt-1">
                {twoFactorEnabled
                  ? "При каждом новом входе Owner подтверждает пароль одноразовым кодом TOTP или recovery-кодом."
                  : "Подключите Google Authenticator, Microsoft Authenticator, 1Password или другое TOTP-приложение."}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {twoFactorEnabled ? (
              <>
                <button className="btn" disabled={Boolean(busyKey)} onClick={() => { setRecoveryCode(""); setRecoveryCodeOpen(true); }}>
                  <KeyRound size={15} /> Новые recovery-коды
                </button>
                <button
                  className="btn"
                  disabled={Boolean(busyKey)}
                  style={{ color: "var(--error)", borderColor: "color-mix(in srgb, var(--error) 35%, transparent)" }}
                  onClick={() => { setDisableCode(""); setDisableOpen(true); }}
                >
                  Отключить 2FA
                </button>
              </>
            ) : (
              <button className="btn btn-primary" disabled={Boolean(busyKey)} onClick={() => { setSetupPassword(""); setSetupPasswordOpen(true); }}>
                <ShieldCheck size={15} /> Настроить TOTP
              </button>
            )}
          </div>
        </div>
      </Card>

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

      {setupPasswordOpen && (
        <Modal open onClose={() => { if (!busyKey) { setSetupPasswordOpen(false); setSetupPassword(""); } }} title="Подтвердите настройку 2FA">
          <div className="flex flex-col gap-3.5">
            <p className="text-sm muted">Для подключения нового приложения подтвердите текущий пароль Owner. Пароль не сохраняется в браузере или журнале.</p>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Текущий пароль Owner"
              value={setupPassword}
              onChange={(event) => setSetupPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void startTwoFactorEnrollment(); }}
              autoFocus
            />
            <button className="btn btn-primary justify-center" disabled={Boolean(busyKey)} onClick={() => void startTwoFactorEnrollment()}>
              {busyKey === "start-two-factor" ? "Подтверждаем…" : "Продолжить"}
            </button>
          </div>
        </Modal>
      )}

      {enrollment && (
        <Modal open onClose={() => { if (!busyKey) void cancelEnrollment(); }} title="Подключите приложение-аутентификатор">
          <div className="flex flex-col gap-4">
            <p className="text-sm muted">1. Отсканируйте QR-код в Google Authenticator, Microsoft Authenticator, 1Password или другом TOTP-приложении.</p>
            <div className="rounded-2xl p-3 self-center" style={{ background: "#fff" }}>
              <Image src={enrollment.qrCodeDataUrl} alt="QR-код для настройки TOTP" width={240} height={240} unoptimized priority />
            </div>
            <div className="rounded-2xl p-3" style={{ background: "color-mix(in srgb, var(--primary) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 24%, transparent)" }}>
              <div className="text-xs muted mb-1.5">Если QR-код недоступен, введите этот ключ вручную:</div>
              <div className="flex gap-2 items-center">
                <code className="text-xs break-all flex-1 font-mono">{enrollment.manualKey}</code>
                <button className="btn !px-2 !py-1 shrink-0" title="Скопировать ключ" onClick={() => void copyText(enrollment.manualKey, "Ключ настройки скопирован")}>
                  <Copy size={14} />
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">2. Введите код из приложения</label>
              <input
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-значный код"
                value={setupCode}
                onChange={(event) => setSetupCode(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void confirmEnrollment(); }}
              />
              <p className="text-xs muted mt-1.5">Настройка истекает {dt(enrollment.expiresAt)}. Не передавайте QR-код или ключ другим людям.</p>
            </div>
            <button className="btn btn-primary justify-center" disabled={Boolean(busyKey)} onClick={() => void confirmEnrollment()}>
              {busyKey === "confirm-two-factor" ? "Проверяем…" : "Включить двухфакторную защиту"}
            </button>
            <button className="btn justify-center" disabled={Boolean(busyKey)} onClick={() => void cancelEnrollment()}>
              Отменить настройку
            </button>
          </div>
        </Modal>
      )}

      {recoveryCodeOpen && (
        <Modal open onClose={() => { if (!busyKey) { setRecoveryCodeOpen(false); setRecoveryCode(""); } }} title="Новые recovery-коды">
          <div className="flex flex-col gap-3.5">
            <p className="text-sm muted">Подтвердите текущим TOTP-кодом или одним действующим recovery-кодом. Все прежние recovery-коды будут отозваны.</p>
            <input
              className="input"
              autoComplete="one-time-code"
              placeholder="Код из приложения или recovery-код"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void regenerateRecoveryCodes(); }}
              autoFocus
            />
            <button className="btn btn-primary justify-center" disabled={Boolean(busyKey)} onClick={() => void regenerateRecoveryCodes()}>
              {busyKey === "regenerate-recovery-codes" ? "Выпускаем…" : "Выпустить новые коды"}
            </button>
          </div>
        </Modal>
      )}

      {disableOpen && (
        <Modal open onClose={() => { if (!busyKey) { setDisableOpen(false); setDisableCode(""); } }} title="Отключить двухфакторную защиту">
          <div className="flex flex-col gap-3.5">
            <p className="text-sm" style={{ color: "var(--error)" }}>Защита Owner будет ослаблена. Подтвердите действие TOTP-кодом или recovery-кодом.</p>
            <input
              className="input"
              autoComplete="one-time-code"
              placeholder="Код из приложения или recovery-код"
              value={disableCode}
              onChange={(event) => setDisableCode(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void turnOffTwoFactor(); }}
              autoFocus
            />
            <button
              className="btn justify-center"
              disabled={Boolean(busyKey)}
              style={{ color: "var(--error)", borderColor: "color-mix(in srgb, var(--error) 35%, transparent)" }}
              onClick={() => void turnOffTwoFactor()}
            >
              {busyKey === "disable-two-factor" ? "Отключаем…" : "Подтвердить отключение"}
            </button>
          </div>
        </Modal>
      )}

      {backupCodes && (
        <Modal open onClose={closeBackupCodes} title="Сохраните recovery-коды">
          <div className="flex flex-col gap-4">
            <p className="text-sm" style={{ color: "var(--warning)" }}>Каждый код можно использовать один раз, если нет доступа к приложению. Они показаны только сейчас — сохраните их в защищённом менеджере паролей.</p>
            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((code) => (
                <code key={code} className="rounded-xl px-3 py-2 text-center font-mono text-sm" style={{ background: "color-mix(in srgb, var(--primary) 9%, transparent)" }}>{code}</code>
              ))}
            </div>
            <button className="btn btn-primary justify-center" onClick={() => void copyText(backupCodes.join("\n"), "Recovery-коды скопированы")}>
              <Copy size={15} /> Скопировать коды
            </button>
            <button className="btn justify-center" onClick={closeBackupCodes}>Я сохранил коды</button>
          </div>
        </Modal>
      )}
    </>
  );
}
