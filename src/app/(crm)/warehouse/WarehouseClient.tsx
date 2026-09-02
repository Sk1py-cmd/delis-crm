"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ClipboardCheck,
  Download,
  PackageCheck,
  Plus,
  ScanLine,
  Trash2,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { Badge, Card, Modal, PageHeader, Progress } from "@/shared/ui/kit";
import { StatGrid } from "@/widgets/StatCard";
import { dt, money, num } from "@/shared/lib/format";
import type { ProductRow } from "@/server/queries";
import { useToast } from "@/shared/ui/Toast";
import { exportXLSX } from "@/shared/lib/excel";
import { BarcodeScannerModal } from "@/shared/ui/BarcodeScannerModal";
import { ProductThumb } from "@/shared/ui/ProductThumb";
import { postInventory } from "@/shared/lib/inventory";

type Warehouse = {
  id: number;
  code: string;
  name: string;
  address: string;
  status: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type Balance = {
  id: number;
  warehouseId: number;
  productId: number;
  onHand: number;
  reserved: number;
  available: number;
  updatedAt: string;
};

type Reservation = {
  id: number;
  warehouseId: number;
  productId: number;
  qty: number;
  status: string;
  orderId: number | null;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
};

type Movement = {
  id: number;
  productName: string;
  kind: string;
  qty: number;
  note: string;
  warehouseId: number | null;
  warehouseName: string;
  actorName: string;
  createdAt: string;
};

type Count = {
  id: number;
  warehouseId: number;
  number: string;
  title: string;
  status: string;
  startedByName: string;
  postedByName: string;
  startedAt: string | null;
  postedAt: string | null;
  createdAt: string;
};

type InventoryData = {
  warehouses: Warehouse[];
  balances: Balance[];
  reservations: Reservation[];
  movements: Movement[];
  counts: Count[];
};

type OperationKind = "receipt" | "issue" | "writeoff" | "transfer";

type ProductBalanceRow = { product: ProductRow; balance: Balance };

const MOVE_META: Record<string, { label: string; color: string }> = {
  receipt: { label: "Приход", color: "#22c55e" },
  issue: { label: "Расход", color: "#3b82f6" },
  writeoff: { label: "Списание", color: "#ef4444" },
  adjustment_gain: { label: "Излишек", color: "#14b8a6" },
  adjustment_loss: { label: "Недостача", color: "#f97316" },
  transfer_out: { label: "Перемещение · отправка", color: "#8b5cf6" },
  transfer_in: { label: "Перемещение · приём", color: "#8b5cf6" },
  in: { label: "Приход (архив)", color: "#22c55e" },
  out: { label: "Расход (архив)", color: "#3b82f6" },
  transfer: { label: "Перемещение (архив)", color: "#8b5cf6" },
};

const OPERATION_META: Record<OperationKind, { title: string; label: string }> = {
  receipt: { title: "Оприходовать товар", label: "Приход" },
  issue: { title: "Выдать товар", label: "Расход" },
  writeoff: { title: "Списать товар", label: "Списание" },
  transfer: { title: "Переместить товар", label: "Перемещение" },
};

function warehouseStatus(status: string) {
  return status === "active" ? { label: "Активен", color: "#22c55e" } : { label: "Архив", color: "#64748b" };
}

export function WarehouseClient({
  products,
  inventory,
  canManageWarehouses,
}: {
  products: ProductRow[];
  inventory: InventoryData;
  canManageWarehouses: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [warehouseId, setWarehouseId] = useState<number>(inventory.warehouses.find((warehouse) => warehouse.isDefault)?.id ?? inventory.warehouses[0]?.id ?? 0);
  const [operation, setOperation] = useState<{ productId: number; kind: OperationKind } | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState("");
  const [scanModal, setScanModal] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [countMap, setCountMap] = useState<Record<number, string>>({});
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [newWarehouse, setNewWarehouse] = useState({ code: "", name: "", address: "" });

  const selectedWarehouse = inventory.warehouses.find((warehouse) => warehouse.id === warehouseId);
  const balanceByProduct = useMemo(
    () => new Map(inventory.balances.filter((balance) => balance.warehouseId === warehouseId).map((balance) => [balance.productId, balance])),
    [inventory.balances, warehouseId],
  );
  const productRows = useMemo<ProductBalanceRow[]>(
    () => products.flatMap((product) => {
      const balance = balanceByProduct.get(product.id);
      return balance ? [{ product, balance }] : [];
    }),
    [balanceByProduct, products],
  );
  const currentMoves = useMemo(
    () => inventory.movements.filter((movement) => movement.warehouseId === warehouseId || (warehouseId === 0 && !movement.warehouseId)),
    [inventory.movements, warehouseId],
  );
  const currentReservations = useMemo(
    () => inventory.reservations.filter((reservation) => reservation.warehouseId === warehouseId && reservation.status === "active"),
    [inventory.reservations, warehouseId],
  );
  const currentCounts = useMemo(
    () => inventory.counts.filter((count) => count.warehouseId === warehouseId),
    [inventory.counts, warehouseId],
  );

  const totalPhysical = productRows.reduce((sum, row) => sum + row.balance.onHand, 0);
  const totalReserved = productRows.reduce((sum, row) => sum + row.balance.reserved, 0);
  const totalAvailable = productRows.reduce((sum, row) => sum + row.balance.available, 0);
  const totalValue = productRows.reduce((sum, row) => sum + row.balance.onHand * Number(row.product.cost), 0);
  const lowRows = productRows.filter((row) => row.balance.available < row.product.lowStock);
  const scanned = products.find((product) => product.barcode === scan.trim() || product.sku.toLowerCase() === scan.trim().toLowerCase());
  const selectedOperationProduct = operation ? products.find((product) => product.id === operation.productId) : undefined;

  const resetOperation = () => {
    setOperation(null);
    setQuantity("1");
    setNote("");
    setDestinationWarehouseId(0);
  };

  const openOperation = (productId: number, kind: OperationKind) => {
    if (!selectedWarehouse) {
      toast("Сначала выберите склад", "err");
      return;
    }
    setQuantity("1");
    setNote("");
    setDestinationWarehouseId(inventory.warehouses.find((warehouse) => warehouse.id !== warehouseId && warehouse.status === "active")?.id ?? 0);
    setOperation({ productId, kind });
  };

  const applyOperation = async () => {
    if (!operation || !selectedWarehouse) return;
    const qty = Number(quantity);
    if (!Number.isSafeInteger(qty) || qty < 1) {
      toast("Введите целое количество больше нуля", "err");
      return;
    }
    if (operation.kind === "transfer" && (!destinationWarehouseId || destinationWarehouseId === warehouseId)) {
      toast("Выберите другой склад назначения", "err");
      return;
    }
    setBusy(true);
    try {
      if (operation.kind === "transfer") {
        await postInventory("transferStock", {
          sourceWarehouseId: warehouseId,
          destinationWarehouseId,
          productId: operation.productId,
          qty,
          note,
        });
      } else {
        await postInventory("adjustStock", {
          warehouseId,
          productId: operation.productId,
          kind: operation.kind,
          qty,
          note,
        });
      }
      toast(`${OPERATION_META[operation.kind].label}: операция проведена`);
      resetOperation();
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Не удалось провести операцию", "err");
    } finally {
      setBusy(false);
    }
  };

  const openCount = () => {
    if (!selectedWarehouse || !productRows.length) {
      toast("На выбранном складе нет позиций для инвентаризации", "err");
      return;
    }
    setCountMap(Object.fromEntries(productRows.map((row) => [row.product.id, String(row.balance.onHand)])));
    setCountOpen(true);
  };

  const applyCount = async () => {
    if (!selectedWarehouse) return;
    const items = productRows.map(({ product, balance }) => ({
      productId: product.id,
      expectedOnHand: balance.onHand,
      countedQty: Number(countMap[product.id] ?? balance.onHand),
    }));
    if (items.some((item) => !Number.isSafeInteger(item.countedQty) || item.countedQty < 0)) {
      toast("Фактические остатки должны быть целыми числами от нуля", "err");
      return;
    }
    setBusy(true);
    try {
      const result = await postInventory("completeInventoryCount", {
        warehouseId,
        title: `Инвентаризация · ${selectedWarehouse.name}`,
        items,
      });
      toast(`Инвентаризация ${result.number ?? ""} проведена: корректировок — ${result.adjustments ?? 0}`);
      setCountOpen(false);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Не удалось провести инвентаризацию", "err");
    } finally {
      setBusy(false);
    }
  };

  const createWarehouse = async () => {
    const code = newWarehouse.code.trim();
    const name = newWarehouse.name.trim();
    if (!code || !name) {
      toast("Укажите код и название склада", "err");
      return;
    }
    setBusy(true);
    try {
      const result = await postInventory("createWarehouse", { code, name, address: newWarehouse.address.trim() });
      toast("Склад создан");
      setWarehouseOpen(false);
      setNewWarehouse({ code: "", name: "", address: "" });
      if (result.warehouse && typeof result.warehouse === "object" && "id" in result.warehouse) {
        setWarehouseId(Number((result.warehouse as { id: number }).id));
      }
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Не удалось создать склад", "err");
    } finally {
      setBusy(false);
    }
  };

  const exportXlsx = () => {
    const headers = ["Склад", "SKU", "Название", "Категория", "Физический остаток", "Резерв", "Доступно", "Себестоимость", "Стоимость"];
    const rows = productRows.map(({ product, balance }) => [
      selectedWarehouse?.name ?? "—",
      product.sku,
      product.name,
      product.category,
      String(balance.onHand),
      String(balance.reserved),
      String(balance.available),
      product.cost,
      String(balance.onHand * Number(product.cost)),
    ]);
    exportXLSX(headers, rows, `delis-warehouse-${selectedWarehouse?.code ?? "stock"}-${new Date().toISOString().slice(0, 10)}`);
    toast("Отчёт по выбранному складу выгружен в XLSX");
  };

  return (
    <>
      <PageHeader
        title="Склад и остатки"
        subtitle="Физические остатки, резервирование и движения по каждому складу"
        actions={
          <>
            <select
              className="input !w-auto !py-2"
              aria-label="Выбрать склад"
              value={warehouseId}
              onChange={(event) => setWarehouseId(Number(event.target.value))}
            >
              {inventory.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id} disabled={warehouse.status !== "active"}>
                  {warehouse.code} · {warehouse.name}{warehouse.isDefault ? " · основной" : ""}
                </option>
              ))}
            </select>
            <button className="btn" onClick={exportXlsx} disabled={!selectedWarehouse}>
              <Download size={15} /> XLSX
            </button>
            {canManageWarehouses && (
              <button className="btn" onClick={() => setWarehouseOpen(true)}>
                <Plus size={15} /> Склад
              </button>
            )}
            <button className="btn" onClick={openCount} disabled={!selectedWarehouse}>
              <ClipboardCheck size={15} /> Инвентаризация
            </button>
            <button className="btn btn-primary" onClick={() => products.find((product) => product.status === "active") && openOperation(products.find((product) => product.status === "active")!.id, "receipt")} disabled={!selectedWarehouse || !products.some((product) => product.status === "active")}>
              <ArrowDownToLine size={15} /> Приход
            </button>
          </>
        }
      />

      {selectedWarehouse ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs muted">
          <Badge color={warehouseStatus(selectedWarehouse.status).color}>{warehouseStatus(selectedWarehouse.status).label}</Badge>
          {selectedWarehouse.isDefault && <Badge color="#8b5cf6">Основной склад</Badge>}
          {selectedWarehouse.address && <span>{selectedWarehouse.address}</span>}
          <span>Обновлено: {dt(productRows.reduce((latest, row) => latest > row.balance.updatedAt ? latest : row.balance.updatedAt, selectedWarehouse.updatedAt))}</span>
        </div>
      ) : (
        <Card className="mt-5" hover={false}>
          <div className="flex items-center gap-3">
            <WarehouseIcon size={22} className="text-[var(--primary)]" />
            <div>
              <div className="font-semibold">Склады ещё не созданы</div>
              <div className="muted text-sm">Создайте первый склад, чтобы начать учитывать остатки.</div>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-5">
        <StatGrid
          stats={[
            { label: "Позиций на складе", value: productRows.length, color: "#8b5cf6", icon: "📦", mode: "num" },
            { label: "Физический остаток", value: totalPhysical, color: "#3b82f6", icon: "🏷️", mode: "num" },
            { label: "В резерве", value: totalReserved, color: "#f97316", icon: "🔒", mode: "num" },
            { label: "Доступно к продаже", value: totalAvailable, color: "#22c55e", icon: "✓", mode: "num" },
            { label: "Стоимость запаса", value: totalValue, color: "#14b8a6", icon: "💎" },
            { label: "Низкий остаток", value: lowRows.length, color: "#ef4444", icon: "⚠️", mode: "num" },
          ]}
        />
      </div>

      <div className="grid gap-[var(--gap)] xl:grid-cols-3">
        <Card>
          <h3 className="font-semibold mb-1">Сканер штрихкода</h3>
          <p className="muted text-xs mb-3">Найдите товар на выбранном складе и проведите операцию.</p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <ScanLine size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 muted" />
              <input className="input !pl-9" placeholder="48600100000 или DLS-1000" value={scan} onChange={(event) => setScan(event.target.value)} />
            </div>
            <button className="btn btn-primary !px-3" onClick={() => setScanModal(true)}>Камера</button>
          </div>
          <div className="mt-4">
            {scanned ? (
              <div className="rounded-2xl p-3" style={{ background: "rgba(var(--table-row))", border: "1px solid rgba(var(--border))" }}>
                <div className="flex items-center gap-3">
                  <ProductThumb src={scanned.image} name={scanned.name} size={38} radius={11} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{scanned.name}</div>
                    <div className="text-xs muted">{scanned.sku} · доступно {num(balanceByProduct.get(scanned.id)?.available ?? 0)} шт</div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button className="btn flex-1 justify-center" onClick={() => openOperation(scanned.id, "receipt")}>Приход</button>
                  <button className="btn flex-1 justify-center" onClick={() => openOperation(scanned.id, "issue")}>Расход</button>
                </div>
              </div>
            ) : (
              <div className="muted text-xs">Введите или отсканируйте SKU / штрихкод.</div>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-semibold">Критические остатки</h3>
              <p className="muted text-xs">Порог сравнивается с доступным, а не с физическим остатком.</p>
            </div>
            <Badge color={lowRows.length ? "#ef4444" : "#22c55e"}>{lowRows.length} поз.</Badge>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {productRows
              .slice()
              .sort((left, right) => left.balance.available - right.balance.available)
              .slice(0, 8)
              .map(({ product, balance }) => (
                <div key={product.id}>
                  <div className="flex justify-between text-[0.8rem] mb-1.5 gap-2">
                    <span className="truncate">{product.name}</span>
                    <span className="font-semibold" style={{ color: balance.available < product.lowStock ? "var(--error)" : "var(--text)" }}>{num(balance.available)}</span>
                  </div>
                  <Progress value={(balance.available / Math.max(product.lowStock * 4, 1)) * 100} color={balance.available < product.lowStock ? "#ef4444" : "#22c55e"} />
                </div>
              ))}
            {!productRows.length && <div className="muted text-sm">Нет складских позиций.</div>}
          </div>
        </Card>
      </div>

      <div className="grid gap-[var(--gap)] xl:grid-cols-2">
        <Card hover={false} className="!p-0">
          <div className="card-pad pb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Остатки по товарам</h3>
              <p className="muted text-xs">При расходе и перемещении доступны только свободные единицы.</p>
            </div>
            {selectedWarehouse && <Badge color="#3b82f6">{selectedWarehouse.code}</Badge>}
          </div>
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table>
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Физич.</th>
                  <th>Резерв</th>
                  <th>Доступно</th>
                  <th>Стоимость</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {productRows.map(({ product, balance }) => (
                  <tr key={product.id}>
                    <td className="min-w-[205px]">
                      <div className="flex items-center gap-2">
                        <ProductThumb src={product.image} name={product.name} size={31} radius={9} />
                        <div className="min-w-0">
                          <div className="truncate max-w-[155px] font-medium">{product.name}</div>
                          <div className="muted text-[11px]">{product.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td>{num(balance.onHand)}</td>
                    <td><span className={balance.reserved ? "text-orange-500 font-medium" : "muted"}>{num(balance.reserved)}</span></td>
                    <td><Badge color={balance.available < product.lowStock ? "#ef4444" : "#22c55e"}>{num(balance.available)} шт</Badge></td>
                    <td className="muted whitespace-nowrap">{money(balance.onHand * Number(product.cost))}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn !px-2 !py-1" title="Приход" onClick={() => openOperation(product.id, "receipt")}><ArrowDownToLine size={13} /></button>
                        <button className="btn !px-2 !py-1" title="Расход" onClick={() => openOperation(product.id, "issue")}><ArrowUpFromLine size={13} /></button>
                        <button className="btn !px-2 !py-1" title="Переместить" onClick={() => openOperation(product.id, "transfer")}><ArrowLeftRight size={13} /></button>
                        <button className="btn !px-2 !py-1" title="Списать" onClick={() => openOperation(product.id, "writeoff")}><Trash2 size={13} color="var(--error)" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!productRows.length && (
                  <tr><td colSpan={6} className="muted text-center py-8">Нет позиций по выбранному складу.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card hover={false} className="!p-0">
          <div className="card-pad pb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">История движений</h3>
              <p className="muted text-xs">Каждое изменение записано в журнале выбранного склада.</p>
            </div>
            <Badge color="#8b5cf6">{currentMoves.length}</Badge>
          </div>
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table>
              <thead>
                <tr>
                  <th>Операция</th>
                  <th>Товар</th>
                  <th>Кол-во</th>
                  <th>Исполнитель</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {currentMoves.map((movement) => {
                  const meta = MOVE_META[movement.kind] ?? { label: movement.kind, color: "#64748b" };
                  return (
                    <tr key={movement.id}>
                      <td><Badge color={meta.color}>{meta.label}</Badge></td>
                      <td className="min-w-[150px]">
                        <div className="font-medium truncate max-w-[190px]">{movement.productName}</div>
                        {movement.note && <div className="muted text-[11px] truncate max-w-[190px]">{movement.note}</div>}
                      </td>
                      <td className="font-semibold">{num(movement.qty)}</td>
                      <td className="muted">{movement.actorName || "—"}</td>
                      <td className="muted whitespace-nowrap">{dt(movement.createdAt)}</td>
                    </tr>
                  );
                })}
                {!currentMoves.length && <tr><td colSpan={5} className="muted text-center py-8">Движений пока нет.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-[var(--gap)] xl:grid-cols-2">
        <Card hover={false}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-semibold">Активные резервы</h3>
              <p className="muted text-xs">Зарезервированные единицы не доступны для расхода и перемещения.</p>
            </div>
            <Badge color={currentReservations.length ? "#f97316" : "#22c55e"}>{currentReservations.length}</Badge>
          </div>
          {currentReservations.length ? (
            <div className="space-y-2">
              {currentReservations.slice(0, 5).map((reservation) => {
                const product = products.find((item) => item.id === reservation.productId);
                return (
                  <div key={reservation.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: "rgba(var(--table-row))" }}>
                    <div className="min-w-0"><div className="font-medium text-sm truncate">{product?.name ?? `Товар #${reservation.productId}`}</div><div className="muted text-xs">{reservation.reason || `Заказ #${reservation.orderId ?? "—"}`}</div></div>
                    <div className="text-right"><div className="font-semibold">{num(reservation.qty)} шт</div><div className="muted text-[11px]">{reservation.expiresAt ? `до ${dt(reservation.expiresAt)}` : "без срока"}</div></div>
                  </div>
                );
              })}
            </div>
          ) : <div className="muted text-sm py-4">Активных резервов на этом складе нет.</div>}
        </Card>

        <Card hover={false}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="font-semibold">Инвентаризации</h3>
              <p className="muted text-xs">Проведение блокирует устаревший снимок, если остаток изменился.</p>
            </div>
            <button className="btn !py-1.5" onClick={openCount}><PackageCheck size={14} /> Новая</button>
          </div>
          {currentCounts.length ? (
            <div className="space-y-2">
              {currentCounts.slice(0, 5).map((count) => (
                <div key={count.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: "rgba(var(--table-row))" }}>
                  <div className="min-w-0"><div className="font-medium text-sm truncate">{count.number}</div><div className="muted text-xs truncate">{count.title}</div></div>
                  <div className="text-right"><Badge color={count.status === "posted" ? "#22c55e" : "#f59e0b"}>{count.status === "posted" ? "Проведена" : "Черновик"}</Badge><div className="muted text-[11px] mt-1">{dt(count.postedAt ?? count.createdAt)}</div></div>
                </div>
              ))}
            </div>
          ) : <div className="muted text-sm py-4">Проведённых инвентаризаций пока нет.</div>}
        </Card>
      </div>

      <Modal open={Boolean(operation)} onClose={resetOperation} title={operation ? OPERATION_META[operation.kind].title : "Складская операция"}>
        {operation && selectedOperationProduct && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: "rgba(var(--table-row))" }}>
              <ProductThumb src={selectedOperationProduct.image} name={selectedOperationProduct.name} size={44} radius={12} />
              <div className="min-w-0"><div className="font-medium truncate">{selectedOperationProduct.name}</div><div className="muted text-xs">{selectedWarehouse?.name} · доступно {num(balanceByProduct.get(selectedOperationProduct.id)?.available ?? 0)} шт</div></div>
            </div>
            {operation.kind === "receipt" && (
              <label className="block text-sm font-medium">Товар
                <select className="input mt-1" value={operation.productId} onChange={(event) => setOperation({ ...operation, productId: Number(event.target.value) })}>
                  {products.filter((product) => product.status === "active").map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
                </select>
              </label>
            )}
            <label className="block text-sm font-medium">Количество<input className="input mt-1" type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            {operation.kind === "transfer" && (
              <label className="block text-sm font-medium">Склад назначения
                <select className="input mt-1" value={destinationWarehouseId} onChange={(event) => setDestinationWarehouseId(Number(event.target.value))}>
                  <option value={0}>Выберите склад</option>
                  {inventory.warehouses.filter((warehouse) => warehouse.id !== warehouseId && warehouse.status === "active").map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
                </select>
              </label>
            )}
            <label className="block text-sm font-medium">Комментарий <span className="muted font-normal">(необязательно)</span><textarea className="input mt-1 min-h-[86px]" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Номер накладной, причина или примечание" /></label>
            <div className="flex justify-end gap-2"><button className="btn" onClick={resetOperation} disabled={busy}>Отмена</button><button className="btn btn-primary" onClick={applyOperation} disabled={busy}>{busy ? "Сохранение…" : OPERATION_META[operation.kind].label}</button></div>
          </div>
        )}
      </Modal>

      <Modal open={countOpen} onClose={() => !busy && setCountOpen(false)} title={`Инвентаризация · ${selectedWarehouse?.name ?? "склад"}`} wide>
        <div className="space-y-4">
          <p className="muted text-sm">Введите фактические количества. Для защиты от расхождения документ будет проведён, только если физический остаток не менялся после открытия этой формы.</p>
          <div className="overflow-x-auto max-h-[48vh] overflow-y-auto rounded-xl" style={{ border: "1px solid rgba(var(--border))" }}>
            <table>
              <thead><tr><th>Товар</th><th>Система</th><th>Резерв</th><th>Факт</th><th>Разница</th></tr></thead>
              <tbody>
                {productRows.map(({ product, balance }) => {
                  const fact = Number(countMap[product.id] ?? balance.onHand);
                  const difference = Number.isFinite(fact) ? fact - balance.onHand : 0;
                  return (
                    <tr key={product.id}>
                      <td className="min-w-[200px]"><div className="font-medium">{product.name}</div><div className="muted text-xs">{product.sku}</div></td>
                      <td>{num(balance.onHand)}</td><td className="muted">{num(balance.reserved)}</td>
                      <td><input className="input !w-[92px] !py-1.5" type="number" min="0" step="1" value={countMap[product.id] ?? String(balance.onHand)} onChange={(event) => setCountMap((current) => ({ ...current, [product.id]: event.target.value }))} /></td>
                      <td className={difference === 0 ? "muted" : difference > 0 ? "text-emerald-500 font-semibold" : "text-red-500 font-semibold"}>{difference > 0 ? "+" : ""}{num(difference)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2"><button className="btn" disabled={busy} onClick={() => setCountOpen(false)}>Отмена</button><button className="btn btn-primary" disabled={busy} onClick={applyCount}>{busy ? "Проведение…" : "Провести инвентаризацию"}</button></div>
        </div>
      </Modal>

      <Modal open={warehouseOpen} onClose={() => !busy && setWarehouseOpen(false)} title="Новый склад">
        <div className="space-y-4">
          <p className="muted text-sm">Основной склад уже назначен. Переназначение основного склада требует отдельной инвентаризационной процедуры.</p>
          <label className="block text-sm font-medium">Код склада<input className="input mt-1 uppercase" maxLength={32} placeholder="NORTH-01" value={newWarehouse.code} onChange={(event) => setNewWarehouse((current) => ({ ...current, code: event.target.value.toUpperCase() }))} /></label>
          <label className="block text-sm font-medium">Название<input className="input mt-1" maxLength={160} placeholder="Северный склад" value={newWarehouse.name} onChange={(event) => setNewWarehouse((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="block text-sm font-medium">Адрес <span className="muted font-normal">(необязательно)</span><input className="input mt-1" maxLength={500} placeholder="Город, улица, ориентир" value={newWarehouse.address} onChange={(event) => setNewWarehouse((current) => ({ ...current, address: event.target.value }))} /></label>
          <div className="flex justify-end gap-2"><button className="btn" disabled={busy} onClick={() => setWarehouseOpen(false)}>Отмена</button><button className="btn btn-primary" disabled={busy} onClick={createWarehouse}>{busy ? "Создание…" : "Создать склад"}</button></div>
        </div>
      </Modal>

      <BarcodeScannerModal open={scanModal} onClose={() => setScanModal(false)} onScan={(code) => { setScan(code); setScanModal(false); }} />
    </>
  );
}
