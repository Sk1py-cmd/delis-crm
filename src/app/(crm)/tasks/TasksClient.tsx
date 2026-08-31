"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, CheckCircle2, Circle, Clock, Flag, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Avatar, Badge, Card, Modal, PageHeader } from "@/shared/ui/kit";
import { dt } from "@/shared/lib/format";
import { useToast } from "@/shared/ui/Toast";
import { postWorkforce } from "@/shared/lib/workforce";
import { useT } from "@/shared/i18n/useT";

interface TaskLite {
  id: number;
  title: string;
  description: string;
  assignee: string;
  assigneeUserId: number | null;
  priority: string;
  status: string;
  linkType: string;
  linkLabel: string;
  dueAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdByUserId: number | null;
  updatedAt: string;
  createdAt: string;
}

interface TeamMember {
  id: number;
  name: string;
  login: string;
  role: string;
}

interface Viewer {
  id: number;
  name: string;
  role: string;
}

const COLUMNS = [
  { key: "todo", labelKey: "tasks.todo", color: "#6b7280", icon: Circle },
  { key: "in_progress", labelKey: "tasks.inProgress", color: "#f97316", icon: Clock },
  { key: "done", labelKey: "tasks.done", color: "#22c55e", icon: CheckCircle2 },
];

const PRIORITY: Record<string, { label: string; color: string }> = {
  high: { label: "Срочно", color: "#ef4444" },
  mid: { label: "Обычная", color: "#f97316" },
  low: { label: "Не срочно", color: "#22c55e" },
};

const LINK_ICON: Record<string, string> = {
  order: "🧾",
  customer: "👤",
  agent: "🧑‍💼",
  supplier: "🏭",
  approval: "✅",
};

