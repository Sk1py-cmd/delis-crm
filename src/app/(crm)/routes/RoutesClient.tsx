"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CheckCircle2, MapPin, Navigation, Pencil, Plus, Trash2 } from "lucide-react";
import { Avatar, Badge, Card, Modal, PageHeader, Progress } from "@/shared/ui/kit";
import { dt } from "@/shared/lib/format";
import { postFieldwork } from "@/shared/lib/fieldwork";
import { useToast } from "@/shared/ui/Toast";

interface AgentOption {
  id: number;
  name: string;
  region: string;
  avatarColor: string;
}

interface RouteStop {
  id: number;
  routeId: number;
  sequence: number;
  storeName: string;
  storeAddress: string;
  plannedLatitude: string | null;
  plannedLongitude: string | null;
  status: string;
  visitId: number | null;
  notes: string;
  completedAt: string | null;
}

interface AgentRoute {
  id: number;
  agentId: number;
  agentName: string;
  agentRegion: string;
  routeDate: string;
  title: string;
  notes: string;
  status: string;
  assignedByName: string;
  updatedAt: string;
  createdAt: string;
  stops: RouteStop[];
}

type DraftStop = {
  storeName: string;
  storeAddress: string;
  notes: string;
  plannedLatitude: string;
  plannedLongitude: string;
};

const blankStop = (): DraftStop => ({ storeName: "", storeAddress: "", notes: "", plannedLatitude: "", plannedLongitude: "" });
const ROUTE_STATUS: Record<string, { label: string; color: string }> = {
  planned: { label: "Запланирован", color: "#3b82f6" },
  in_progress: { label: "В пути", color: "#f97316" },
  completed: { label: "Завершён", color: "#22c55e" },
  cancelled: { label: "Отменён", color: "#6b7280" },
};

