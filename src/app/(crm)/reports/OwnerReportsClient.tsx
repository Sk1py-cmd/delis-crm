"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Filter, ShieldCheck } from "lucide-react";
import { Badge, Card, PageHeader, Progress } from "@/shared/ui/kit";
import { Bars, Lines } from "@/shared/ui/charts";
import { channelMeta } from "@/shared/config/channels";
import { exportXLSX } from "@/shared/lib/excel";
import { compact, money, statusMeta } from "@/shared/lib/format";
import { useToast } from "@/shared/ui/Toast";
import { StatGrid } from "@/widgets/StatCard";

interface Props {
  range: { from: string; to: string };
  sales: { revenue: number; profit: number; orders: number; customers: number; delivered: number };
  finance: { income: number; expense: number; marketing: number };
  newCustomers: number;
  automation: { runs: number; queued: number };
  returns: { count: number; refunds: number };
  security: { events: number; warnings: number };
  byDay: { day: string; revenue: number; profit: number; orders: number }[];
  channels: { channel: string; revenue: number; profit: number; orders: number; spent: number; roi: number | null }[];
  unallocatedMarketingSpend: number;
  byStatus: { status: string; count: number }[];
  topCustomers: { id: number; firstName: string; lastName: string; orders: number; revenue: number }[];
}

