"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Pencil, Plus, Target, UsersRound } from "lucide-react";
import { Avatar, Badge, Card, Modal, PageHeader, Progress } from "@/shared/ui/kit";
import { ROLE_LABEL } from "@/shared/lib/format";
import { KPI_METRICS } from "@/shared/config/workforce";
import { postWorkforce } from "@/shared/lib/workforce";
import { useToast } from "@/shared/ui/Toast";

export interface KpiRow {
  id: number;
  metric: string;
  label: string;
  target: number;
  actual: number;
  unit: string;
  note: string;
  updatedAt: string;
}

export interface KpiPerson {
  id: number;
  name: string;
  login: string;
  role: string;
  status: string;
  profile: { position: string; department: string; avatarColor: string } | null;
  completion: number | null;
  kpis: KpiRow[];
}

const EMPTY_FORM = { userId: "", metric: "sales", target: "", actual: "", unit: "сум", note: "" };

type KpiForm = typeof EMPTY_FORM;

function percent(row: KpiRow) {
  if (row.target <= 0) return 0;
  return Math.round((row.actual / row.target) * 100);
}

function metricConfig(metric: string) {
  return KPI_METRICS.find((item) => item.key === metric) ?? KPI_METRICS[0];
}

export function KpiClient({
  period,
  people,
  canManage,
}: {
  period: string;
  people: KpiPerson[];
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<KpiForm>(() => ({ ...EMPTY_FORM, userId: String(people[0]?.id ?? "") }));
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => {
    const rows = people.flatMap((person) => person.kpis);
    const completed = people.filter((person) => person.completion !== null && person.completion >= 100).length;
    const average = people.filter((person) => person.completion !== null);
    return {
      metrics: rows.length,
      onTarget: completed,
      average: average.length ? Math.round(average.reduce((sum, person) => sum + (person.completion ?? 0), 0) / average.length) : null,
    };
  }, [people]);

  const openEditor = (person?: KpiPerson, row?: KpiRow) => {
    const targetPerson = person ?? people[0];
    if (!targetPerson) {
      toast("Сначала создайте аккаунт сотрудника", "err");
      return;
    }
    const config = metricConfig(row?.metric ?? "sales");
    setForm({
      userId: String(targetPerson.id),
      metric: row?.metric ?? config.key,
      target: row ? String(row.target) : "",
      actual: row ? String(row.actual) : "",
      unit: row?.unit ?? config.defaultUnit,
      note: row?.note ?? "",
    });
    setEditorOpen(true);
  };

  const changeMetric = (metric: string) => {
    const config = metricConfig(metric);
    setForm({ ...form, metric, unit: config.defaultUnit });
  };

  const save = async () => {
    if (!form.userId || form.target === "" || form.actual === "") {
      toast("Выберите сотрудника и заполните цель с фактом", "err");
      return;
    }
    setBusy(true);
    try {
      await postWorkforce("saveEmployeeKpi", {
        userId: Number(form.userId),
        period,
        metric: form.metric,
        target: form.target,
        actual: form.actual,
        unit: form.unit,
        note: form.note,
      });
      toast("KPI сохранён");
      setEditorOpen(false);
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
        title={canManage ? "KPI команды" : "Мои KPI"}
        subtitle={canManage
          ? "Цели и фактические результаты по сотрудникам. Данные KPI редактируют руководители."
          : "Ваши показатели за выбранный месяц. Факт и цели подтверждаются руководителем."}
        actions={
          <>
            <label className="btn !p-0 overflow-hidden" title="Выбрать месяц KPI">
              <CalendarDays size={15} className="ml-3" />
              <input
                type="month"
                value={period}
                onChange={(event) => router.push(`/kpi?period=${encodeURIComponent(event.target.value)}`)}
                className="bg-transparent px-2 py-2 outline-none text-sm"
                aria-label="Месяц KPI"
              />
            </label>
            {canManage && <button className="btn btn-primary" disabled={busy} onClick={() => openEditor()}><Plus size={15} /> KPI</button>}
          </>
        }
      />

      <div className="grid gap-[var(--gap)] grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Сотрудников", value: people.length, icon: UsersRound, color: "#8b5cf6" },
          { label: "Метрик в месяце", value: summary.metrics, icon: Target, color: "#3b82f6" },
          { label: "Выполняют план", value: summary.onTarget, icon: BarChart3, color: "#22c55e" },
          { label: "Среднее выполнение", value: summary.average === null ? "—" : `${summary.average}%`, icon: Target, color: "#f97316" },
        ].map((statistic) => {
          const Icon = statistic.icon;
          return (
            <Card key={statistic.label}>
              <div className="flex justify-between items-start gap-2">
                <div><div className="text-[0.72rem] uppercase tracking-wider muted">{statistic.label}</div><div className="text-2xl font-semibold mt-2">{statistic.value}</div></div>
                <Icon size={19} color={statistic.color} />
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-[var(--gap)] xl:grid-cols-2">
        {people.map((person) => {
          const color = person.profile?.avatarColor ?? "#64748b";
          return (
            <Card key={person.id} hover={false}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={person.name} color={color} size={40} />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{person.name}</div>
                    <div className="text-xs muted truncate">{person.profile?.position || ROLE_LABEL[person.role] || person.role}{person.profile?.department ? ` · ${person.profile.department}` : ""}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge color={person.completion !== null && person.completion >= 100 ? "#22c55e" : "#8b5cf6"}>{person.completion === null ? "KPI не задан" : `${person.completion}%`}</Badge>
                  {canManage && <button className="btn !px-2 !py-1" title="Добавить KPI" onClick={() => openEditor(person)}><Plus size={14} /></button>}
                </div>
              </div>

              <div className="flex flex-col gap-3 mt-5">
                {person.kpis.map((row) => {
                  const completion = percent(row);
                  const colorForRow = completion >= 100 ? "#22c55e" : completion >= 70 ? "#f97316" : "#ef4444";
                  return (
                    <div key={row.id} className="rounded-2xl p-3" style={{ background: "rgba(var(--table-row))" }}>
                      <div className="flex items-start justify-between gap-3">
                        <div><div className="text-sm font-medium">{row.label}</div>{row.note && <div className="text-xs muted mt-0.5">{row.note}</div>}</div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-sm font-semibold" style={{ color: colorForRow }}>{row.actual.toLocaleString("ru-RU")} / {row.target.toLocaleString("ru-RU")} {row.unit}</span>
                          {canManage && <button className="btn !px-1.5 !py-1" title="Изменить KPI" onClick={() => openEditor(person, row)}><Pencil size={13} /></button>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2"><Progress value={Math.min(completion, 100)} color={colorForRow} /><span className="text-xs w-11 text-right" style={{ color: colorForRow }}>{completion}%</span></div>
                    </div>
                  );
                })}
                {person.kpis.length === 0 && (
                  <div className="rounded-2xl p-4 text-sm muted text-center border border-dashed" style={{ borderColor: "rgba(var(--border))" }}>
                    KPI на этот месяц ещё не задан.
                    {canManage && <button className="block mx-auto btn !py-1 !px-2.5 !text-xs mt-2" onClick={() => openEditor(person)}>Добавить показатель</button>}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {editorOpen && (
        <Modal open onClose={() => { if (!busy) setEditorOpen(false); }} title="Цель и факт KPI">
          <div className="flex flex-col gap-3.5">
            <select className="input" value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name} · @{person.login}</option>)}
            </select>
            <select className="input" value={form.metric} onChange={(event) => changeMetric(event.target.value)}>
              {KPI_METRICS.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input className="input" type="number" min="0" step="any" placeholder="Цель" value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} autoFocus />
              <input className="input" type="number" min="0" step="any" placeholder="Факт" value={form.actual} onChange={(event) => setForm({ ...form, actual: event.target.value })} />
            </div>
            <input className="input" maxLength={24} placeholder="Единица измерения" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
            <textarea className="input min-h-24" maxLength={500} placeholder="Комментарий к показателю (необязательно)" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            <button className="btn btn-primary justify-center" disabled={busy} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить KPI"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
