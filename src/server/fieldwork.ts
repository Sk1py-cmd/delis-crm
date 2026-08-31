import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import type { SessionUser } from "@/server/auth";
import { recordAuditEvent } from "@/server/audit";
import {
  MAX_ROUTE_STOPS,
  MAX_VISIT_PHOTOS,
  MAX_VISIT_PHOTO_DATA_URL_LENGTH,
  canManageFieldwork,
  fieldworkRouteDate,
  isAgentVisitStatus,
  isRouteDate,
} from "@/shared/config/fieldwork";

export class FieldworkError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "FieldworkError";
  }
}

type Input = Record<string, unknown>;

type RouteStopInput = {
  storeName: string;
  storeAddress: string;
  notes: string;
  plannedLatitude: number | null;
  plannedLongitude: number | null;
};

function shortText(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function requiredText(value: unknown, label: string, max: number) {
  const result = shortText(value, max);
  if (!result) throw new FieldworkError(`Укажите ${label}`);
  return result;
}

function positiveId(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new FieldworkError(`Некорректный ${label}`);
  }
  return value;
}

function optionalId(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  return positiveId(value, label);
}

function numberInRange(value: unknown, label: string, min: number, max: number, required = true) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new FieldworkError(`Укажите ${label}`);
    return null;
  }
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new FieldworkError(`Некорректное значение: ${label}`);
  }
  return parsed;
}

function capturedAt(value: unknown) {
  if (value === undefined || value === null || value === "") return new Date();
  if (typeof value !== "string") throw new FieldworkError("Некорректное время GPS-фиксации");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new FieldworkError("Некорректное время GPS-фиксации");
  const now = Date.now();
  if (date.getTime() > now + 5 * 60_000 || date.getTime() < now - 90 * 24 * 60 * 60_000) {
    throw new FieldworkError("Время GPS-фиксации вне допустимого диапазона");
  }
  return date;
}

function syncKey(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(value)) {
    throw new FieldworkError("Некорректный идентификатор офлайн-операции");
  }
  return value;
}

function photos(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_VISIT_PHOTOS) {
    throw new FieldworkError(`Можно приложить до ${MAX_VISIT_PHOTOS} фотографий`);
  }
  return value.map((photo) => {
    if (
      typeof photo !== "string"
      || photo.length > MAX_VISIT_PHOTO_DATA_URL_LENGTH
      || !/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(photo)
    ) {
      throw new FieldworkError("Фотоотчёт должен содержать допустимые сжатые изображения");
    }
    return photo;
  });
}

function routeDate(value: unknown, fallback = fieldworkRouteDate()) {
  const date = shortText(value, 10, fallback);
  if (!isRouteDate(date)) throw new FieldworkError("Выберите корректную дату маршрута");
  return date;
}

function routeStops(value: unknown): RouteStopInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ROUTE_STOPS) {
    throw new FieldworkError(`Маршрут должен содержать от 1 до ${MAX_ROUTE_STOPS} точек`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new FieldworkError(`Некорректная точка маршрута №${index + 1}`);
    }
    const stop = item as Record<string, unknown>;
    const plannedLatitude = numberInRange(stop.plannedLatitude, "широта точки", -90, 90, false);
    const plannedLongitude = numberInRange(stop.plannedLongitude, "долгота точки", -180, 180, false);
    if ((plannedLatitude === null) !== (plannedLongitude === null)) {
      throw new FieldworkError("Для плановой точки укажите обе GPS-координаты");
    }
    return {
      storeName: requiredText(stop.storeName, `название точки №${index + 1}`, 220),
      storeAddress: shortText(stop.storeAddress, 400),
      notes: shortText(stop.notes, 1_000),
      plannedLatitude,
      plannedLongitude,
    };
  });
}

function assertFieldworkAccess(viewer: SessionUser) {
  if (viewer.role !== "agent" && !canManageFieldwork(viewer.role)) {
    throw new FieldworkError("Недостаточно прав для полевого модуля", 403);
  }
}

function assertFieldworkManager(viewer: SessionUser) {
  if (!canManageFieldwork(viewer.role)) {
    throw new FieldworkError("Маршрутами управляет только руководитель", 403);
  }
}

async function activeAgent(agentId: number) {
  const [agent] = await db
    .select({ id: s.agents.id, name: s.agents.name, status: s.agents.status, region: s.agents.region })
    .from(s.agents)
    .where(eq(s.agents.id, agentId))
    .limit(1);
  if (!agent || agent.status !== "active") throw new FieldworkError("Агент не найден или неактивен", 404);
  return agent;
}

