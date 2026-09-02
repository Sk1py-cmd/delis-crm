"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Clock3, FileCheck2, Plus, Send, X, XCircle } from "lucide-react";
import { Avatar, Badge, Card, Modal, PageHeader } from "@/shared/ui/kit";
import { APPROVAL_CATEGORIES, APPROVAL_PRIORITIES } from "@/shared/config/workforce";
import { dt, money } from "@/shared/lib/format";
import { postWorkforce } from "@/shared/lib/workforce";
import { useToast } from "@/shared/ui/Toast";

export interface ApprovalRow {
  id: number;
  requesterUserId: number | null;
  requester: string;
  requesterLogin: string;
  requesterRole: string;
  category: string;
  subject: string;
  description: string;
  amount: number | null;
  priority: string;
  status: string;
  reviewerUserId: number | null;
  reviewer: string;
  decisionComment: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_REQUEST = { category: "expense", subject: "", description: "", amount: "", priority: "normal" };
type RequestForm = typeof EMPTY_REQUEST;

const STATUS: Record<string, { label: string; color: string; icon: typeof Clock3 }> = {
  pending: { label: "Ожидает решения", color: "#f97316", icon: Clock3 },
  approved: { label: "Согласовано", color: "#22c55e", icon: CheckCircle2 },
  rejected: { label: "Отклонено", color: "#ef4444", icon: XCircle },
  cancelled: { label: "Отменено", color: "#6b7280", icon: X },
};

function categoryFor(key: string) {
  return APPROVAL_CATEGORIES.find((item) => item.key === key) ?? APPROVAL_CATEGORIES[0];
}

export function ApprovalsClient({
  items,
  canManage,
  viewerId,
}: {
  items: ApprovalRow[];
  canManage: boolean;
  viewerId: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewFor, setReviewFor] = useState<ApprovalRow | null>(null);
  const [requestForm, setRequestForm] = useState<RequestForm>(EMPTY_REQUEST);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [comment, setComment] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => filter === "all" ? items : items.filter((item) => item.status === filter), [filter, items]);
  const pendingCount = items.filter((item) => item.status === "pending").length;
  const minePending = items.filter((item) => item.status === "pending" && item.requesterUserId === viewerId).length;

