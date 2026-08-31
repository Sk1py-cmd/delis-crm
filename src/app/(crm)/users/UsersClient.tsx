"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import {
  Ban,
  Briefcase,
  CheckSquare,
  KeyRound,
  Pencil,
  Phone,
  ShieldCheck,
  Target,
  Trash2,
  Unlock,
  UserCog,
  UserPlus,
} from "lucide-react";
import { Avatar, Badge, Card, Modal, PageHeader } from "@/shared/ui/kit";
import { ROLE_LABEL, dt } from "@/shared/lib/format";
import { STAFF_ROLES } from "@/shared/config/access";
import { useToast } from "@/shared/ui/Toast";
import { postManage } from "@/shared/lib/manage";
import { postWorkforce } from "@/shared/lib/workforce";
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
  profile: {
    position: string;
    department: string;
    phone: string;
    hireDate: string | null;
    notes: string;
    avatarColor: string;
  } | null;
  taskStats: { total: number; done: number; open: number };
  pendingApprovals: number;
  kpiCompletion: number | null;
  kpiCount: number;
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

const PROFILE_COLORS = ["#8b5cf6", "#3b82f6", "#14b8a6", "#22c55e", "#f97316", "#ec4899", "#64748b"];
const EMPTY_FORM = { name: "", login: "", email: "", role: "manager", password: "", agentId: "" };
const EMPTY_PROFILE = { position: "", department: "", phone: "", hireDate: "", notes: "", avatarColor: "#64748b" };