async function agentForMutation(viewer: SessionUser, inputAgentId: unknown) {
  assertFieldworkAccess(viewer);
  if (viewer.role === "agent") {
    if (!viewer.agentId) throw new FieldworkError("К аккаунту не привязан профиль агента", 403);
    const requested = optionalId(inputAgentId, "агент");
    if (requested !== null && requested !== viewer.agentId) {
      throw new FieldworkError("Нельзя отправлять данные за другого агента", 403);
    }
    return activeAgent(viewer.agentId);
  }
  return activeAgent(positiveId(inputAgentId, "агент"));
}

function canonicalGps(latitude: number, longitude: number) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function canManageAgentFieldwork(role: string) {
  return canManageFieldwork(role);
}

/** Returns only the daily route that the current actor is permitted to see. */
export async function getAgentRoutes(viewer: SessionUser, requestedDate?: string) {
  await ensureSeed();
  assertFieldworkAccess(viewer);
  const day = requestedDate && isRouteDate(requestedDate) ? requestedDate : fieldworkRouteDate();
  const manager = canManageFieldwork(viewer.role);
  if (!manager && !viewer.agentId) throw new FieldworkError("К аккаунту не привязан профиль агента", 403);

  const routes = await db
    .select({
      id: s.agentRoutes.id,
      agentId: s.agentRoutes.agentId,
      agentName: s.agents.name,
      agentRegion: s.agents.region,
      routeDate: s.agentRoutes.routeDate,
      title: s.agentRoutes.title,
      notes: s.agentRoutes.notes,
      status: s.agentRoutes.status,
      assignedByName: s.agentRoutes.assignedByName,
      updatedAt: s.agentRoutes.updatedAt,
      createdAt: s.agentRoutes.createdAt,
    })
    .from(s.agentRoutes)
    .innerJoin(s.agents, eq(s.agentRoutes.agentId, s.agents.id))
    .where(and(
      eq(s.agentRoutes.routeDate, day),
      manager ? sql`1=1` : eq(s.agentRoutes.agentId, viewer.agentId!),
    ))
    .orderBy(asc(s.agents.name), asc(s.agentRoutes.createdAt));

  const routeIds = routes.map((route) => route.id);
  const stops = routeIds.length
    ? await db
      .select({
        id: s.agentRouteStops.id,
        routeId: s.agentRouteStops.routeId,
        sequence: s.agentRouteStops.sequence,
        storeName: s.agentRouteStops.storeName,
        storeAddress: s.agentRouteStops.storeAddress,
        plannedLatitude: s.agentRouteStops.plannedLatitude,
        plannedLongitude: s.agentRouteStops.plannedLongitude,
        status: s.agentRouteStops.status,
        visitId: s.agentRouteStops.visitId,
        notes: s.agentRouteStops.notes,
        completedAt: s.agentRouteStops.completedAt,
      })
      .from(s.agentRouteStops)
      .where(inArray(s.agentRouteStops.routeId, routeIds))
      .orderBy(asc(s.agentRouteStops.sequence), asc(s.agentRouteStops.id))
    : [];

  const stopsByRoute = new Map<number, typeof stops>();
  for (const stop of stops) stopsByRoute.set(stop.routeId, [...(stopsByRoute.get(stop.routeId) ?? []), stop]);
  return {
    routeDate: day,
    routes: routes.map((route) => ({
      ...route,
      stops: stopsByRoute.get(route.id) ?? [],
    })),
  };
}

/** Management route planner. Existing routes can be replaced only before a stop is recorded. */
export async function saveAgentRoute(viewer: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  assertFieldworkManager(viewer);
  const agentId = positiveId(input.agentId, "агент");
  const agent = await activeAgent(agentId);
  const day = routeDate(input.routeDate);
  const title = requiredText(input.title, "название маршрута", 220);
  const notes = shortText(input.notes, 2_000);
  const stops = routeStops(input.stops);
  const now = new Date();

  const route = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: s.agentRoutes.id, status: s.agentRoutes.status })
      .from(s.agentRoutes)
      .where(and(eq(s.agentRoutes.agentId, agentId), eq(s.agentRoutes.routeDate, day)))
      .limit(1);

    let routeId: number;
    if (existing) {
      if (existing.status !== "planned") {
        throw new FieldworkError("Нельзя заменить уже начатый или завершённый маршрут", 409);
      }
      const [completed] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(s.agentRouteStops)
        .where(and(eq(s.agentRouteStops.routeId, existing.id), eq(s.agentRouteStops.status, "visited")));
      if (Number(completed?.count ?? 0) > 0) {
        throw new FieldworkError("В маршруте уже есть выполненные точки", 409);
      }
      await tx
        .update(s.agentRoutes)
        .set({ title, notes, assignedByUserId: viewer.id, assignedByName: viewer.name, updatedAt: now })
        .where(eq(s.agentRoutes.id, existing.id));
      await tx.delete(s.agentRouteStops).where(eq(s.agentRouteStops.routeId, existing.id));
      routeId = existing.id;
    } else {
      const [created] = await tx
        .insert(s.agentRoutes)
        .values({
          agentId,
          routeDate: day,
          title,
          notes,
          status: "planned",
          assignedByUserId: viewer.id,
          assignedByName: viewer.name,
          updatedAt: now,
        })
        .returning({ id: s.agentRoutes.id });
      if (!created) throw new FieldworkError("Не удалось создать маршрут", 500);
      routeId = created.id;
    }

    await tx.insert(s.agentRouteStops).values(stops.map((stop, index) => ({
      routeId,
      sequence: index + 1,
      storeName: stop.storeName,
      storeAddress: stop.storeAddress,
      plannedLatitude: stop.plannedLatitude === null ? null : String(stop.plannedLatitude),
      plannedLongitude: stop.plannedLongitude === null ? null : String(stop.plannedLongitude),
      notes: stop.notes,
      updatedAt: now,
    })));
    return { id: routeId };
  });

  await recordAuditEvent({
    actor: viewer,
    action: "сохранил маршрут агента",
    entity: `${agent.name} · ${day}`,
    entityType: "agent_route",
    entityId: route.id,
    eventType: "business",
    severity: "info",
    ip,
    metadata: { agentId, routeDate: day, stops: stops.length },
  });
  return route;
}

