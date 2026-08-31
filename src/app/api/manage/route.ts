import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canManageUsers } from "@/server/auth";
import { hashPassword, passwordValidationError, verifyPassword } from "@/server/password";
import { requireManageAction } from "@/server/apiAuth";
import { recordAuditEvent } from "@/server/audit";
import { requestIp } from "@/server/request";
import { isStaffRole } from "@/shared/config/access";
import { recordSyncEvent, syncEverything, recordBroadcast, createPromocode, toggleMarketingTrigger, createSupplier, createPurchaseOrder, receivePurchaseOrder, createReturn, approveReturn, addCourier, assignDelivery, completeDelivery, addAgentVisit, createAgentStoreOrder, createTask, updateTaskStatus, deleteTask, sendAgentMessage, saveIntegration, testTelegramBot, sendTelegramMessage, saveArticle, deleteArticle, resetDemoData, publishSurface, saveSeoSettings, createInstagramPost, saveMiniAppBanners } from "@/server/queries";

export const dynamic = "force-dynamic";

interface ManageBody {
  action: string;
  data?: Record<string, unknown>;
}

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Password, status, and role changes invalidate any half-complete 2FA flow. */
async function invalidateTwoFactorArtifacts(userId: number, removeBackupCodes = false) {
  await db.delete(s.twoFactorChallenges).where(eq(s.twoFactorChallenges.userId, userId));
  await db.delete(s.twoFactorEnrollments).where(eq(s.twoFactorEnrollments.userId, userId));
  if (removeBackupCodes) {
    await db.delete(s.twoFactorBackupCodes).where(eq(s.twoFactorBackupCodes.userId, userId));
  }
}

