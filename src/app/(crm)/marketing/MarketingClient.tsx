"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Tag,
  Zap,
  TrendingUp,
  Plus,
  Percent,
  CheckCircle2,
  Users,
  Sparkles,
  DollarSign,
  Target,
  BarChart3,
  Calendar,
} from "lucide-react";
import { Card, PageHeader, Badge, Progress, Modal, Tabs } from "@/shared/ui/kit";
import { Bars } from "@/shared/ui/charts";
import { money, compact, dt, dateOnly } from "@/shared/lib/format";
import { useToast } from "@/shared/ui/Toast";
import { postManage } from "@/shared/lib/manage";
import { useT } from "@/shared/i18n/useT";

export interface PromocodeLite {
  id: number;
  code: string;
  discountType: string;
  discountValue: string;
  minOrderAmount: string;
  maxUses: number;
  usedCount: number;
  status: string;
  validUntil: string | null;
  createdAt: string;
}

export interface TriggerLite {
  id: number;
  title: string;
  eventKey: string;
  actionType: string;
  messageBody: string;
  discountBonus: number;
  isActive: boolean;
  triggeredCount: number;
}

export interface CampaignLite {
  id: number;
  title: string;
  body: string;
  channel: string;
  recipients: number;
  delivered: number;
  status: string;
  createdAt: string;
}

export interface AutomationRunLite {
  id: number;
  eventKey: string;
  actionType: string;
  status: string;
  createdAt: string;
  triggerTitle: string;
  customerName: string;
  customerSource: string;
}

export interface AdChannelLite {
  key: string;
  name: string;
  spent: number;
  revenue: number;
  profit: number;
  leads: number;
  orders: number;
  conversion: number | null;
  roi: number | null;
  color: string;
}