/** Object-level visit write: agents can record only their linked profile, managers can backfill. */
export async function recordAgentVisit(viewer: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  const agent = await agentForMutation(viewer, input.agentId);
  const clientSyncKey = syncKey(input.clientMutationId);

  if (clientSyncKey) {
    const [existing] = await db
      .select({ id: s.agentVisits.id, agentId: s.agentVisits.agentId, status: s.agentVisits.status })
      .from(s.agentVisits)
      .where(eq(s.agentVisits.syncKey, clientSyncKey))
      .limit(1);
    if (existing) {
      if (existing.agentId !== agent.id) throw new FieldworkError("Идентификатор офлайн-операции уже использован", 409);
      return { id: existing.id, status: existing.status, duplicate: true };
    }
  }

  const storeName = requiredText(input.storeName, "название торговой точки", 220);
  const storeAddress = shortText(input.storeAddress, 400);
  const maybeLatitude = numberInRange(input.latitude, "широта GPS", -90, 90);
  const maybeLongitude = numberInRange(input.longitude, "долгота GPS", -180, 180);
  // `numberInRange` already reports a client error for a required absent value;
  // keep this narrowing explicit for the database and canonical coordinate snapshot.
  if (maybeLatitude === null || maybeLongitude === null) throw new FieldworkError("Укажите GPS-координаты");
  const latitude = maybeLatitude;
  const longitude = maybeLongitude;
  const accuracyMeters = numberInRange(input.accuracyMeters, "точность GPS", 0, 100_000, false);
  const locationTime = capturedAt(input.locationCapturedAt);
  const status = shortText(input.status, 32, "completed");
  if (!isAgentVisitStatus(status)) throw new FieldworkError("Некорректный результат визита");
  const orderTotal = numberInRange(input.orderTotal, "сумма заказа", 0, 1_000_000_000_000, false) ?? 0;
  if (status === "no_order" && orderTotal > 0) throw new FieldworkError("Для визита без заказа сумма должна быть нулевой");
  const notes = shortText(input.notes, 4_000);
  const visitPhotos = photos(input.photos);
  const routeStopId = optionalId(input.routeStopId, "точка маршрута");
  const now = new Date();
  const source = input.offline === true ? "offline" : "online";

  const visit = await db.transaction(async (tx) => {
    let linkedRouteId: number | null = null;
    if (routeStopId) {
      const [stop] = await tx
        .select({
          id: s.agentRouteStops.id,
          routeId: s.agentRouteStops.routeId,
          stopStatus: s.agentRouteStops.status,
          routeAgentId: s.agentRoutes.agentId,
          routeStatus: s.agentRoutes.status,
        })
        .from(s.agentRouteStops)
        .innerJoin(s.agentRoutes, eq(s.agentRouteStops.routeId, s.agentRoutes.id))
        .where(eq(s.agentRouteStops.id, routeStopId))
        .limit(1);
      if (!stop || stop.routeAgentId !== agent.id) {
        throw new FieldworkError("Точка маршрута не принадлежит этому агенту", 403);
      }
      if (stop.routeStatus === "cancelled" || stop.routeStatus === "completed" || stop.stopStatus !== "planned") {
        throw new FieldworkError("Эта точка маршрута уже недоступна для отметки", 409);
      }
      linkedRouteId = stop.routeId;
    }

    const [created] = await tx
      .insert(s.agentVisits)
      .values({
        agentId: agent.id,
        routeId: linkedRouteId,
        routeStopId,
        storeName,
        storeAddress,
        gpsCoords: canonicalGps(latitude, longitude),
        latitude: String(latitude),
        longitude: String(longitude),
        accuracyMeters: accuracyMeters === null ? null : String(accuracyMeters),
        locationCapturedAt: locationTime,
        status,
        orderTotal: String(orderTotal),
        notes,
        photos: visitPhotos,
        source,
        syncKey: clientSyncKey,
        recordedByUserId: viewer.id,
        recordedByName: viewer.name,
        visitedAt: locationTime,
      })
      .onConflictDoNothing()
      .returning({ id: s.agentVisits.id, status: s.agentVisits.status });

    if (!created) {
      const [existing] = clientSyncKey
        ? await tx
          .select({ id: s.agentVisits.id, agentId: s.agentVisits.agentId, status: s.agentVisits.status })
          .from(s.agentVisits)
          .where(eq(s.agentVisits.syncKey, clientSyncKey))
          .limit(1)
        : [];
      if (existing?.agentId === agent.id) return { id: existing.id, status: existing.status, duplicate: true };
      throw new FieldworkError("Не удалось сохранить визит", 409);
    }

    if (routeStopId) {
      const [updatedStop] = await tx
        .update(s.agentRouteStops)
        .set({ status: "visited", visitId: created.id, completedAt: now, updatedAt: now })
        .where(and(eq(s.agentRouteStops.id, routeStopId), eq(s.agentRouteStops.status, "planned")))
        .returning({ id: s.agentRouteStops.id });
      if (!updatedStop) throw new FieldworkError("Точку маршрута уже отметил другой визит", 409);

      await tx
        .update(s.agentRoutes)
        .set({ status: "in_progress", updatedAt: now })
        .where(and(eq(s.agentRoutes.id, linkedRouteId!), eq(s.agentRoutes.status, "planned")));
      const [remaining] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(s.agentRouteStops)
        .where(and(eq(s.agentRouteStops.routeId, linkedRouteId!), eq(s.agentRouteStops.status, "planned")));
      if (Number(remaining?.count ?? 0) === 0) {
        await tx
          .update(s.agentRoutes)
          .set({ status: "completed", updatedAt: now })
          .where(eq(s.agentRoutes.id, linkedRouteId!));
      }
    }

    await tx
      .update(s.agents)
      .set({
        visits: sql`${s.agents.visits} + 1`,
        fact: orderTotal > 0 ? sql`${s.agents.fact} + ${orderTotal}` : s.agents.fact,
      })
      .where(eq(s.agents.id, agent.id));

    return { ...created, duplicate: false };
  });

  if (!visit.duplicate) {
    await recordAuditEvent({
      actor: viewer,
      action: "зафиксировал GPS-визит агента",
      entity: storeName,
      entityType: "agent_visit",
      entityId: visit.id,
      eventType: "business",
      severity: "info",
      ip,
      metadata: {
        agentId: agent.id,
        routeStopId,
        status,
        photoCount: visitPhotos.length,
        source,
        hasOrder: orderTotal > 0,
      },
    });
  }
  return visit;
}