type InviteForm = typeof EMPTY_FORM;
type ProfileForm = typeof EMPTY_PROFILE;

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
  const [profileFor, setProfileFor] = useState<UserLite | null>(null);
  const [form, setForm] = useState<InviteForm>(EMPTY_FORM);
  const [profileForm, setProfileForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [pw, setPw] = useState("");
  const [newRole, setNewRole] = useState("manager");
  const [newAgentId, setNewAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const tr = useT();
  const router = useRouter();

  const closeInvite = () => {
    if (busy) return;
    setInvite(false);
    setForm(EMPTY_FORM);
  };

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
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setForm((current) => ({ ...current, password: "" }));
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
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setPw("");
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
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  const openProfile = (user: UserLite) => {
    setProfileFor(user);
    setProfileForm({
      position: user.profile?.position ?? "",
      department: user.profile?.department ?? "",
      phone: user.profile?.phone ?? "",
      hireDate: user.profile?.hireDate ?? "",
      notes: user.profile?.notes ?? "",
      avatarColor: user.profile?.avatarColor ?? ROLE_COLOR[user.role] ?? "#64748b",
    });
  };

  const saveProfile = async () => {
    if (!profileFor) return;
    setBusy(true);
    try {
      await postWorkforce("saveEmployeeProfile", { userId: profileFor.id, ...profileForm });
      toast(`Карточка ${profileFor.name} обновлена`);
      setProfileFor(null);
      setProfileForm(EMPTY_PROFILE);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
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
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={tr("users.title")}
        subtitle="Карточки команды, назначение ролей, KPI и рабочая нагрузка. Учётными данными управляет только Owner."
        actions={
          canManage ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => { setForm(EMPTY_FORM); setInvite(true); }}>
              <UserPlus size={15} /> {tr("users.createAccount")}
            </button>
          ) : (
            <Badge color="#f97316">Управление аккаунтами доступно только Owner</Badge>
          )
        }
      />

      <Card hover={false} className="mb-[var(--gap)]">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2"><Briefcase size={17} color="var(--accent)" /> Карточки сотрудников</h3>
            <p className="text-xs muted mt-1">Роль, подразделение, нагрузка, KPI текущего месяца и ожидающие согласования.</p>
          </div>
          <Badge color="#8b5cf6">{users.length} в команде</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {users.map((user) => {
            const color = user.profile?.avatarColor ?? ROLE_COLOR[user.role] ?? "#64748b";
            const blocked = user.status === "blocked";
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => canManage && openProfile(user)}
                className={`text-left rounded-2xl p-3.5 transition-transform ${canManage ? "hover:-translate-y-0.5" : "cursor-default"} ${blocked ? "opacity-60" : ""}`}
                style={{ background: "rgba(var(--table-row))", border: "1px solid rgba(var(--border))" }}
                title={canManage ? "Открыть карточку сотрудника" : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={user.name} color={color} size={36} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{user.name}</div>
                      <div className="text-xs muted truncate">{user.profile?.position || ROLE_LABEL[user.role] || user.role}</div>
                    </div>
                  </div>
                  <Badge color={blocked ? "#ef4444" : color}>{blocked ? "Блок" : ROLE_LABEL[user.role] ?? user.role}</Badge>
                </div>
                <div className="text-xs muted mt-3 truncate">{user.profile?.department || "Подразделение не указано"}</div>
                <div className="grid grid-cols-3 gap-1.5 mt-3 text-center">
                  <div className="rounded-xl py-2" style={{ background: "rgba(var(--surface),0.45)" }}>
                    <div className="text-sm font-semibold">{user.taskStats.open}</div>
                    <div className="text-[0.61rem] muted">В работе</div>
                  </div>
                  <div className="rounded-xl py-2" style={{ background: "rgba(var(--surface),0.45)" }}>
                    <div className="text-sm font-semibold" style={{ color: user.kpiCompletion === null ? "var(--muted)" : user.kpiCompletion >= 100 ? "var(--success)" : "var(--primary)" }}>
                      {user.kpiCompletion === null ? "—" : `${user.kpiCompletion}%`}
                    </div>
                    <div className="text-[0.61rem] muted">KPI</div>
                  </div>
                  <div className="rounded-xl py-2" style={{ background: "rgba(var(--surface),0.45)" }}>
                    <div className="text-sm font-semibold" style={{ color: user.pendingApprovals ? "var(--warning)" : "inherit" }}>{user.pendingApprovals}</div>
                    <div className="text-[0.61rem] muted">Запросы</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-[var(--gap)] xl:grid-cols-3">
        <Card hover={false} className="xl:col-span-2 !p-0">
          <h3 className="font-semibold card-pad pb-2">Сотрудники ({users.length})</h3>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>{tr("users.employees")}</th>
                  <th>{tr("users.role")}</th>
                  <th>Нагрузка</th>
                  <th>Статус</th>
                  <th className="hidden lg:table-cell">{tr("users.device")}</th>
                  <th>{tr("users.lastLogin")}</th>
                  {canManage && <th aria-label="Действия" />}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const blocked = user.status === "blocked";
                  const color = user.profile?.avatarColor ?? ROLE_COLOR[user.role] ?? "#64748b";
                  return (
                    <tr key={user.id} className={blocked ? "opacity-60" : undefined}>
                      <td>
                        <div className="flex items-center gap-2.5 h-[var(--row)]">
                          <Avatar name={user.name} color={color} size={32} />
                          <div className="min-w-0">
                            <div className="text-[0.85rem] truncate max-w-[180px]">{user.name}</div>
                            <div className="text-xs muted truncate max-w-[180px]">@{user.login || "—"}{user.profile?.department ? ` · ${user.profile.department}` : ""}</div>
                          </div>
                        </div>
                      </td>
                      <td><Badge color={ROLE_COLOR[user.role] ?? "#64748b"}>{ROLE_LABEL[user.role] ?? user.role}</Badge></td>
                      <td className="text-xs whitespace-nowrap"><b>{user.taskStats.open}</b><span className="muted"> открыто · </span><b>{user.taskStats.done}</b><span className="muted"> готово</span></td>
                      <td><Badge color={blocked ? "#ef4444" : "#22c55e"}>{blocked ? "Заблокирован" : "Активен"}</Badge></td>
                      <td className="muted text-xs hidden lg:table-cell max-w-[160px] truncate">{user.device || "—"}</td>
                      <td className="muted whitespace-nowrap text-xs">{dt(user.lastLoginAt)}</td>
                      {canManage && (
                        <td>
                          <div className="flex gap-1 justify-end">
                            <button className="btn !px-2 !py-1" disabled={busy} title="Карточка сотрудника" onClick={() => openProfile(user)}><Pencil size={13} /></button>
                            <button className="btn !px-2 !py-1" disabled={busy} title="Сбросить пароль" onClick={() => { setPwFor(user); setPw(""); }}><KeyRound size={13} /></button>
                            {user.role !== "owner" && (
                              <>
                                <button className="btn !px-2 !py-1" disabled={busy} title="Назначить роль" onClick={() => openRoleEditor(user)}><UserCog size={13} /></button>
                                <button
                                  className="btn !px-2 !py-1"
                                  disabled={busy}
                                  title={blocked ? "Разблокировать" : "Заблокировать"}
                                  onClick={() => void act("setUserStatus", { id: user.id, status: blocked ? "active" : "blocked" }, blocked ? `Аккаунт ${user.name} разблокирован` : `Аккаунт ${user.name} заблокирован`)}
                                >
                                  {blocked ? <Unlock size={13} color="#22c55e" /> : <Ban size={13} color="#f59e0b" />}
                                </button>
                                <button
                                  className="btn !px-2 !py-1"
                                  disabled={busy}
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
          <h3 className="font-semibold mb-3 flex items-center gap-2"><ShieldCheck size={16} color="var(--success)" /> Audit Log</h3>
          <div className="flex flex-col gap-3 max-h-[420px] overflow-y-auto">
            {audit.map((entry) => (
              <div key={entry.id} className="flex gap-3">
                <Avatar name={entry.actor} color="var(--accent)" size={30} />
                <div className="min-w-0">
                  <div className="text-[0.8rem]"><b>{entry.actor}</b> <span className="muted">{entry.action}</span></div>
                  <div className="text-xs muted truncate">{entry.entity} · {dt(entry.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="font-semibold flex items-center gap-2"><ShieldCheck size={16} color="var(--success)" /> Серверная модель прав</h3>
        <p className="text-sm muted mt-2">Роли и права проверяются на сервере. Только Owner управляет аккаунтами и карточками сотрудников; задачи, KPI и согласования дополнительно проверяют владельца записи.</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Badge color={ROLE_COLOR.owner}>Owner: аккаунты и карточки команды</Badge>
          {STAFF_ROLES.map((role) => <Badge key={role} color={ROLE_COLOR[role]}>{ROLE_LABEL[role] ?? role}</Badge>)}
        </div>
      </Card>

      <AnimatePresence>
        {invite && (
          <Modal open onClose={closeInvite} title="Новый аккаунт сотрудника">
            <div className="flex flex-col gap-3.5">
              <input className="input" maxLength={120} placeholder="Имя и фамилия" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoFocus />
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 muted text-sm">@</span>
                <input className="input !pl-9" maxLength={24} placeholder="Логин для входа (например: aziza)" value={form.login} onChange={(event) => setForm({ ...form, login: event.target.value })} />
              </div>
              <select className="input" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value, agentId: event.target.value === "agent" ? form.agentId : "" })}>
                {STAFF_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role] ?? role}</option>)}
              </select>
              {form.role === "agent" && (
                <select className="input" value={form.agentId} onChange={(event) => setForm({ ...form, agentId: event.target.value })}>
                  <option value="">Выберите профиль агента</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.region}</option>)}
                </select>
              )}
              <input className="input" type="password" autoComplete="new-password" placeholder="Стартовый пароль (минимум 10 символов)" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
              <input className="input" type="email" maxLength={200} placeholder="Email (необязательно)" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              <button className="btn btn-primary justify-center" disabled={busy} onClick={() => void inviteUser()}>{busy ? "Создаём…" : "Создать аккаунт"}</button>
              <p className="text-xs muted text-center">Owner выдаёт стартовый пароль и при необходимости сбрасывает его. Сотрудник не может изменить пароль сам.</p>
            </div>
          </Modal>
        )}

        {profileFor && (
          <Modal open onClose={() => { if (!busy) { setProfileFor(null); setProfileForm(EMPTY_PROFILE); } }} title={`Карточка сотрудника: ${profileFor.name}`} wide>
            <div className="grid md:grid-cols-2 gap-3.5">
              <div className="md:col-span-2 flex items-center gap-3 rounded-2xl p-3" style={{ background: "rgba(var(--table-row))" }}>
                <Avatar name={profileFor.name} color={profileForm.avatarColor} size={42} />
                <div><div className="font-semibold">{profileFor.name}</div><div className="text-xs muted">@{profileFor.login} · {ROLE_LABEL[profileFor.role] ?? profileFor.role}</div></div>
              </div>
              <input className="input" maxLength={120} placeholder="Должность, например Руководитель склада" value={profileForm.position} onChange={(event) => setProfileForm({ ...profileForm, position: event.target.value })} />
              <input className="input" maxLength={120} placeholder="Подразделение, например Операционный отдел" value={profileForm.department} onChange={(event) => setProfileForm({ ...profileForm, department: event.target.value })} />
              <div className="relative"><Phone size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 muted" /><input className="input !pl-10" maxLength={48} placeholder="Рабочий телефон" value={profileForm.phone} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} /></div>
              <input className="input" type="date" value={profileForm.hireDate} onChange={(event) => setProfileForm({ ...profileForm, hireDate: event.target.value })} />
              <div className="md:col-span-2">
                <label className="text-xs muted uppercase tracking-wider">Цвет карточки</label>
                <div className="flex gap-2 mt-2">{PROFILE_COLORS.map((color) => <button key={color} type="button" aria-label={`Выбрать цвет ${color}`} className="w-7 h-7 rounded-full" style={{ background: color, outline: profileForm.avatarColor === color ? "3px solid var(--primary)" : "none", outlineOffset: "2px" }} onClick={() => setProfileForm({ ...profileForm, avatarColor: color })} />)}</div>
              </div>
              <textarea className="input md:col-span-2 min-h-28" maxLength={2000} placeholder="Заметка Owner: зона ответственности, режим, ключевые договорённости" value={profileForm.notes} onChange={(event) => setProfileForm({ ...profileForm, notes: event.target.value })} />
              <div className="md:col-span-2 grid sm:grid-cols-3 gap-2">
                <div className="rounded-2xl p-3" style={{ background: "rgba(var(--table-row))" }}><div className="text-xs muted">Открытых задач</div><div className="font-semibold mt-1 flex items-center gap-1"><CheckSquare size={14} color="var(--accent)" /> {profileFor.taskStats.open}</div></div>
                <div className="rounded-2xl p-3" style={{ background: "rgba(var(--table-row))" }}><div className="text-xs muted">KPI в месяце</div><div className="font-semibold mt-1 flex items-center gap-1"><Target size={14} color="var(--primary)" /> {profileFor.kpiCompletion === null ? "Не задан" : `${profileFor.kpiCompletion}%`}</div></div>
                <div className="rounded-2xl p-3" style={{ background: "rgba(var(--table-row))" }}><div className="text-xs muted">Ожидает решения</div><div className="font-semibold mt-1">{profileFor.pendingApprovals}</div></div>
              </div>
            </div>
            <button className="btn btn-primary w-full justify-center mt-4" disabled={busy} onClick={() => void saveProfile()}>{busy ? "Сохраняем…" : "Сохранить карточку"}</button>
          </Modal>
        )}

        {roleFor && (
          <Modal open onClose={() => { if (!busy) setRoleFor(null); }} title={`Роль сотрудника: ${roleFor.name}`}>
            <div className="flex flex-col gap-3.5">
              <select className="input" value={newRole} onChange={(event) => { setNewRole(event.target.value); if (event.target.value !== "agent") setNewAgentId(""); }}>
                {STAFF_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role] ?? role}</option>)}
              </select>
              {newRole === "agent" && (
                <select className="input" value={newAgentId} onChange={(event) => setNewAgentId(event.target.value)}>
                  <option value="">Выберите профиль агента</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.region}</option>)}
                </select>
              )}
              <button className="btn btn-primary justify-center" disabled={busy} onClick={() => void saveRole()}>{busy ? "Сохраняем…" : "Сохранить роль"}</button>
            </div>
          </Modal>
        )}

        {pwFor && (
          <Modal open onClose={() => { if (!busy) { setPwFor(null); setPw(""); } }} title={`Сброс пароля: ${pwFor.name}`}>
            <div className="flex flex-col gap-3.5">
              <input className="input" type="password" autoComplete="new-password" placeholder="Новый пароль (минимум 10 символов)" value={pw} onChange={(event) => setPw(event.target.value)} autoFocus />
              <p className="text-xs muted">После сброса все активные сессии этого сотрудника будут завершены.</p>
              <button className="btn btn-primary justify-center" disabled={busy} onClick={() => void resetPw()}>{busy ? "Сохраняем…" : "Сбросить пароль"}</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}
