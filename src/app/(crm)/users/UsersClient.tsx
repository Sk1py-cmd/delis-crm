"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { Ban, KeyRound, ShieldCheck, Trash2, Unlock, UserCog, UserPlus } from "lucide-react";
import { Card, Badge, Avatar, Modal, PageHeader } from "@/shared/ui/kit";
import { ROLE_LABEL, dt } from "@/shared/lib/format";
import { STAFF_ROLES } from "@/shared/config/access";
import { useToast } from "@/shared/ui/Toast";
import { postManage } from "@/shared/lib/manage";
import { useT } from "@/shared/i18n/useT";

export interface UserLite {
  id: number;
  name: string;
  login: string;
  email: string;
  role: string;
  status: string;
  agentId: number | null;
  lastIp: string;
  device: string;
  lastLoginAt: string;
}

export interface AgentProfileLite {
  id: number;
  name: string;
  region: string;
  email: string;
}

const ROLE_COLOR: Record<string, string> = {
  owner: "#f59e0b",
  admin: "#8b5cf6",
  manager: "#3b82f6",
  warehouse: "#14b8a6",
  agent: "#22c55e",
  support: "#ec4899",
  moderator: "#0ea5e9",
  operator: "#a855f7",
};

const EMPTY_FORM = { name: "", login: "", email: "", role: "manager", password: "", agentId: "" };

type InviteForm = typeof EMPTY_FORM;