  const create = async () => {
    if (!requestForm.subject.trim() || !requestForm.description.trim()) {
      toast("Укажите тему и обоснование запроса", "err");
      return;
    }
    setBusy(true);
    try {
      await postWorkforce("createApproval", {
        title: requestForm.subject,
        type: requestForm.category,
        description: requestForm.description,
        priority: requestForm.priority,
        amount: requestForm.amount === "" ? undefined : requestForm.amount,
      });
      toast("Запрос на согласование отправлен");
      setRequestForm(EMPTY_REQUEST);
      setCreateOpen(false);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  const openReview = (item: ApprovalRow, nextDecision: "approved" | "rejected") => {
    setReviewFor(item);
    setDecision(nextDecision);
    setComment("");
  };

  const review = async () => {
    if (!reviewFor) return;
    if (decision === "rejected" && !comment.trim()) {
      toast("Укажите причину отклонения", "err");
      return;
    }
    setBusy(true);
    try {
      await postWorkforce("reviewApproval", { id: reviewFor.id, decision, decisionNote: comment });
      toast(decision === "approved" ? "Запрос согласован" : "Запрос отклонён");
      setReviewFor(null);
      setComment("");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Ошибка", "err");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (item: ApprovalRow) => {
    if (!window.confirm(`Отменить запрос «${item.subject}»?`)) return;
    setBusy(true);
    try {
      await postWorkforce("cancelApproval", { id: item.id });
      toast("Запрос отменён");
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
        title={canManage ? "Согласования" : "Мои согласования"}
        subtitle={canManage
          ? "Все запросы команды: принимайте решение, оставляйте комментарий и сохраняйте прозрачный след."
          : "Создавайте запросы и отслеживайте только свои решения. Нельзя согласовать собственный запрос."}
        actions={<button className="btn btn-primary" disabled={busy} onClick={() => { setRequestForm(EMPTY_REQUEST); setCreateOpen(true); }}><Plus size={15} /> Новый запрос</button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[var(--gap)]">
        {[
          { label: canManage ? "Всего запросов" : "Всего моих", value: items.length, color: "#8b5cf6" },
          { label: "Ожидают решения", value: pendingCount, color: "#f97316" },
          { label: canManage ? "Можно рассмотреть" : "Мои в ожидании", value: canManage ? items.filter((item) => item.status === "pending" && item.requesterUserId !== viewerId).length : minePending, color: "#3b82f6" },
          { label: "Согласовано", value: items.filter((item) => item.status === "approved").length, color: "#22c55e" },
        ].map((statistic) => <Card key={statistic.label}><div className="text-[0.72rem] uppercase tracking-wider muted">{statistic.label}</div><div className="text-2xl font-semibold mt-2" style={{ color: statistic.color }}>{statistic.value}</div></Card>)}
      </div>

      <div className="flex gap-2 flex-wrap">
        {[{ key: "all", label: "Все" }, ...Object.entries(STATUS).map(([key, value]) => ({ key, label: value.label }))].map((item) => (
          <button key={item.key} className={`btn !py-1.5 !text-xs ${filter === item.key ? "btn-primary" : ""}`} onClick={() => setFilter(item.key)}>{item.label}</button>
        ))}
      </div>

      <div className="grid gap-[var(--gap)] xl:grid-cols-2">
        {visible.map((item) => {
          const category = categoryFor(item.category);
          const status = STATUS[item.status] ?? STATUS.pending;
          const StatusIcon = status.icon;
          const priority = APPROVAL_PRIORITIES.find((value) => value.key === item.priority) ?? APPROVAL_PRIORITIES[1];
          const canReview = canManage && item.status === "pending" && item.requesterUserId !== viewerId;
          const canCancel = item.status === "pending" && item.requesterUserId === viewerId;
          return (
            <Card key={item.id} hover={false}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap"><span className="text-lg">{category.icon}</span><h3 className="font-semibold">{item.subject}</h3></div>
                  <div className="text-xs muted mt-1">{category.label} · {dt(item.createdAt)}</div>
                </div>
                <Badge color={status.color}><StatusIcon size={11} /> {status.label}</Badge>
              </div>

              <p className="text-sm muted mt-4 whitespace-pre-wrap">{item.description}</p>
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Badge color={priority.color}>{priority.label}</Badge>
                {item.amount !== null && item.amount > 0 && <span className="chip text-xs">{money(item.amount)}</span>}
              </div>

              <div className="flex items-center justify-between gap-3 mt-4 pt-3" style={{ borderTop: "1px solid rgba(var(--border))" }}>
                <div className="flex items-center gap-2 min-w-0"><Avatar name={item.requester} color="#8b5cf6" size={24} /><span className="text-xs truncate">{item.requester}{canManage && item.requesterLogin ? ` · @${item.requesterLogin}` : ""}</span></div>
                {item.reviewer && <span className="text-xs muted truncate">Решил: {item.reviewer}</span>}
              </div>

              {item.decisionComment && <div className="mt-3 text-xs rounded-xl p-2.5" style={{ background: "rgba(var(--table-row))" }}><b>{item.status === "rejected" ? "Причина:" : "Комментарий:"}</b> {item.decisionComment}</div>}

              {(canReview || canCancel) && (
                <div className="grid gap-2 mt-4" style={{ gridTemplateColumns: canReview ? "1fr 1fr" : "1fr" }}>
                  {canReview && <button className="btn btn-primary justify-center !py-2" disabled={busy} onClick={() => openReview(item, "approved")}><Check size={14} /> Согласовать</button>}
                  {canReview && <button className="btn justify-center !py-2" disabled={busy} onClick={() => openReview(item, "rejected")}><X size={14} color="var(--error)" /> Отклонить</button>}
                  {canCancel && <button className="btn justify-center !py-2" disabled={busy} onClick={() => void cancel(item)}><X size={14} /> Отменить запрос</button>}
                </div>
              )}
            </Card>
          );
        })}
        {visible.length === 0 && (
          <Card hover={false} className="xl:col-span-2 text-center !py-12">
            <FileCheck2 size={30} className="mx-auto muted" />
            <div className="font-semibold mt-3">Нет запросов в этой категории</div>
            <p className="text-sm muted mt-1">Создайте запрос, чтобы зафиксировать решение и ответственного.</p>
          </Card>
        )}
      </div>

      {createOpen && (
        <Modal open onClose={() => { if (!busy) setCreateOpen(false); }} title="Новый запрос на согласование" wide>
          <div className="grid md:grid-cols-2 gap-3.5">
            <select className="input" value={requestForm.category} onChange={(event) => setRequestForm({ ...requestForm, category: event.target.value })}>
              {APPROVAL_CATEGORIES.map((category) => <option key={category.key} value={category.key}>{category.icon} {category.label}</option>)}
            </select>
            <select className="input" value={requestForm.priority} onChange={(event) => setRequestForm({ ...requestForm, priority: event.target.value })}>
              {APPROVAL_PRIORITIES.map((priority) => <option key={priority.key} value={priority.key}>{priority.label}</option>)}
            </select>
            <input className="input md:col-span-2" maxLength={220} placeholder="Тема запроса" value={requestForm.subject} onChange={(event) => setRequestForm({ ...requestForm, subject: event.target.value })} autoFocus />
            <textarea className="input md:col-span-2 min-h-28" maxLength={4000} placeholder="Обоснование, условия и что именно нужно согласовать" value={requestForm.description} onChange={(event) => setRequestForm({ ...requestForm, description: event.target.value })} />
            <input className="input" type="number" min="0" step="any" placeholder="Сумма, сум (необязательно)" value={requestForm.amount} onChange={(event) => setRequestForm({ ...requestForm, amount: event.target.value })} />
          </div>
          <button className="btn btn-primary w-full justify-center mt-4" disabled={busy} onClick={() => void create()}><Send size={15} /> {busy ? "Отправляем…" : "Отправить на согласование"}</button>
        </Modal>
      )}

      {reviewFor && (
        <Modal open onClose={() => { if (!busy) { setReviewFor(null); setComment(""); } }} title={decision === "approved" ? "Согласовать запрос" : "Отклонить запрос"}>
          <div className="flex flex-col gap-3.5">
            <div className="rounded-2xl p-3" style={{ background: "rgba(var(--table-row))" }}><div className="font-semibold">{reviewFor.subject}</div><div className="text-xs muted mt-1">Автор: {reviewFor.requester}</div></div>
            <textarea className="input min-h-24" maxLength={2000} placeholder={decision === "approved" ? "Комментарий к решению (необязательно)" : "Причина отклонения"} value={comment} onChange={(event) => setComment(event.target.value)} autoFocus />
            <button className={`btn justify-center ${decision === "approved" ? "btn-primary" : ""}`} disabled={busy} onClick={() => void review()}>{decision === "approved" ? <Check size={15} /> : <X size={15} color="var(--error)" />}{busy ? "Сохраняем…" : decision === "approved" ? "Согласовать" : "Отклонить"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