/** Object-level visit read for agent portal and manager monitoring. */
export async function getFieldworkVisits(viewer: SessionUser, requestedAgentId?: number) {
  await ensureSeed();
  assertFieldworkAccess(viewer);
  const manager = canManageFieldwork(viewer.role);
  const agentId = manager
    ? (requestedAgentId ? positiveId(requestedAgentId, "агент") : null)
    : viewer.agentId;
  if (!manager && !agentId) throw new FieldworkError("К аккаунту не привязан профиль агента", 403);

  return db
    .select({
      id: s.agentVisits.id,
      agentId: s.agentVisits.agentId,
      agentName: s.agents.name,
      storeName: s.agentVisits.storeName,
      storeAddress: s.agentVisits.storeAddress,
      gpsCoords: s.agentVisits.gpsCoords,
      latitude: s.agentVisits.latitude,
      longitude: s.agentVisits.longitude,
      accuracyMeters: s.agentVisits.accuracyMeters,
      locationCapturedAt: s.agentVisits.locationCapturedAt,
      routeId: s.agentVisits.routeId,
      routeStopId: s.agentVisits.routeStopId,
      status: s.agentVisits.status,
      orderTotal: s.agentVisits.orderTotal,
      notes: s.agentVisits.notes,
      photos: s.agentVisits.photos,
      source: s.agentVisits.source,
      recordedByName: s.agentVisits.recordedByName,
      visitedAt: s.agentVisits.visitedAt,
      createdAt: s.agentVisits.createdAt,
    })
    .from(s.agentVisits)
    .innerJoin(s.agents, eq(s.agentVisits.agentId, s.agents.id))
    .where(agentId ? eq(s.agentVisits.agentId, agentId) : sql`1=1`)
    .orderBy(desc(s.agentVisits.visitedAt), desc(s.agentVisits.id))
    .limit(200);
}