export async function POST(req: NextRequest) {
  let body: ManageBody;
  try {
    body = (await req.json()) as ManageBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Не указано действие" }, { status: 400 });
  }

  const authorization = await requireManageAction(req, body.action);
  if (!authorization.ok) return authorization.response;
  const { user } = authorization;
  const ip = requestIp(req);
  const d = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
  const owner = canManageUsers(user.role);
  const canConfigureIntegrations = user.role === "owner" || user.role === "admin";

  try {
    switch (body.action) {
      case "createUser": {
        if (!owner) return NextResponse.json({ error: "Только Owner может создавать аккаунты" }, { status: 403 });
        const name = str(d.name).trim().slice(0, 120);
        const login = str(d.login).trim().toLowerCase().replace(/\s+/g, "");
        const password = str(d.password);
        const role = str(d.role, "manager");
        const passwordError = passwordValidationError(password);
        if (!name || !login || passwordError) {
          return NextResponse.json({ error: !name || !login ? "Имя и логин обязательны" : passwordError }, { status: 400 });
        }
        if (!/^[a-z0-9._-]{3,24}$/.test(login)) {
          return NextResponse.json({ error: "Логин: 3–24 символа, латиница/цифры/точка/дефис" }, { status: 400 });
        }
        if (!isStaffRole(role)) {
          return NextResponse.json({ error: "Можно создать только сотрудника. В системе может быть только один Owner." }, { status: 400 });
        }
        const exists = await db.select({ id: s.users.id }).from(s.users).where(sql`lower(${s.users.login}) = ${login}`).limit(1);
        if (exists.length > 0) return NextResponse.json({ error: `Логин «${login}» уже занят` }, { status: 409 });

        let agentId: number | null = null;
        if (role === "agent") {
          const requestedAgentId = num(d.agentId);
          if (!Number.isSafeInteger(requestedAgentId) || requestedAgentId <= 0) {
            return NextResponse.json({ error: "Для роли Agent выберите профиль агента" }, { status: 400 });
          }
          const [agent] = await db.select({ id: s.agents.id }).from(s.agents).where(eq(s.agents.id, requestedAgentId)).limit(1);
          if (!agent) return NextResponse.json({ error: "Профиль агента не найден" }, { status: 404 });
          const assigned = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.agentId, agent.id)).limit(1);
          if (assigned.length > 0) return NextResponse.json({ error: "Этот профиль агента уже привязан к сотруднику" }, { status: 409 });
          agentId = agent.id;
        }

        const [created] = await db
          .insert(s.users)
          .values({
            name,
            login,
            email: str(d.email).trim().toLowerCase().slice(0, 200),
            role,
            agentId,
            passwordHash: hashPassword(password),
            status: "active",
          })
          .returning();
        await recordAuditEvent({
          actor: user,
          action: "создал аккаунт сотрудника",
          entity: `@${login} · ${role}`,
          entityType: "user",
          entityId: created.id,
          eventType: "security",
          severity: "info",
          ip,
          metadata: { role, agentId },
        });
        return NextResponse.json({ ok: true, id: created.id });
      }
      case "updateUserRole": {
        if (!owner) return NextResponse.json({ error: "Только Owner может назначать роли" }, { status: 403 });
        const id = num(d.id);
        const role = str(d.role);
        if (!Number.isSafeInteger(id) || id <= 0 || !isStaffRole(role)) {
          return NextResponse.json({ error: "Некорректный сотрудник или роль" }, { status: 400 });
        }
        const [target] = await db.select().from(s.users).where(eq(s.users.id, id)).limit(1);
        if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
        if (target.role === "owner") return NextResponse.json({ error: "Роль единственного Owner нельзя изменить" }, { status: 403 });

        let agentId: number | null = null;
        if (role === "agent") {
          const requestedAgentId = num(d.agentId);
          if (!Number.isSafeInteger(requestedAgentId) || requestedAgentId <= 0) {
            return NextResponse.json({ error: "Для роли Agent выберите профиль агента" }, { status: 400 });
          }
          const [agent] = await db.select({ id: s.agents.id }).from(s.agents).where(eq(s.agents.id, requestedAgentId)).limit(1);
          if (!agent) return NextResponse.json({ error: "Профиль агента не найден" }, { status: 404 });
          const assigned = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.agentId, agent.id)).limit(1);
          if (assigned.some((assignedUser) => assignedUser.id !== target.id)) {
            return NextResponse.json({ error: "Этот профиль агента уже привязан к сотруднику" }, { status: 409 });
          }
          agentId = agent.id;
        }

        await db.update(s.users).set({ role, agentId }).where(eq(s.users.id, id));
        // Revoke existing sessions so a changed role takes effect immediately in every tab/device.
        await db.delete(s.sessions).where(eq(s.sessions.userId, id));
        await invalidateTwoFactorArtifacts(id);
        await recordAuditEvent({
          actor: user,
          action: "изменил роль сотрудника",
          entity: `@${target.login} → ${role}`,
          entityType: "user",
          entityId: target.id,
          eventType: "security",
          severity: "warning",
          ip,
          metadata: { previousRole: target.role, role, agentId },
        });
        return NextResponse.json({ ok: true, reloginRequired: true });
      }
      case "setUserStatus": {
        if (!owner) return NextResponse.json({ error: "Только Owner может блокировать аккаунты" }, { status: 403 });
        const id = num(d.id);
        const status = str(d.status);
        if (!Number.isSafeInteger(id) || id <= 0 || !["active", "blocked"].includes(status)) {
          return NextResponse.json({ error: "Некорректный пользователь или статус" }, { status: 400 });
        }
        const [target] = await db.select().from(s.users).where(eq(s.users.id, id)).limit(1);
        if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
        if (target.role === "owner") return NextResponse.json({ error: "Нельзя заблокировать Owner-аккаунт" }, { status: 403 });
        await db.update(s.users).set({ status }).where(eq(s.users.id, id));
        if (status === "blocked") {
          await db.delete(s.sessions).where(eq(s.sessions.userId, id));
          await invalidateTwoFactorArtifacts(id);
        }
        await recordAuditEvent({
          actor: user,
          action: status === "blocked" ? "заблокировал аккаунт" : "разблокировал аккаунт",
          entity: `@${target.login}`,
          entityType: "user",
          entityId: target.id,
          eventType: "security",
          severity: status === "blocked" ? "warning" : "info",
          ip,
          metadata: { status },
        });
        return NextResponse.json({ ok: true });
      }
      case "resetPassword": {
        if (!owner) return NextResponse.json({ error: "Только Owner может менять пароли" }, { status: 403 });
        const id = num(d.id);
        if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный пользователь" }, { status: 400 });
        const password = str(d.password);
        const passwordError = passwordValidationError(password);
        if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
        const [target] = await db.select().from(s.users).where(eq(s.users.id, id)).limit(1);
        if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
        await db.update(s.users).set({ passwordHash: hashPassword(password) }).where(eq(s.users.id, id));
        await db.delete(s.sessions).where(eq(s.sessions.userId, id));
        await invalidateTwoFactorArtifacts(id);
        await recordAuditEvent({
          actor: user,
          action: "сбросил пароль сотрудника",
          entity: `@${target.login}`,
          entityType: "user",
          entityId: target.id,
          eventType: "security",
          severity: "critical",
          ip,
          metadata: { accessRevoked: true },
        });
        return NextResponse.json({ ok: true, reloginRequired: id === user.id });
      }
      case "deleteUser": {
        if (!owner) return NextResponse.json({ error: "Только Owner может удалять аккаунты" }, { status: 403 });
        const id = num(d.id);
        if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный пользователь" }, { status: 400 });
        const [target] = await db.select().from(s.users).where(eq(s.users.id, id));
        if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
        if (target.role === "owner" || target.id === user.id) return NextResponse.json({ error: "Нельзя удалить Owner-аккаунт" }, { status: 403 });
        await db.delete(s.sessions).where(eq(s.sessions.userId, id));
        await invalidateTwoFactorArtifacts(id, true);
        await db.delete(s.users).where(eq(s.users.id, id));
        await recordAuditEvent({
          actor: user,
          action: "удалил аккаунт",
          entity: `@${target.login}`,
          entityType: "user",
          entityId: target.id,
          eventType: "security",
          severity: "critical",
          ip,
          metadata: { role: target.role, accessRevoked: true },
        });
        return NextResponse.json({ ok: true });
      }
      case "createAgent": {
        const [a] = await db
          .insert(s.agents)
          .values({
            name: str(d.name, "Новый агент"),
            region: str(d.region, "Toshkent"),
            route: str(d.route),
            plan: String(num(d.plan)),
            commission: num(d.commission, 7),
            phone: str(d.phone),
            telegram: str(d.telegram),
            email: str(d.email),
            avatarColor: ["#8b5cf6", "#3b82f6", "#22c55e", "#f97316", "#ec4899"][Math.floor(Math.random() * 5)],
          })
          .returning();
        await db.insert(s.activity).values({ actor: user.name, action: "добавил агента", entity: a.name });
        return NextResponse.json({ ok: true, id: a.id });
      }
      case "addTransaction": {
        const [t] = await db
          .insert(s.transactions)
          .values({
            kind: str(d.kind, "income") === "expense" ? "expense" : "income",
            category: str(d.category, "sales"),
            account: str(d.account, "click"),
            amount: String(num(d.amount)),
            note: str(d.note, "Операция из CRM"),
          })
          .returning();
        await db.insert(s.activity).values({ actor: user.name, action: `провёл операцию «${t.kind === "income" ? "доход" : "расход"}»`, entity: t.note });
        return NextResponse.json({ ok: true, id: t.id });
      }
      case "updateContent": {
        await db
          .update(s.contentBlocks)
          .set({ title: str(d.title), body: str(d.body), enabled: Boolean(d.enabled), updatedAt: new Date() })
          .where(eq(s.contentBlocks.id, num(d.id)));
        return NextResponse.json({ ok: true });
      }
      case "saveNote": {
        await db.update(s.customers).set({ notes: str(d.notes) }).where(eq(s.customers.id, num(d.id)));
        return NextResponse.json({ ok: true });
      }
      case "saveTemplate": {
        await db.insert(s.templates).values({ title: str(d.title, "Шаблон"), body: str(d.body) });
        return NextResponse.json({ ok: true });
      }
      case "notify": {
        await db.insert(s.activity).values({ actor: user.name, action: str(d.title, "Уведомление"), entity: str(d.body) });
        await recordSyncEvent({ source: "crm", target: str(d.channel, "internal"), entity: "notification", action: "notification_sent", payload: { title: str(d.title, "Уведомление") } });
        return NextResponse.json({ ok: true });
      }
      case "syncEverything": {
        await syncEverything(user.name);
        return NextResponse.json({ ok: true });
      }
      case "sendBroadcast": {
        const attachments = Array.isArray(d.attachments) ? (d.attachments as string[]) : [];
        const media = Array.isArray(d.media) ? d.media : [];
        const rawBody = str(d.body);
        const bodyForHistory = media.length > 0
          ? JSON.stringify({ text: rawBody, attachments, media })
          : rawBody;
        const b = await recordBroadcast({
          title: str(d.title, "Рассылка"),
          body: bodyForHistory,
          recipients: num(d.recipients),
          channel: str(d.channel, "telegram"),
          status: str(d.status, "sent"),
          scheduledAt: d.scheduledAt ? new Date(String(d.scheduledAt)) : null,
          createdBy: user.name,
        });
        await db.insert(s.activity).values({
          actor: user.name,
          action: `отправил рассылку ${num(d.recipients)} клиентам`,
          entity: `${str(d.title, "Рассылка")} · ${attachments.length} вложений · ${media.length} файлов`,
        });
        await recordSyncEvent({
          source: "crm",
          target: str(d.channel, "telegram"),
          entity: "broadcast",
          action: "broadcast_sent",
          payload: { recipients: num(d.recipients), attachments: attachments.length, media: media.length },
        });
        return NextResponse.json({ ok: true, id: b.id, attachments: attachments.length, media: media.length });
      }
      case "importProducts": {
        const rows = Array.isArray(d.rows) ? (d.rows as { name?: string; price?: number; cost?: number; stock?: number; volume?: string }[]) : [];
        let count = 0;
        for (const r of rows) {
          const name = str(r.name).trim();
          if (!name) continue;
          await db.insert(s.products).values({
            name,
            slug: name.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-"),
            sku: `DLS-${Math.floor(Math.random() * 9000 + 1000)}`,
            price: String(num(r.price)),
            cost: String(num(r.cost)),
            stock: num(r.stock),
            volume: str(r.volume, "1 L"),
            image: "🧴",
          });
          count++;
        }
        await db.insert(s.activity).values({ actor: user.name, action: `импортировал ${count} товаров из CSV`, entity: "PIM" });
        return NextResponse.json({ ok: true, count });
      }
      case "inventory": {
        const items = Array.isArray(d.items) ? (d.items as { productId?: number; fact?: number }[]) : [];
        let count = 0;
        for (const it of items) {
          const pid = num(it.productId);
          if (!pid) continue;
          const [p] = await db.select().from(s.products).where(eq(s.products.id, pid));
          if (!p) continue;
          const fact = num(it.fact, p.stock);
          const diff = fact - p.stock;
          if (diff === 0) continue;
          await db.update(s.products).set({ stock: fact }).where(eq(s.products.id, pid));
          await db.insert(s.stockMoves).values({ productId: pid, kind: diff > 0 ? "in" : "writeoff", qty: Math.abs(diff), note: "Инвентаризация" });
          count++;
        }
        await db.insert(s.activity).values({ actor: user.name, action: `провёл инвентаризацию (${count} корректировок)`, entity: "Склад №1" });
        return NextResponse.json({ ok: true, count });
      }
      case "sendOrderToClient": {
        const [order] = await db.select().from(s.orders).where(eq(s.orders.id, num(d.orderId)));
        if (!order || !order.customerId) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
        await db.insert(s.messages).values({
          customerId: order.customerId,
          fromAdmin: true,
          body: `Здравствуйте! Ваш заказ ${order.number} на сумму ${order.total} сум. Статус: ${order.status}. Счёт и чек прикреплены 📄`,
          kind: "invoice",
        });
        return NextResponse.json({ ok: true });
      }
      case "createPromocode": {
        const code = str(d.code).trim().toUpperCase();
        if (!code || code.length < 3) {
          return NextResponse.json({ error: "Код промокода должен быть не менее 3 символов" }, { status: 400 });
        }
        const promo = await createPromocode({
          code,
          discountType: str(d.discountType, "percent"),
          discountValue: num(d.discountValue, 15),
          minOrderAmount: num(d.minOrderAmount, 100000),
          maxUses: num(d.maxUses, 100),
          validUntil: d.validUntil ? new Date(str(d.validUntil)) : null,
          actor: user.name,
        });
        return NextResponse.json({ ok: true, id: promo.id });
      }
      case "toggleMarketingTrigger": {
        const trig = await toggleMarketingTrigger(num(d.id), Boolean(d.isActive), user.name);
        return NextResponse.json({ ok: true, id: trig?.id });
      }
      case "createSupplier": {
        const name = str(d.name).trim();
        if (!name) return NextResponse.json({ error: "Укажите название поставщика" }, { status: 400 });
        const sup = await createSupplier({
          name,
          contactPerson: str(d.contactPerson),
          phone: str(d.phone),
          email: str(d.email),
          city: str(d.city, "Tashkent"),
          category: str(d.category, "chemicals"),
          leadTimeDays: num(d.leadTimeDays, 7),
          actor: user.name,
        });
        return NextResponse.json({ ok: true, id: sup.id });
      }
      case "createPurchaseOrder": {
        const items = Array.isArray(d.items) ? (d.items as { productId?: number; qty?: number }[]) : [];
        const parsed = items
          .map((i) => ({ productId: num(i.productId), qty: num(i.qty, 1) }))
          .filter((i) => i.productId > 0);
        const po = await createPurchaseOrder({
          supplierId: num(d.supplierId),
          items: parsed,
          notes: str(d.notes),
          actor: user.name,
        });
        return NextResponse.json({ ok: true, id: po.id, number: po.number });
      }
      case "receivePurchaseOrder": {
        const res = await receivePurchaseOrder(num(d.id), user.name);
        return NextResponse.json({ ok: true, items: res.items });
      }
      case "createReturn": {
        const ret = await createReturn({ orderId: num(d.orderId), reason: str(d.reason, "defect"), notes: str(d.notes), actor: user.name });
        return NextResponse.json({ ok: true, id: ret.id });
      }
      case "approveReturn": {
        await approveReturn(num(d.id), Boolean(d.restock), user.name);
        return NextResponse.json({ ok: true });
      }
      case "addCourier": {
        const c = await addCourier({ name: str(d.name), phone: str(d.phone), vehicle: str(d.vehicle, "car"), zone: str(d.zone, "Tashkent"), actor: user.name });
        return NextResponse.json({ ok: true, id: c.id });
      }
      case "assignDelivery": {
        const del = await assignDelivery({ orderId: num(d.orderId), courierId: num(d.courierId), address: str(d.address), city: str(d.city, "Tashkent"), notes: str(d.notes), actor: user.name });
        return NextResponse.json({ ok: true, id: del.id });
      }
      case "completeDelivery": {
        await completeDelivery(num(d.id), user.name);
        return NextResponse.json({ ok: true });
      }
      case "addAgentVisit": {
        const agentId = num(d.agentId);
        if (!Number.isSafeInteger(agentId) || agentId <= 0) return NextResponse.json({ error: "Выберите агента" }, { status: 400 });
        if (user.role === "agent" && user.agentId !== agentId) {
          return NextResponse.json({ error: "Нельзя добавлять визиты за другого агента" }, { status: 403 });
        }
        const storeName = str(d.storeName).trim();
        if (!storeName) return NextResponse.json({ error: "Укажите название торговой точки" }, { status: 400 });
        const visit = await addAgentVisit({
          agentId,
          storeName,
          storeAddress: str(d.storeAddress),
          gpsCoords: str(d.gpsCoords),
          status: str(d.status, "order_placed"),
          orderTotal: num(d.orderTotal, 0),
          notes: str(d.notes),
          photos: Array.isArray(d.photos) ? (d.photos as string[]) : [],
          actor: user.name,
        });
        return NextResponse.json({ ok: true, id: visit.id });
      }
      case "createTask": {
        const title = str(d.title).trim();
        if (!title) return NextResponse.json({ error: "Укажите название задачи" }, { status: 400 });
        const t = await createTask({
          title,
          description: str(d.description),
          assignee: str(d.assignee),
          priority: str(d.priority, "mid"),
          linkType: str(d.linkType),
          linkLabel: str(d.linkLabel),
          dueAt: d.dueAt ? new Date(str(d.dueAt)) : null,
          actor: user.name,
        });
        return NextResponse.json({ ok: true, id: t.id });
      }
      case "updateTaskStatus": {
        await updateTaskStatus(num(d.id), str(d.status, "todo"), user.name);
        return NextResponse.json({ ok: true });
      }
      case "deleteTask": {
        await deleteTask(num(d.id));
        return NextResponse.json({ ok: true });
      }
      case "sendAgentMessage": {
        const agentId = num(d.agentId);
        const text = str(d.body).trim();
        if (!Number.isSafeInteger(agentId) || agentId <= 0 || !text || text.length > 4_000) {
          return NextResponse.json({ error: "Некорректное сообщение" }, { status: 400 });
        }
        if (user.role === "agent" && user.agentId !== agentId) {
          return NextResponse.json({ error: "Нет доступа к переписке другого агента" }, { status: 403 });
        }
        const m = await sendAgentMessage(agentId, text, user.role !== "agent");
        return NextResponse.json({ ok: true, id: m.id });
      }
      case "saveIntegration": {
        if (!canConfigureIntegrations) return NextResponse.json({ error: "Только Owner или Admin может менять интеграции" }, { status: 403 });
        const creds = (d.credentials as Record<string, string>) ?? {};
        const i = await saveIntegration({ key: str(d.key), credentials: creds, enabled: Boolean(d.enabled), actor: user.name });
        return NextResponse.json({ ok: true, id: i?.id, status: i?.status });
      }
      case "testTelegram": {
        const res = await testTelegramBot(str(d.token));
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
        return NextResponse.json({ ok: true, username: res.username, name: res.name });
      }
      case "sendTelegram": {
        const res = await sendTelegramMessage(str(d.chatId), str(d.text));
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
        return NextResponse.json({ ok: true });
      }
      case "setupOrderNotifications": {
        const chatId = str(d.chatId);
        const existingCreds = (await db.select().from(s.integrations).where(eq(s.integrations.key, "telegram_bot")).limit(1))[0]?.credentials ?? {};
        const token = str(d.token) || existingCreds.token || "";
        if (!chatId || !token) return NextResponse.json({ error: "Укажите Chat ID и токен бота" }, { status: 400 });
        // Сохраняем в интеграции
        await db.update(s.integrations).set({
          credentials: { ...existingCreds, token, ownerChatId: chatId },
          enabled: true,
          status: "connected",
          lastCheckAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(s.integrations.key, "telegram_bot"));
        // Также сохраняем в contentBlocks для обратной совместимости
        const existing = await db.select().from(s.contentBlocks).where(and(eq(s.contentBlocks.surface, "telegram"), eq(s.contentBlocks.key, "notifications"))).limit(1);
        if (existing.length > 0) {
          await db.update(s.contentBlocks).set({ body: JSON.stringify({ ownerChatId: chatId, enabled: true }) }).where(eq(s.contentBlocks.id, existing[0].id));
        } else {
          await db.insert(s.contentBlocks).values({ surface: "telegram", key: "notifications", title: "Telegram уведомления", body: JSON.stringify({ ownerChatId: chatId, enabled: true }) });
        }
        // Отправляем тестовое
        const testRes = await sendTelegramMessage(chatId, "🔔 DELIS CRM: Уведомления о заказах подключены!\n\nВы будете получать сообщения при каждом новом заказе.");
        if (!testRes.ok) return NextResponse.json({ error: testRes.error }, { status: 400 });
        return NextResponse.json({ ok: true });
      }
      case "saveArticle": {
        const title = str(d.title).trim();
        if (!title) return NextResponse.json({ error: "Укажите заголовок статьи" }, { status: 400 });
        const a = await saveArticle({
          id: d.id ? num(d.id) : undefined,
          title, category: str(d.category, "general"), content: str(d.content),
          icon: str(d.icon, "📄"), isPinned: Boolean(d.isPinned), actor: user.name,
        });
        return NextResponse.json({ ok: true, id: a?.id });
      }
      case "deleteArticle": {
        await deleteArticle(num(d.id));
        return NextResponse.json({ ok: true });
      }
      case "publishSite": {
        await publishSurface(str(d.target, "website"), user.name);
        return NextResponse.json({ ok: true });
      }
      case "saveSeo": {
        await saveSeoSettings((d.seo as Record<string, string>) ?? {}, user.name);
        return NextResponse.json({ ok: true });
      }
      case "changePassword": {
        if (!owner) return NextResponse.json({ error: "Паролями управляет только Owner" }, { status: 403 });
        const [userRow] = await db.select().from(s.users).where(eq(s.users.id, user.id)).limit(1);
        if (!userRow) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
        if (!verifyPassword(str(d.currentPassword), userRow.passwordHash)) {
          return NextResponse.json({ error: "Неверный текущий пароль" }, { status: 403 });
        }
        const passwordError = passwordValidationError(str(d.newPassword));
        if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
        await db.update(s.users).set({ passwordHash: hashPassword(str(d.newPassword)) }).where(eq(s.users.id, userRow.id));
        await db.delete(s.sessions).where(eq(s.sessions.userId, user.id));
        await invalidateTwoFactorArtifacts(user.id);
        await recordAuditEvent({
          actor: user,
          action: "сменил пароль Owner",
          entity: "свой аккаунт",
          entityType: "user",
          entityId: user.id,
          eventType: "security",
          severity: "critical",
          ip,
          metadata: { accessRevoked: true },
        });
        return NextResponse.json({ ok: true, reloginRequired: true });
      }
      case "changeLogin": {
        if (!owner) return NextResponse.json({ error: "Логином Owner управляет только Owner" }, { status: 403 });
        const [userRow] = await db.select().from(s.users).where(eq(s.users.id, user.id)).limit(1);
        if (!userRow) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
        if (!verifyPassword(str(d.currentPassword), userRow.passwordHash)) {
          return NextResponse.json({ error: "Неверный пароль" }, { status: 403 });
        }
        const newLogin = str(d.newLogin).trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,24}$/.test(newLogin)) {
          return NextResponse.json({ error: "Недопустимый логин" }, { status: 400 });
        }
        const exists = await db.select({ id: s.users.id }).from(s.users).where(sql`lower(${s.users.login}) = ${newLogin}`).limit(1);
        if (exists.some((existing) => existing.id !== user.id)) return NextResponse.json({ error: "Логин уже занят" }, { status: 409 });
        await db.update(s.users).set({ login: newLogin }).where(eq(s.users.id, userRow.id));
        await invalidateTwoFactorArtifacts(user.id);
        await recordAuditEvent({
          actor: user,
          action: "сменил логин Owner",
          entity: `@${newLogin}`,
          entityType: "user",
          entityId: user.id,
          eventType: "security",
          severity: "warning",
          ip,
          metadata: { previousLogin: userRow.login, login: newLogin },
        });
        return NextResponse.json({ ok: true, login: newLogin });
      }
      case "createInstagramPost": {
        const media = Array.isArray(d.mediaUrls) ? (d.mediaUrls as string[]) : [];
        if (media.length === 0) return NextResponse.json({ error: "Добавьте фото или видео" }, { status: 400 });
        const p = await createInstagramPost({
          type: str(d.type, "post"), caption: str(d.caption),
          mediaUrls: media, scheduledAt: str(d.scheduledAt), actor: user.name,
        });
        return NextResponse.json({ ok: true, id: p.id });
      }
      case "saveMiniAppBanners": {
        const banners = Array.isArray(d.banners) ? (d.banners as string[]) : [];
        await saveMiniAppBanners(banners, user.name);
        return NextResponse.json({ ok: true, count: banners.length });
      }
      case "resetDemoData": {
        if (user.role !== "owner") return NextResponse.json({ error: "Только Owner может очистить данные" }, { status: 403 });
        await resetDemoData(user.name, Boolean(d.keepSettings ?? true));
        return NextResponse.json({ ok: true });
      }
      case "sendPush": {
        const event = str(d.event);
        const title = str(d.title);
        const body = str(d.body);
        const [tg] = await db.select().from(s.integrations).where(eq(s.integrations.key, "telegram_bot")).limit(1);
        const [cfg] = await db.select().from(s.contentBlocks).where(and(eq(s.contentBlocks.surface, "telegram"), eq(s.contentBlocks.key, "notifications"))).limit(1);
        let chatId: string | undefined;
        if (cfg && cfg.body) {
          try { chatId = JSON.parse(cfg.body).ownerChatId; } catch { /* */ }
        }
        if (!chatId) chatId = tg?.credentials?.ownerChatId;
        const token = tg?.credentials?.token;
        if (chatId && token) {
          try {
            const text = `<b>🔔 ${title}</b>\n\n${body}`;
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
              signal: AbortSignal.timeout(5000),
            });
          } catch { /* */ }
        }
        await db.insert(s.activity).values({ actor: user.name, action: `push: ${event}`, entity: title });
        return NextResponse.json({ ok: true });
      }
      case "createAgentStoreOrder": {
        const agentId = num(d.agentId);
        if (!Number.isSafeInteger(agentId) || agentId <= 0) return NextResponse.json({ error: "Выберите агента" }, { status: 400 });
        if (user.role === "agent" && user.agentId !== agentId) {
          return NextResponse.json({ error: "Нельзя оформлять заказ за другого агента" }, { status: 403 });
        }
        const storeName = str(d.storeName).trim().slice(0, 200);
        if (!storeName) return NextResponse.json({ error: "Укажите название торговой точки" }, { status: 400 });
        const items = Array.isArray(d.items) ? (d.items as { productId?: number; qty?: number }[]) : [];
        if (items.length === 0 || items.length > 100) return NextResponse.json({ error: "Добавьте от 1 до 100 товаров" }, { status: 400 });
        const parsed = items.map((i) => ({ productId: num(i.productId), qty: num(i.qty, 1) }));
        if (parsed.some((i) => !Number.isSafeInteger(i.productId) || i.productId <= 0 || !Number.isSafeInteger(i.qty) || i.qty <= 0 || i.qty > 100_000)) {
          return NextResponse.json({ error: "Некорректные товары или количество" }, { status: 400 });
        }
        const order = await createAgentStoreOrder({
          agentId,
          storeName,
          storeAddress: str(d.storeAddress),
          items: parsed,
          notes: str(d.notes),
          actor: user.name,
        });
        return NextResponse.json({ ok: true, id: order.id, number: order.number });
      }
      default:
        return NextResponse.json({ error: `Неизвестное действие: ${body.action}` }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка сервера";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