export function TasksClient({
  tasks,
  team,
  viewer,
  canManage,
}: {
  tasks: TaskLite[];
  team: TeamMember[];
  viewer: Viewer;
  canManage: boolean;
}) {
  const defaultAssigneeId = String(team[0]?.id ?? viewer.id);
  const [modal, setModal] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    assigneeUserId: defaultAssigneeId,
    priority: "mid",
    linkType: "",
    linkLabel: "",
    dueAt: "",
  });
  const toast = useToast();
  const tr = useT();
  const router = useRouter();

  const taskCounts = useMemo(() => ({
    total: tasks.length,
    inProgress: tasks.filter((task) => task.status === "in_progress").length,
    done: tasks.filter((task) => task.status === "done").length,
    overdue: tasks.filter((task) => task.status !== "done" && task.dueAt && new Date(task.dueAt).getTime() < Date.now()).length,
  }), [tasks]);

  const canMove = (task: TaskLite, status: string) => {
    if (task.status === status) return false;
    if (canManage) return true;
    if (task.assigneeUserId !== viewer.id) return false;
    return (task.status === "todo" && (status === "in_progress" || status === "done"))
      || (task.status === "in_progress" && status === "done");
  };

  const move = async (id: number, status: string) => {
    setDragId(null);
    const task = tasks.find((item) => item.id === id);
    if (!task || !canMove(task, status)) {
      toast("Недоступный переход статуса", "err");
      return;
    }
    setBusy(true);
    try {
      await postWorkforce("transitionTask", { id, status });
      if (status === "done") toast("Задача выполнена ✅");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!form.title.trim()) {
      toast("Укажите название задачи", "err");
      return;
    }
    setBusy(true);
    try {
      await postWorkforce("createTask", {
        ...form,
        assigneeUserId: canManage ? Number(form.assigneeUserId) : viewer.id,
      });
      toast("Задача создана и назначена исполнителю");
      setModal(false);
      setForm({
        title: "",
        description: "",
        assigneeUserId: defaultAssigneeId,
        priority: "mid",
        linkType: "",
        linkLabel: "",
        dueAt: "",
      });
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (task: TaskLite) => {
    if (!canManage || !window.confirm(`Удалить задачу «${task.title}»?`)) return;
    setBusy(true);
    try {
      await postWorkforce("deleteTask", { id: task.id });
      toast("Задача удалена");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  const isOverdue = (task: TaskLite) => task.status !== "done" && task.dueAt && new Date(task.dueAt).getTime() < Date.now();

  return (
    <>
      <PageHeader
        title={tr("tasks.title")}
        subtitle={canManage
          ? "Канбан команды: назначайте работу, отслеживайте сроки и принимайте результат."
          : "Только ваши задачи. Статус можно продвигать вперёд — права проверяются сервером."}
        actions={<button className="btn btn-primary" disabled={busy} onClick={() => setModal(true)}><Plus size={15} /> {tr("tasks.newTask")}</button>}
      />

      {!canManage && (
        <div className="flex items-center gap-2 text-xs muted rounded-2xl px-3 py-2.5 mb-[var(--gap)]" style={{ background: "color-mix(in srgb, var(--primary) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 18%, transparent)" }}>
          <ShieldCheck size={14} color="var(--primary)" />
          Коллеги и задачи других сотрудников скрыты. Руководитель управляет всей доской.
        </div>
      )}

      <div className="grid gap-[var(--gap)] grid-cols-2 sm:grid-cols-4">
        {[
          { label: tr("tasks.total"), value: String(taskCounts.total), color: "#8b5cf6", icon: "📋" },
          { label: tr("tasks.inProgress"), value: String(taskCounts.inProgress), color: "#f97316", icon: "⚡" },
          { label: tr("tasks.done"), value: String(taskCounts.done), color: "#22c55e", icon: "✅" },
          { label: tr("tasks.overdue"), value: String(taskCounts.overdue), color: "#ef4444", icon: "🔥" },
        ].map((statistic, index) => (
          <Card key={statistic.label} delay={index * 0.04}>
            <div className="text-[0.72rem] uppercase tracking-wider muted">{statistic.label}</div>
            <div className="text-xl font-semibold mt-2" style={{ color: statistic.color }}>{statistic.icon} {statistic.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-[var(--gap)] md:grid-cols-3">
        {COLUMNS.map((column) => {
          const items = tasks.filter((task) => task.status === column.key);
          const Icon = column.icon;
          return (
            <div
              key={column.key}
              className="flex flex-col gap-3 rounded-3xl p-3 min-h-[50vh] transition-colors"
              style={{ background: "rgba(var(--surface),0.3)", border: "1px dashed rgba(var(--border))" }}
              onDragOver={(event) => {
                const task = tasks.find((item) => item.id === dragId);
                if (!task || !canMove(task, column.key)) return;
                event.preventDefault();
                event.currentTarget.style.background = "rgba(var(--surface),0.7)";
              }}
              onDragLeave={(event) => { event.currentTarget.style.background = "rgba(var(--surface),0.3)"; }}
              onDrop={(event) => {
                event.preventDefault();
                event.currentTarget.style.background = "rgba(var(--surface),0.3)";
                if (dragId) void move(dragId, column.key);
              }}
            >
              <div className="flex items-center justify-between px-2 pt-1">
                <div className="flex items-center gap-2">
                  <Icon size={16} color={column.color} />
                  <span className="font-semibold text-sm">{tr(column.labelKey)}</span>
                </div>
                <Badge color={column.color}>{items.length}</Badge>
              </div>

              <div className="flex flex-col gap-3 overflow-y-auto no-scrollbar">
                <AnimatePresence>
                  {items.map((task) => {
                    const priority = PRIORITY[task.priority] ?? PRIORITY.mid;
                    const late = isOverdue(task);
                    const draggable = !busy && (canManage || (task.assigneeUserId === viewer.id && task.status !== "done"));
                    return (
                      <motion.div
                        key={task.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        draggable={draggable}
                        onDragStart={() => setDragId(task.id)}
                        onDragEnd={() => setDragId(null)}
                        className={`glass card-pad !p-3.5 group ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-sm leading-snug" style={{ textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? 0.6 : 1 }}>
                            {task.title}
                          </span>
                          {canManage && (
                            <button className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0" disabled={busy} title="Удалить задачу" onClick={() => void remove(task)}>
                              <Trash2 size={13} color="var(--error)" />
                            </button>
                          )}
                        </div>

                        {task.description && <p className="text-xs muted mt-1.5 line-clamp-2">{task.description}</p>}

                        <div className="flex flex-wrap items-center gap-1.5 mt-3">
                          <Badge color={priority.color}><Flag size={10} /> {priority.label}</Badge>
                          {task.linkLabel && (
                            <span className="chip !text-[0.68rem]" style={{ borderColor: "rgba(var(--border))" }}>
                              {LINK_ICON[task.linkType] ?? "🔗"} {task.linkLabel}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between mt-3 pt-3 gap-2" style={{ borderTop: "1px solid rgba(var(--border))" }}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            {task.assignee && <Avatar name={task.assignee} size={20} color={column.color} />}
                            <span className="text-xs muted truncate">{task.assignee || tr("tasks.notAssigned")}</span>
                          </div>
                          {task.dueAt && (
                            <span className="text-[0.68rem] flex items-center gap-1 whitespace-nowrap" style={{ color: late ? "var(--error)" : "var(--muted)" }}>
                              <Calendar size={10} /> {dt(task.dueAt)}
                            </span>
                          )}
                        </div>
                        {canManage && task.createdBy && <div className="text-[0.65rem] muted mt-2">Поставил: {task.createdBy}</div>}

                        {task.status !== "done" && (canManage || task.assigneeUserId === viewer.id) && (
                          <div className="flex gap-1.5 mt-2.5">
                            {task.status === "todo" && (
                              <button className="btn !py-1 !px-2.5 !text-xs flex-1 justify-center" disabled={busy} onClick={() => void move(task.id, "in_progress")}>
                                {tr("tasks.toWork")}
                              </button>
                            )}
                            <button className="btn btn-primary !py-1 !px-2.5 !text-xs flex-1 justify-center" disabled={busy} onClick={() => void move(task.id, "done")}>
                              {tr("tasks.markDone")}
                            </button>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {items.length === 0 && (
                  <div className="text-center py-8 text-xs muted border-2 border-dashed rounded-2xl" style={{ borderColor: "rgba(var(--border))" }}>
                    {tr("tasks.dragHere")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {modal && (
        <Modal open onClose={() => { if (!busy) setModal(false); }} title="Новая задача" wide>
          <div className="grid md:grid-cols-2 gap-3.5">
            <input className="input md:col-span-2" maxLength={220} placeholder={tr("tasks.taskName")} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} autoFocus />
            <textarea className="input md:col-span-2 min-h-20" maxLength={4000} placeholder={tr("tasks.taskDesc")} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            {canManage ? (
              <div>
                <label className="text-xs muted uppercase tracking-wider">{tr("tasks.assignee")}</label>
                <select className="input mt-1.5" value={form.assigneeUserId} onChange={(event) => setForm({ ...form, assigneeUserId: event.target.value })}>
                  {team.map((member) => <option key={member.id} value={member.id}>{member.name} · @{member.login}</option>)}
                </select>
              </div>
            ) : (
              <div className="rounded-2xl px-3.5 py-3" style={{ background: "rgba(var(--table-row))", border: "1px solid rgba(var(--border))" }}>
                <div className="text-xs muted uppercase tracking-wider">Исполнитель</div>
                <div className="text-sm mt-1 font-medium">{viewer.name} · вы</div>
              </div>
            )}
            <div>
              <label className="text-xs muted uppercase tracking-wider">{tr("tasks.priority")}</label>
              <select className="input mt-1.5" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
                <option value="high">🔴 Срочно</option>
                <option value="mid">🟠 Обычная</option>
                <option value="low">🟢 Не срочно</option>
              </select>
            </div>
            <div>
              <label className="text-xs muted uppercase tracking-wider">{tr("tasks.link")}</label>
              <select className="input mt-1.5" value={form.linkType} onChange={(event) => setForm({ ...form, linkType: event.target.value })}>
                <option value="">Без привязки</option>
                <option value="order">🧾 Заказ</option>
                <option value="customer">👤 Клиент</option>
                <option value="agent">🧑‍💼 Агент</option>
                <option value="supplier">🏭 Поставщик</option>
                <option value="approval">✅ Согласование</option>
              </select>
            </div>
            <input className="input" maxLength={220} placeholder="Метка привязки (например: DLS-24031)" value={form.linkLabel} onChange={(event) => setForm({ ...form, linkLabel: event.target.value })} />
            <div className="md:col-span-2">
              <label className="text-xs muted uppercase tracking-wider">{tr("tasks.deadline")}</label>
              <input type="datetime-local" className="input mt-1.5" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary w-full justify-center mt-4" disabled={busy} onClick={() => void create()}>
            {busy ? tr("common.saving") : tr("tasks.newTask")}
          </button>
        </Modal>
      )}
    </>
  );
}