export function OwnerReportsClient(props: Props) {
  const [from, setFrom] = useState(props.range.from);
  const [to, setTo] = useState(props.range.to);
  const router = useRouter();
  const toast = useToast();
  const netCash = props.finance.income - props.finance.expense;
  const deliveryRate = (props.sales.delivered / Math.max(props.sales.orders, 1)) * 100;
  const margin = (props.sales.profit / Math.max(props.sales.revenue, 1)) * 100;

  const applyRange = () => {
    if (!from || !to || from > to) {
      toast("Укажите корректный период отчёта", "err");
      return;
    }
    router.push(`/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  };

  const exportReport = () => {
    const rows: (string | number)[][] = [
      ["Период", `${props.range.from} — ${props.range.to}`],
      ["Выручка заказов", props.sales.revenue],
      ["Валовая прибыль", props.sales.profit],
      ["Заказы", props.sales.orders],
      ["Клиенты в заказах", props.sales.customers],
      ["Финансовые доходы", props.finance.income],
      ["Финансовые расходы", props.finance.expense],
      ["Чистый денежный поток", netCash],
      ["Маркетинговые расходы", props.finance.marketing],
      ["Неатрибутированные маркетинговые расходы", props.unallocatedMarketingSpend],
      ["Новые клиенты", props.newCustomers],
      ["Возвраты", props.returns.count],
      ["Сумма возвратов", props.returns.refunds],
      ["Срабатывания автоматизаций", props.automation.runs],
      ["События безопасности", props.security.events],
      ["Предупреждения безопасности", props.security.warnings],
      [],
      ["Канал", "Выручка", "Прибыль", "Заказы", "Расход", "ROI"],
      ...props.channels.map((channel) => [
        channelMeta(channel.channel).label,
        channel.revenue,
        channel.profit,
        channel.orders,
        channel.spent,
        channel.roi === null ? "Не задан" : `${channel.roi.toFixed(1)}%`,
      ]),
    ];
    exportXLSX(["Показатель", "Значение", "", "", "", ""], rows, `delis-owner-report-${props.range.from}-${props.range.to}`);
    toast("Отчёт Owner выгружен в Excel", "ok");
  };

  return (
    <>
      <PageHeader
        title="Отчёты Owner"
        subtitle="Единый проверяемый срез продаж, денег, каналов, автоматизаций и безопасности"
        actions={<button className="btn btn-primary" type="button" onClick={exportReport}><Download size={15} /> Экспорт Excel</button>}
      />

      <Card hover={false} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="muted">С</span>
          <input className="input" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="muted">По</span>
          <input className="input" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button type="button" className="btn" onClick={applyRange}><Filter size={15} /> Обновить</button>
        <span className="text-xs muted ml-auto">Максимальный период: 366 дней</span>
      </Card>

      <StatGrid
        stats={[
          { label: "Выручка заказов", value: props.sales.revenue, color: "#8b5cf6", icon: "💰" },
          { label: "Валовая прибыль", value: props.sales.profit, color: "#22c55e", icon: "📈" },
          { label: "Денежный поток", value: netCash, color: netCash >= 0 ? "#14b8a6" : "#ef4444", icon: "🏦" },
          { label: "Заказы", value: props.sales.orders, color: "#3b82f6", icon: "🧾", mode: "num" },
          { label: "Новые клиенты", value: props.newCustomers, color: "#ec4899", icon: "👥", mode: "num" },
          { label: "Автоматизации", value: props.automation.runs, color: "#f97316", icon: "⚡", mode: "num" },
        ]}
      />

      <div className="grid gap-[var(--gap)] xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <h3 className="font-semibold mb-3">Продажи и валовая прибыль по дням</h3>
          <Lines
            data={props.byDay.map((row) => ({ day: row.day, revenue: row.revenue, profit: row.profit }))}
            keys={[{ key: "revenue", name: "Выручка", color: "#8b5cf6" }, { key: "profit", name: "Валовая прибыль", color: "#22c55e" }]}
            height={300}
          />
        </Card>
        <Card>
          <h3 className="font-semibold mb-3">Контроль исполнения</h3>
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <div className="flex justify-between mb-1"><span className="muted">Доставлено</span><span>{deliveryRate.toFixed(1)}%</span></div>
              <Progress value={deliveryRate} color="#22c55e" />
            </div>
            <div>
              <div className="flex justify-between mb-1"><span className="muted">Валовая маржа</span><span>{margin.toFixed(1)}%</span></div>
              <Progress value={Math.max(0, margin)} color="#8b5cf6" />
            </div>
            <div className="rounded-2xl p-3" style={{ background: "rgba(var(--table-row))" }}>
              <div className="text-xs muted">Возвраты за период</div>
              <div className="font-semibold mt-1">{props.returns.count} · {money(props.returns.refunds)}</div>
            </div>
            <div className="rounded-2xl p-3" style={{ background: "rgba(var(--table-row))" }}>
              <div className="text-xs muted">Сценарии в очереди</div>
              <div className="font-semibold mt-1">{props.automation.queued}</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-[var(--gap)] xl:grid-cols-3">
        <Card hover={false} className="!p-0 xl:col-span-2">
          <div className="card-pad pb-2 flex items-center justify-between gap-3">
            <h3 className="font-semibold">Доходность каналов</h3>
            <Badge color={props.unallocatedMarketingSpend > 0 ? "#f97316" : "#22c55e"}>
              {props.unallocatedMarketingSpend > 0 ? `Не распределено: ${compact(props.unallocatedMarketingSpend)}` : "Все расходы атрибутированы"}
            </Badge>
          </div>
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>Канал</th><th>Выручка</th><th>Прибыль</th><th>Заказы</th><th>Расход</th><th>ROI</th></tr></thead>
              <tbody>
                {props.channels.map((channel) => {
                  const meta = channelMeta(channel.channel);
                  return (
                    <tr key={channel.channel || "unallocated"}>
                      <td><Badge color={meta.color}>{meta.label}</Badge></td>
                      <td className="font-semibold">{money(channel.revenue)}</td>
                      <td>{money(channel.profit)}</td>
                      <td>{channel.orders}</td>
                      <td>{money(channel.spent)}</td>
                      <td><Badge color={channel.roi === null ? "#94a3b8" : channel.roi >= 0 ? "#22c55e" : "#ef4444"}>{channel.roi === null ? "Не задан" : `${channel.roi >= 0 ? "+" : ""}${channel.roi.toFixed(0)}%`}</Badge></td>
                    </tr>
                  );
                })}
                {props.channels.length === 0 && <tr><td colSpan={6} className="muted">За выбранный период данных нет.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <h3 className="font-semibold mb-3">Выручка по каналам</h3>
          <Bars data={props.channels.map((channel) => ({ name: channelMeta(channel.channel).label, value: channel.revenue }))} height={260} color="var(--primary)" />
        </Card>
      </div>

      <div className="grid gap-[var(--gap)] xl:grid-cols-3">
        <Card>
          <div className="flex items-center gap-2 mb-3"><ShieldCheck size={18} color={props.security.warnings > 0 ? "#f97316" : "#22c55e"} /><h3 className="font-semibold">Контроль безопасности</h3></div>
          <div className="text-2xl font-bold">{props.security.events}</div>
          <div className="text-sm muted mt-1">событий входа и безопасности</div>
          <Badge color={props.security.warnings > 0 ? "#f97316" : "#22c55e"}>{props.security.warnings > 0 ? `${props.security.warnings} требуют внимания` : "Предупреждений нет"}</Badge>
        </Card>
        <Card>
          <h3 className="font-semibold mb-3">Воронка статусов</h3>
          <div className="flex flex-col gap-2.5">
            {props.byStatus.map((row) => {
              const status = statusMeta(row.status);
              const share = (row.count / Math.max(...props.byStatus.map((item) => item.count), 1)) * 100;
              return <div key={row.status}><div className="flex justify-between text-xs mb-1"><Badge color={status.color}>{status.label}</Badge><span className="muted">{row.count}</span></div><Progress value={share} color={status.color} /></div>;
            })}
            {props.byStatus.length === 0 && <div className="text-sm muted">Заказов нет</div>}
          </div>
        </Card>
        <Card>
          <h3 className="font-semibold mb-3">Топ клиентов за период</h3>
          <div className="flex flex-col gap-3">
            {props.topCustomers.map((customer) => (
              <div key={customer.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0"><div className="font-medium truncate">{customer.firstName} {customer.lastName}</div><div className="text-xs muted">{customer.orders} заказов</div></div>
                <span className="font-semibold whitespace-nowrap">{compact(customer.revenue)}</span>
              </div>
            ))}
            {props.topCustomers.length === 0 && <div className="text-sm muted">Данных нет</div>}
          </div>
        </Card>
      </div>
    </>
  );
}