export function MarketingClient({
  promos,
  triggers,
  campaigns,
  recentRuns,
  adChannels,
  totalSales,
  ordersCount,
  canRunAutomations,
}: {
  promos: PromocodeLite[];
  triggers: TriggerLite[];
  campaigns: CampaignLite[];
  recentRuns: AutomationRunLite[];
  adChannels: AdChannelLite[];
  totalSales: number;
  ordersCount: number;
  canRunAutomations: boolean;
}) {
  const [tab, setTab] = useState("promos");
  const [openModal, setOpenModal] = useState(false);
  const [form, setForm] = useState({
    code: "",
    discountType: "percent",
    discountValue: "15",
    minOrderAmount: "100000",
    maxUses: "200",
    validUntil: "",
  });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const tr = useT();
  const router = useRouter();

  const totalPromoUsage = promos.reduce((sum, p) => sum + p.usedCount, 0);
  const activePromosCount = promos.filter((p) => p.status === "active").length;
  const totalTriggersCount = triggers.reduce((sum, t) => sum + t.triggeredCount, 0);

  const attributedChannels = adChannels.filter((channel) => channel.roi !== null);
  const avgRoi = attributedChannels.length
    ? Math.round(attributedChannels.reduce((sum, channel) => sum + (channel.roi ?? 0), 0) / attributedChannels.length)
    : null;

  const handleCreatePromo = async () => {
    if (!form.code.trim()) {
      toast("Введите код промокода", "err");
      return;
    }
    setBusy(true);
    try {
      await postManage("createPromocode", {
        code: form.code,
        discountType: form.discountType,
        discountValue: Number(form.discountValue) || 10,
        minOrderAmount: Number(form.minOrderAmount) || 0,
        maxUses: Number(form.maxUses) || 100,
        validUntil: form.validUntil ? form.validUntil : null,
      });
      toast(`Промокод ${form.code.toUpperCase()} успешно создан`, "ok");
      setOpenModal(false);
      setForm({
        code: "",
        discountType: "percent",
        discountValue: "15",
        minOrderAmount: "100000",
        maxUses: "200",
        validUntil: "",
      });
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка создания промокода", "err");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleTrigger = async (id: number, currentStatus: boolean, title: string) => {
    try {
      await postManage("toggleMarketingTrigger", {
        id,
        isActive: !currentStatus,
      });
      toast(
        `Триггер «${title}» ${!currentStatus ? "включён" : "выключен"}`,
        "ok",
      );
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка обновления триггера", "err");
    }
  };

  const handleRunSleepingCustomers = async () => {
    setBusy(true);
    try {
      const result = await postManage("runCustomerAutomations");
      toast(`Проверено клиентов: ${result.customers ?? 0}. Запущено сценариев: ${result.runs ?? 0}.`, "ok");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось запустить автоматизацию", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={tr("marketing.title")}
        subtitle={tr("marketing.subtitle")}
        actions={
          <button
            onClick={() => setOpenModal(true)}
            className="btn btn-primary"
          >
            <Plus size={16} /> {tr("marketing.createPromo")}
          </button>
        }
      />

      {/* KPI карточки */}
      <div className="grid gap-[var(--gap)] grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        {[
          {
            label: tr("marketing.revenueByChannels"),
            value: compact(totalSales),
            color: "#8b5cf6",
            icon: "💰",
          },
          {
            label: tr("marketing.avgRoi"),
            value: avgRoi === null ? "—" : `${avgRoi}%`,
            color: "#22c55e",
            icon: "📈",
          },
          {
            label: tr("marketing.activePromos"),
            value: activePromosCount,
            color: "#0ea5e9",
            icon: "🏷️",
          },
          {
            label: tr("marketing.activations"),
            value: totalPromoUsage,
            color: "#ec4899",
            icon: "🎁",
          },
          {
            label: tr("marketing.triggersFired"),
            value: totalTriggersCount,
            color: "#f59e0b",
            icon: "⚡",
          },
          {
            label: tr("marketing.budget"),
            value: compact(adChannels.reduce((sum, c) => sum + c.spent, 0)),
            color: "#14b8a6",
            icon: "🎯",
          },
        ].map((s, i) => (
          <Card key={s.label} delay={i * 0.04}>
            <div className="text-[0.72rem] uppercase tracking-wider muted">
              {s.label}
            </div>
            <div
              className="text-xl font-semibold mt-2"
              style={{ color: s.color }}
            >
              {s.icon} {s.value}
            </div>
          </Card>
        ))}
      </div>

      {/* Вкладки навигации по разделу маркетинга */}
      <Card hover={false} className="flex flex-wrap items-center gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: "promos", label: tr("marketing.tabPromos"), count: promos.length },
            { key: "triggers", label: tr("marketing.tabTriggers"), count: triggers.length },
            { key: "channels", label: tr("marketing.tabChannels") },
          ]}
        />
      </Card>

      {/* Контент вкладок */}
      {tab === "promos" && (
        <div className="grid gap-[var(--gap)] xl:grid-cols-3">
          <Card hover={false} className="!p-0 xl:col-span-2">
            <div className="card-pad pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag size={18} color="var(--primary)" />
                <h3 className="font-semibold">Список промокодов</h3>
              </div>
              <Badge color="#8b5cf6">
                Активны и синхронизированы: Сайт · Mini App · Bot
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>{tr("marketing.code")}</th>
                    <th>{tr("marketing.discount")}</th>
                    <th>{tr("marketing.minOrder")}</th>
                    <th>{tr("marketing.used")}</th>
                    <th>{tr("common.status")}</th>
                    <th>{tr("marketing.validUntil")}</th>
                  </tr>
                </thead>
                <tbody>
                  {promos.map((p) => {
                    const usagePercent = Math.min(
                      100,
                      Math.round((p.usedCount / Math.max(1, p.maxUses)) * 100),
                    );
                    return (
                      <tr key={p.id}>
                        <td>
                          <span
                            className="chip font-mono font-bold"
                            style={{
                              color: "var(--primary)",
                              borderColor: "color-mix(in srgb, var(--primary) 35%, transparent)",
                              background: "color-mix(in srgb, var(--primary) 12%, transparent)",
                            }}
                          >
                            {p.code}
                          </span>
                        </td>
                        <td className="font-semibold">
                          {p.discountType === "percent"
                            ? `${p.discountValue}%`
                            : money(p.discountValue)}
                        </td>
                        <td className="muted">{money(p.minOrderAmount)}</td>
                        <td>
                          <div className="min-w-[120px]">
                            <div className="flex justify-between text-xs mb-1">
                              <span>
                                {p.usedCount} / {p.maxUses}
                              </span>
                              <span className="muted">{usagePercent}%</span>
                            </div>
                            <Progress
                              value={usagePercent}
                              color={
                                usagePercent >= 90
                                  ? "var(--warning)"
                                  : "var(--primary)"
                              }
                            />
                          </div>
                        </td>
                        <td>
                          <Badge
                            color={p.status === "active" ? "#22c55e" : "#6b7280"}
                          >
                            {p.status === "active" ? "Активен" : "На паузе"}
                          </Badge>
                        </td>
                        <td className="muted whitespace-nowrap">
                          {p.validUntil ? dateOnly(p.validUntil) : tr("marketing.unlimited")}
                        </td>
                      </tr>
                    );
                  })}
                  {promos.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted text-center py-8">
                        Промокодов пока нет — нажмите кнопку «Создать промокод»
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={18} color="var(--primary)" />
              <h3 className="font-semibold">Как работают скидки</h3>
            </div>
            <p className="text-sm muted leading-relaxed">
              Созданный промокод фиксируется в CRM и передаётся в очередь синхронизации для подключённых каналов:
            </p>
            <div className="flex flex-col gap-3 mt-4">
              {[
                {
                  title: "Telegram Mini App корзина",
                  desc: "Клиент вводит код при оформлении, скидка применяется автоматически.",
                },
                {
                  title: "Telegram Bot",
                  desc: "Поддержка команды /promo и автоматический расчёт скидки.",
                },
                {
                  title: "Официальный сайт",
                  desc: "Синхронизация через API со складом и прайс-листами.",
                },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl p-3"
                  style={{ background: "rgba(var(--table-row))" }}
                >
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="text-xs muted mt-1">{item.desc}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "triggers" && (
        <div className="grid gap-[var(--gap)] xl:grid-cols-3">
          <Card hover={false} className="xl:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Zap size={18} color="var(--warning)" />
                <h3 className="font-semibold">
                  Автоматические маркетинговые триггеры (Воронки)
                </h3>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge color="#f97316">
                  Заказы запускают VIP-сценарии автоматически
                </Badge>
                {canRunAutomations && (
                  <button type="button" className="btn text-xs" disabled={busy} onClick={() => void handleRunSleepingCustomers()}>
                    <Zap size={14} /> {busy ? "Запускаем…" : "Проверить неактивных"}
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {triggers.map((trig) => (
                <div
                  key={trig.id}
                  className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  style={{
                    background: "rgba(var(--table-row))",
                    border: "1px solid rgba(var(--border))",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-base">
                        {trig.title}
                      </span>
                      <Badge
                        color={trig.isActive ? "#22c55e" : "#6b7280"}
                      >
                        {trig.isActive ? "Активен" : "Выключен"}
                      </Badge>
                    </div>
                    <p className="text-sm muted mt-1 leading-relaxed">
                      {trig.messageBody}
                    </p>
                    <div className="flex items-center gap-4 mt-3 text-xs muted">
                      <span>
                        <b>Бонус:</b> +{trig.discountBonus}
                        {trig.actionType === "bonus_points"
                          ? " баллов"
                          : "% скидка"}
                      </span>
                      <span>
                        <b>Сработал:</b> {trig.triggeredCount} раз
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      handleToggleTrigger(
                        trig.id,
                        trig.isActive,
                        trig.title,
                      )
                    }
                    className="btn self-start sm:self-center shrink-0"
                    style={
                      trig.isActive
                        ? {
                            background: "color-mix(in srgb, #ef4444 18%, transparent)",
                            color: "#ef4444",
                            border: "1px solid color-mix(in srgb, #ef4444 40%, transparent)",
                          }
                        : {
                            background: "color-mix(in srgb, #22c55e 18%, transparent)",
                            color: "#22c55e",
                            border: "1px solid color-mix(in srgb, #22c55e 40%, transparent)",
                          }
                    }
                  >
                    {trig.isActive ? "Выключить" : "Включить триггер"}
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Target size={18} color="var(--primary)" />
              <h3 className="font-semibold">Эффективность триггеров</h3>
            </div>
            <p className="text-sm muted leading-relaxed">
              VIP-сценарий запускается при заказе, а возврат неактивных клиентов Owner запускает по проверяемому списку. Сообщения уходят только клиентам с подтверждённым согласием.
            </p>
            <div className="mt-4 flex flex-col gap-2 max-h-64 overflow-y-auto">
              <div className="text-xs muted uppercase tracking-wider">Последние выполнения</div>
              {recentRuns.map((run) => (
                <div key={run.id} className="rounded-2xl p-3" style={{ background: "rgba(var(--table-row))" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{run.triggerTitle}</span>
                    <Badge color={run.status === "queued" ? "#f97316" : "#22c55e"}>{run.status === "queued" ? "В очереди" : run.status}</Badge>
                  </div>
                  <div className="text-xs muted mt-1 truncate">{run.customerName} · {run.customerSource}</div>
                  <div className="text-xs muted mt-1">{dt(run.createdAt)}</div>
                </div>
              ))}
              {recentRuns.length === 0 && (
                <div className="rounded-2xl p-3 text-sm muted" style={{ background: "rgba(var(--table-row))" }}>
                  Выполнений ещё нет. Сценарии появятся здесь после первого срабатывания.
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === "channels" && (
        <div className="grid gap-[var(--gap)] xl:grid-cols-3">
          <Card hover={false} className="!p-0 xl:col-span-2">
            <div className="card-pad pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 size={18} color="var(--primary)" />
                <h3 className="font-semibold">Каналы продаж и атрибуция</h3>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Badge color="#3b82f6">Заказов: {ordersCount}</Badge>
                <Badge color={avgRoi === null ? "#f97316" : "#22c55e"}>
                  {avgRoi === null ? "Добавьте расходы с каналом" : `Средний ROI: ${avgRoi}%`}
                </Badge>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Канал продвижения</th>
                    <th>Расход</th>
                    <th>Выручка</th>
                    <th>Лиды</th>
                    <th>Заказы</th>
                    <th>Конверсия</th>
                    <th>ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {adChannels.map((c) => (
                    <tr key={c.key || "unallocated"}>
                      <td className="font-semibold">{c.name}</td>
                      <td className="muted">{compact(c.spent)}</td>
                      <td className="font-bold">{compact(c.revenue)}</td>
                      <td>{c.leads}</td>
                      <td>{c.orders}</td>
                      <td>{c.conversion === null ? "—" : `${c.conversion.toFixed(1)}%`}</td>
                      <td>
                        <Badge color={c.roi === null ? "#94a3b8" : c.roi >= 0 ? "#22c55e" : "#ef4444"}>
                          {c.roi === null ? "Не задан" : `${c.roi >= 0 ? "+" : ""}${c.roi.toFixed(0)}%`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {adChannels.length === 0 && (
                    <tr><td colSpan={7} className="muted">Пока нет заказов, лидов или расходов с атрибуцией.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={18} color="var(--accent)" />
              <h3 className="font-semibold">Сравнение окупаемости</h3>
            </div>
            <p className="text-sm muted mb-4">
              ROI считается только там, где маркетинговый расход проведён с указанным каналом. Заказы и лиды берутся из фактических записей CRM.
            </p>
            {attributedChannels.length > 0 ? (
              <Bars
                data={attributedChannels.map((c) => ({
                  name: c.name.split(" ")[0],
                  value: c.roi ?? 0,
                }))}
                height={220}
                color="var(--primary)"
              />
            ) : (
              <div className="rounded-2xl p-4 text-sm muted" style={{ background: "rgba(var(--table-row))" }}>
                Проведите расход в категории «Маркетинг» и выберите канал, чтобы построить ROI.
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Модальное окно создания промокода */}
      {openModal && (
        <Modal
          open={openModal}
          onClose={() => setOpenModal(false)}
          title="Создание нового промокода"
        >
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs muted uppercase tracking-wider block mb-1">
                Код промокода
              </label>
              <input
                className="input font-mono uppercase"
                placeholder="Например: DELIS20"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs muted uppercase tracking-wider block mb-1">
                  Тип скидки
                </label>
                <select
                  className="input"
                  value={form.discountType}
                  onChange={(e) =>
                    setForm({ ...form, discountType: e.target.value })
                  }
                >
                  <option value="percent">Процент (%)</option>
                  <option value="fixed">Фиксированная (сум)</option>
                </select>
              </div>

              <div>
                <label className="text-xs muted uppercase tracking-wider block mb-1">
                  Значение скидки
                </label>
                <input
                  type="number"
                  className="input"
                  placeholder="15"
                  value={form.discountValue}
                  onChange={(e) =>
                    setForm({ ...form, discountValue: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs muted uppercase tracking-wider block mb-1">
                  Минимальный заказ (сум)
                </label>
                <input
                  type="number"
                  className="input"
                  placeholder="100000"
                  value={form.minOrderAmount}
                  onChange={(e) =>
                    setForm({ ...form, minOrderAmount: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="text-xs muted uppercase tracking-wider block mb-1">
                  Лимит активаций (раз)
                </label>
                <input
                  type="number"
                  className="input"
                  placeholder="200"
                  value={form.maxUses}
                  onChange={(e) =>
                    setForm({ ...form, maxUses: e.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <label className="text-xs muted uppercase tracking-wider block mb-1">
                Действует до (необязательно)
              </label>
              <input
                type="date"
                className="input"
                value={form.validUntil}
                onChange={(e) =>
                  setForm({ ...form, validUntil: e.target.value })
                }
              />
            </div>

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleCreatePromo}
                disabled={busy}
                className="btn btn-primary flex-1 justify-center"
              >
                {busy ? "Создаём…" : "Создать промокод"}
              </button>
              <button
                type="button"
                onClick={() => setOpenModal(false)}
                className="btn"
              >
                Отмена
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