export function RoutesClient({
  routeDate,
  routes,
  agents,
}: {
  routeDate: string;
  routes: AgentRoute[];
  agents: AgentOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [editor, setEditor] = useState(false);
  const [editingRoute, setEditingRoute] = useState<AgentRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ agentId: String(agents[0]?.id ?? ""), routeDate, title: "", notes: "", stops: [blankStop()] as DraftStop[] });

  const summary = useMemo(() => {
    const stops = routes.flatMap((route) => route.stops);
    const completed = stops.filter((stop) => stop.status === "visited" || stop.status === "skipped").length;
    return { routes: routes.length, stops: stops.length, completed, active: routes.filter((route) => route.status === "in_progress").length };
  }, [routes]);

  const openCreate = () => {
    if (!agents.length) {
      toast("Сначала создайте активный профиль агента", "err");
      return;
    }
    setEditingRoute(null);
    setForm({ agentId: String(agents[0].id), routeDate, title: "", notes: "", stops: [blankStop()] });
    setEditor(true);
  };

  const openEdit = (route: AgentRoute) => {
    setEditingRoute(route);
    setForm({
      agentId: String(route.agentId),
      routeDate: route.routeDate,
      title: route.title,
      notes: route.notes,
      stops: route.stops.map((stop) => ({
        storeName: stop.storeName,
        storeAddress: stop.storeAddress,
        notes: stop.notes,
        plannedLatitude: stop.plannedLatitude ?? "",
        plannedLongitude: stop.plannedLongitude ?? "",
      })),
    });
    setEditor(true);
  };

  const updateStop = (index: number, patch: Partial<DraftStop>) => {
    setForm({ ...form, stops: form.stops.map((stop, current) => current === index ? { ...stop, ...patch } : stop) });
  };

  const save = async () => {
    if (!form.agentId || !form.title.trim() || form.stops.some((stop) => !stop.storeName.trim())) {
      toast("Выберите агента, назовите маршрут и заполните все точки", "err");
      return;
    }
    if (form.stops.length > 60) {
      toast("В одном маршруте может быть до 60 точек", "err");
      return;
    }
    setBusy(true);
    try {
      await postFieldwork("saveRoute", {
        agentId: Number(form.agentId),
        routeDate: form.routeDate,
        title: form.title,
        notes: form.notes,
        stops: form.stops.map((stop) => ({
          ...stop,
          plannedLatitude: stop.plannedLatitude === "" ? null : stop.plannedLatitude,
          plannedLongitude: stop.plannedLongitude === "" ? null : stop.plannedLongitude,
        })),
      });
      toast(editingRoute ? "Маршрут обновлён" : "Маршрут назначен агенту");
      setEditor(false);
      setEditingRoute(null);
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
        title="Маршруты агентов"
        subtitle="Планируйте последовательность точек на день. Агент отмечает маршрут только через GPS-визит."
        actions={
          <>
            <label className="btn !p-0 overflow-hidden" title="Выбрать дату маршрутов">
              <CalendarDays size={15} className="ml-3" />
              <input type="date" value={routeDate} onChange={(event) => router.push(`/routes?date=${encodeURIComponent(event.target.value)}`)} className="bg-transparent px-2 py-2 outline-none text-sm" aria-label="Дата маршрутов" />
            </label>
            <button className="btn btn-primary" disabled={busy} onClick={openCreate}><Plus size={15} /> Маршрут</button>
          </>
        }
      />

      <div className="grid gap-[var(--gap)] grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Маршрутов", value: summary.routes, color: "#8b5cf6" },
          { label: "Точек", value: summary.stops, color: "#3b82f6" },
          { label: "Отмечено", value: summary.completed, color: "#22c55e" },
          { label: "В пути", value: summary.active, color: "#f97316" },
        ].map((statistic) => <Card key={statistic.label}><div className="text-[0.72rem] uppercase tracking-wider muted">{statistic.label}</div><div className="text-2xl font-semibold mt-2" style={{ color: statistic.color }}>{statistic.value}</div></Card>)}
      </div>

      <div className="grid gap-[var(--gap)] xl:grid-cols-2">
        {routes.map((route) => {
          const status = ROUTE_STATUS[route.status] ?? ROUTE_STATUS.planned;
          const done = route.stops.filter((stop) => stop.status === "visited" || stop.status === "skipped").length;
          const progress = route.stops.length ? Math.round((done / route.stops.length) * 100) : 0;
          return (
            <Card key={route.id} hover={false}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={route.agentName} color="#8b5cf6" size={40} />
                  <div className="min-w-0"><h3 className="font-semibold truncate">{route.title}</h3><p className="text-xs muted truncate">{route.agentName} · {route.agentRegion}</p></div>
                </div>
                <div className="flex items-center gap-1.5"><Badge color={status.color}>{status.label}</Badge>{route.status === "planned" && <button className="btn !px-2 !py-1" title="Изменить маршрут" disabled={busy} onClick={() => openEdit(route)}><Pencil size={13} /></button>}</div>
              </div>
              {route.notes && <p className="text-sm muted mt-3">{route.notes}</p>}
              <div className="flex items-center gap-2 mt-4"><Progress value={progress} color={status.color} /><span className="text-xs whitespace-nowrap muted">{done}/{route.stops.length}</span></div>
              <div className="flex flex-col gap-2 mt-4">
                {route.stops.map((stop) => {
                  const completed = stop.status === "visited" || stop.status === "skipped";
                  return (
                    <div key={stop.id} className="flex items-start gap-3 rounded-2xl px-3 py-2.5" style={{ background: "rgba(var(--table-row))" }}>
                      <div className="w-6 h-6 rounded-full grid place-items-center text-xs font-bold shrink-0" style={{ color: completed ? "white" : "var(--muted)", background: completed ? "var(--success)" : "rgba(var(--surface),0.8)" }}>{completed ? <CheckCircle2 size={14} /> : stop.sequence}</div>
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{stop.storeName}</div><div className="text-xs muted truncate">{stop.storeAddress || "Адрес не указан"}</div>{stop.notes && <div className="text-xs muted mt-1">{stop.notes}</div>}</div>
                      {stop.plannedLatitude && stop.plannedLongitude && <MapPin size={14} color="var(--accent)" className="shrink-0 mt-1" />}
                    </div>
                  );
                })}
              </div>
              <div className="text-[0.68rem] muted mt-3">Назначил: {route.assignedByName || "—"} · обновлено {dt(route.updatedAt)}</div>
            </Card>
          );
        })}
        {routes.length === 0 && <Card hover={false} className="xl:col-span-2 !py-14 text-center"><Navigation size={32} className="mx-auto muted" /><div className="font-semibold mt-3">На {routeDate} маршрутов нет</div><p className="text-sm muted mt-1">Создайте первый маршрут и добавьте торговые точки в правильном порядке.</p><button className="btn btn-primary mt-4" onClick={openCreate}><Plus size={15} /> Создать маршрут</button></Card>}
      </div>

      {editor && (
        <Modal open onClose={() => { if (!busy) { setEditor(false); setEditingRoute(null); } }} title={editingRoute ? "Изменить маршрут" : "Новый маршрут"} wide>
          <div className="flex flex-col gap-3.5 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid md:grid-cols-2 gap-3">
              <select className="input" value={form.agentId} onChange={(event) => setForm({ ...form, agentId: event.target.value })} disabled={Boolean(editingRoute)}>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.region}</option>)}
              </select>
              <input className="input" type="date" value={form.routeDate} onChange={(event) => setForm({ ...form, routeDate: event.target.value })} disabled={Boolean(editingRoute)} />
            </div>
            <input className="input" maxLength={220} placeholder="Например: Северный маршрут — автомойки" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} autoFocus />
            <textarea className="input min-h-20" maxLength={2000} placeholder="Комментарий агенту: приоритеты, условия, время" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            <div className="flex items-center justify-between"><div><div className="font-semibold text-sm">Точки маршрута</div><div className="text-xs muted">GPS плановой точки необязателен; агент фиксирует фактическое местоположение при визите.</div></div><button className="btn !py-1.5 !text-xs" type="button" disabled={form.stops.length >= 60} onClick={() => setForm({ ...form, stops: [...form.stops, blankStop()] })}><Plus size={13} /> Точка</button></div>
            {form.stops.map((stop, index) => (
              <div key={index} className="rounded-2xl p-3 grid md:grid-cols-[28px_1fr_1fr_34px] gap-2 items-start" style={{ background: "rgba(var(--table-row))" }}>
                <div className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold" style={{ background: "var(--surface)" }}>{index + 1}</div>
                <input className="input" maxLength={220} placeholder="Название торговой точки" value={stop.storeName} onChange={(event) => updateStop(index, { storeName: event.target.value })} />
                <input className="input" maxLength={400} placeholder="Адрес" value={stop.storeAddress} onChange={(event) => updateStop(index, { storeAddress: event.target.value })} />
                <button className="btn !px-2 !py-2" type="button" title="Удалить точку" disabled={form.stops.length === 1} onClick={() => setForm({ ...form, stops: form.stops.filter((_, current) => current !== index) })}><Trash2 size={14} color="var(--error)" /></button>
                <div className="md:col-start-2 md:col-span-2 grid grid-cols-3 gap-2"><input className="input !text-xs" maxLength={30} placeholder="Широта (опц.)" value={stop.plannedLatitude} onChange={(event) => updateStop(index, { plannedLatitude: event.target.value })} /><input className="input !text-xs" maxLength={30} placeholder="Долгота (опц.)" value={stop.plannedLongitude} onChange={(event) => updateStop(index, { plannedLongitude: event.target.value })} /><input className="input !text-xs" maxLength={1000} placeholder="Заметка" value={stop.notes} onChange={(event) => updateStop(index, { notes: event.target.value })} /></div>
              </div>
            ))}
          </div>
          <button className="btn btn-primary w-full justify-center mt-4" disabled={busy} onClick={() => void save()}>{busy ? "Сохраняем…" : editingRoute ? "Сохранить маршрут" : "Назначить маршрут"}</button>
        </Modal>
      )}
    </>
  );
}