export function UsersClient({
  users,
  currentRole,
  audit,
  agents,
}: {
  users: UserLite[];
  currentRole: string;
  audit: { id: number; actor: string; action: string; entity: string; createdAt: string }[];
  agents: AgentProfileLite[];
}) {
  const canManage = currentRole === "owner";
  const [invite, setInvite] = useState(false);
  const [pwFor, setPwFor] = useState<UserLite | null>(null);
  const [roleFor, setRoleFor] = useState<UserLite | null>(null);
  const [form, setForm] = useState<InviteForm>(EMPTY_FORM);
  const [pw, setPw] = useState("");
  const [newRole, setNewRole] = useState("manager");
  const [newAgentId, setNewAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const tr = useT();
  const router = useRouter();

  const inviteUser = async () => {
    if (!form.name.trim() || !form.login.trim() || !form.password) {
      toast("Заполните имя, логин и пароль", "err");
      return;
    }
    if (form.password.length < 10) {
      toast("Пароль должен содержать не менее 10 символов", "err");
      return;
    }
    if (form.role === "agent" && !form.agentId) {
      toast("Для Agent выберите профиль агента", "err");
      return;
    }
    setBusy(true);
    try {
      await postManage("createUser", {
        ...form,
        agentId: form.role === "agent" ? Number(form.agentId) : undefined,
      });
      toast(`Аккаунт @${form.login.trim()} создан — сотрудник может войти`);
      setInvite(false);
      setForm(EMPTY_FORM);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  const resetPw = async () => {
    if (!pwFor) return;
    if (pw.length < 10) {
      toast("Пароль должен содержать не менее 10 символов", "err");
      return;
    }
    setBusy(true);
    try {
      await postManage("resetPassword", { id: pwFor.id, password: pw });
      toast(`Пароль для ${pwFor.name} обновлён. Все активные сессии сотрудника завершены.`);
      setPwFor(null);
      setPw("");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  const openRoleEditor = (user: UserLite) => {
    setRoleFor(user);
    setNewRole(user.role);
    setNewAgentId(user.agentId ? String(user.agentId) : "");
  };

  const saveRole = async () => {
    if (!roleFor) return;
    if (newRole === "agent" && !newAgentId) {
      toast("Для Agent выберите профиль агента", "err");
      return;
    }
    setBusy(true);
    try {
      await postManage("updateUserRole", {
        id: roleFor.id,
        role: newRole,
        agentId: newRole === "agent" ? Number(newAgentId) : undefined,
      });
      toast(`Роль ${roleFor.name} обновлена. Активные сессии сотрудника завершены.`);
      setRoleFor(null);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: string, data: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      await postManage(action, data);
      toast(message);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={tr("users.title")}
        subtitle="Только Owner создаёт сотрудников, назначает роли, блокирует доступ и сбрасывает пароли."
        actions={
          canManage ? (
            <button className="btn btn-primary" onClick={() => setInvite(true)}>
              <UserPlus size={15} /> {tr("users.createAccount")}
            </button>
          ) : (
            <Badge color="#f97316">Управление аккаунтами доступно только Owner</Badge>
          )
        }
      />

      <div className="grid gap-[var(--gap)] xl:grid-cols-3">
        <Card hover={false} className="xl:col-span-2 !p-0">
          <h3 className="font-semibold card-pad pb-2">Сотрудники ({users.length})</h3>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>{tr("users.employees")}</th>
                  <th>{tr("users.role")}</th>
                  <th>Статус</th>
                  <th className="hidden lg:table-cell">{tr("users.device")}</th>
                  <th>{tr("users.lastLogin")}</th>
                  {canManage && <th aria-label="Действия" />}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const blocked = user.status === "blocked";
                  return (
                    <tr key={user.id} className={blocked ? "opacity-60" : undefined}>
                      <td>
                        <div className="flex items-center gap-2.5 h-[var(--row)]">
                          <Avatar name={user.name} color={ROLE_COLOR[user.role] ?? "#64748b"} size={32} />
                          <div className="min-w-0">
                            <div className="text-[0.85rem] truncate max-w-[180px]">{user.name}</div>
                            <div className="text-xs muted truncate max-w-[180px]">
                              @{user.login || "—"}{user.email ? ` · ${user.email}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge color={ROLE_COLOR[user.role] ?? "#64748b"}>{ROLE_LABEL[user.role] ?? user.role}</Badge>
                      </td>
                      <td>
                        <Badge color={blocked ? "#ef4444" : "#22c55e"}>{blocked ? "Заблокирован" : "Активен"}</Badge>
                      </td>
                      <td className="muted text-xs hidden lg:table-cell max-w-[160px] truncate">{user.device || "—"}</td>
                      <td className="muted whitespace-nowrap text-xs">{dt(user.lastLoginAt)}</td>
                      {canManage && (
                        <td>
                          <div className="flex gap-1 justify-end">
                            <button className="btn !px-2 !py-1" title="Сбросить пароль" onClick={() => { setPwFor(user); setPw(""); }}>
                              <KeyRound size={13} />
                            </button>
                            {user.role !== "owner" && (
                              <>
                                <button className="btn !px-2 !py-1" title="Назначить роль" onClick={() => openRoleEditor(user)}>
                                  <UserCog size={13} />
                                </button>
                                <button
                                  className="btn !px-2 !py-1"
                                  title={blocked ? "Разблокировать" : "Заблокировать"}
                                  onClick={() => act("setUserStatus", { id: user.id, status: blocked ? "active" : "blocked" }, blocked ? `Аккаунт ${user.name} разблокирован` : `Аккаунт ${user.name} заблокирован`)}
                                >
                                  {blocked ? <Unlock size={13} color="#22c55e" /> : <Ban size={13} color="#f59e0b" />}
                                </button>
                                <button
                                  className="btn !px-2 !py-1"
                                  title="Удалить"
                                  onClick={() => {
                                    if (window.confirm(`Удалить аккаунт ${user.name}? Это действие нельзя отменить.`)) {
                                      void act("deleteUser", { id: user.id }, `Аккаунт ${user.name} удалён`);
                                    }
                                  }}
                                >
                                  <Trash2 size={13} color="var(--error)" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <ShieldCheck size={16} color="var(--success)" /> Audit Log
          </h3>
          <div className="flex flex-col gap-3 max-h-[420px] overflow-y-auto">
            {audit.map((entry) => (
              <div key={entry.id} className="flex gap-3">
                <Avatar name={entry.actor} color="var(--accent)" size={30} />
                <div className="min-w-0">
                  <div className="text-[0.8rem]">
                    <b>{entry.actor}</b> <span className="muted">{entry.action}</span>
                  </div>
                  <div className="text-xs muted truncate">
                    {entry.entity} · {dt(entry.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="font-semibold flex items-center gap-2">
          <ShieldCheck size={16} color="var(--success)" /> Серверная модель прав
        </h3>
        <p className="text-sm muted mt-2">
          Права ролей задаются централизованно на сервере и проверяются для страниц и API. Их нельзя изменить переключателями в браузере.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Badge color={ROLE_COLOR.owner}>Owner: полный доступ и управление аккаунтами</Badge>
          {STAFF_ROLES.map((role) => (
            <Badge key={role} color={ROLE_COLOR[role]}>{ROLE_LABEL[role] ?? role}</Badge>
          ))}
        </div>
      </Card>

      <AnimatePresence>
        {invite && (
          <Modal open onClose={() => setInvite(false)} title="Новый аккаунт сотрудника">
            <div className="flex flex-col gap-3.5">
              <input className="input" placeholder="Имя и фамилия" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 muted text-sm">@</span>
                <input className="input !pl-9" placeholder="Логин для входа (например: aziza)" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
              </div>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, agentId: e.target.value === "agent" ? form.agentId : "" })}>
                {STAFF_ROLES.map((role) => (
                  <option key={role} value={role}>{ROLE_LABEL[role] ?? role}</option>
                ))}
              </select>
              {form.role === "agent" && (
                <select className="input" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
                  <option value="">Выберите профиль агента</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.region}</option>)}
                </select>
              )}
              <input className="input" type="password" autoComplete="new-password" placeholder="Стартовый пароль (минимум 10 символов)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <input className="input" type="email" placeholder="Email (необязательно)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <button className="btn btn-primary justify-center" disabled={busy} onClick={inviteUser}>
                {busy ? "Создаём…" : "Создать аккаунт"}
              </button>
              <p className="text-xs muted text-center">Owner выдаёт стартовый пароль и при необходимости сбрасывает его. Сотрудник не может изменить пароль сам.</p>
            </div>
          </Modal>
        )}

        {roleFor && (
          <Modal open onClose={() => setRoleFor(null)} title={`Роль сотрудника: ${roleFor.name}`}>
            <div className="flex flex-col gap-3.5">
              <select className="input" value={newRole} onChange={(e) => { setNewRole(e.target.value); if (e.target.value !== "agent") setNewAgentId(""); }}>
                {STAFF_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role] ?? role}</option>)}
              </select>
              {newRole === "agent" && (
                <select className="input" value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)}>
                  <option value="">Выберите профиль агента</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.region}</option>)}
                </select>
              )}
              <button className="btn btn-primary justify-center" disabled={busy} onClick={saveRole}>
                {busy ? "Сохраняем…" : "Сохранить роль"}
              </button>
            </div>
          </Modal>
        )}

        {pwFor && (
          <Modal open onClose={() => setPwFor(null)} title={`Сброс пароля: ${pwFor.name}`}>
            <div className="flex flex-col gap-3.5">
              <input className="input" type="password" autoComplete="new-password" placeholder="Новый пароль (минимум 10 символов)" value={pw} onChange={(e) => setPw(e.target.value)} />
              <p className="text-xs muted">После сброса все активные сессии этого сотрудника будут завершены.</p>
              <button className="btn btn-primary justify-center" disabled={busy} onClick={resetPw}>
                {busy ? "Сохраняем…" : "Сбросить пароль"}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}
