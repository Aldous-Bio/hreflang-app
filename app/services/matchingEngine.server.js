import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getStoreByShopDomain, totalStoreCount } from "../config/stores.server";
import {
  buildResourceGid,
  fetchResourceDetails,
  setHreflangMetafields,
} from "./shopifyResource.server";
import { isMatchingEnabled } from "./settings.server";

function statusForCount(count) {
  if (count >= totalStoreCount()) return "complete";
  if (count > 1) return "partial";
  return "pending_siblings";
}

async function logMatching(groupId, action, details) {
  await db.matchingLog.create({ data: { groupId, action, details } });
}

async function findOrCreateGroupByHreflangId(hreflangId, resourceType) {
  const existing = await db.hreflangGroup.findUnique({ where: { hreflangId } });
  if (existing) return existing;
  return db.hreflangGroup.create({
    data: { hreflangId, resourceType, status: "pending_siblings" },
  });
}

async function createOrphanGroup(resourceType) {
  const created = await db.hreflangGroup.create({
    data: { resourceType, status: "pending_siblings" },
  });
  return db.hreflangGroup.update({
    where: { id: created.id },
    data: { hreflangId: `auto-${created.id}` },
  });
}

// Solo se usa para productos (resolveGroup y rescanAllPendingGroups excluyen
// colecciones antes de llamar aquí). El SKU es el único identificador real e
// independiente del idioma — si no coincide, no se inventa una pareja por
// parecido de texto (dos "packs" distintos pueden llamarse casi igual sin
// ser el mismo producto). Sin SKU compartido, el producto se queda huérfano.
async function findMatchCandidate(resourceType, storeId, details) {
  if (!details.sku) return null;

  const bySku = await db.hreflangItem.findFirst({
    where: {
      storeId: { not: storeId },
      sku: details.sku,
      group: { resourceType, items: { none: { storeId } } },
    },
  });

  return bySku ? { item: bySku, criteria: "sku", confidence: 95 } : null;
}

// Resolves (and creates if needed) the group a resource event belongs to, following:
// 1. an existing manually/previously-assigned href_lang_id metafield always wins
// 2. otherwise, look for a matching item in another store (sku, then handle similarity)
// 3. otherwise, mint a fresh orphan group
async function resolveGroup({ resourceType, storeId, details, existingItem }) {
  if (details.existingHreflangId) {
    const group = await findOrCreateGroupByHreflangId(
      details.existingHreflangId,
      resourceType,
    );
    return { group, matched: false };
  }

  if (existingItem) {
    const group = await db.hreflangGroup.findUnique({
      where: { id: existingItem.groupId },
    });
    if (group) return { group, matched: false };
  }

  // Las colecciones no tienen SKU — el único criterio posible es la similitud
  // de handle, que entre idiomas no es fiable. Nunca se auto-enlazan solas,
  // solo se sugieren en Pending Review para aprobación manual.
  if (resourceType !== "collection") {
    const candidate = await findMatchCandidate(resourceType, storeId, details);
    if (candidate) {
      const group = await db.hreflangGroup.findUnique({
        where: { id: candidate.item.groupId },
      });
      return { group, matched: true, criteria: candidate.criteria, confidence: candidate.confidence };
    }
  }

  const group = await createOrphanGroup(resourceType);
  return { group, matched: false, isNewOrphan: true };
}

async function recomputeGroupStatus(groupId) {
  const group = await db.hreflangGroup.findUnique({
    where: { id: groupId },
    include: { items: true },
  });
  if (!group) return null;

  const status = statusForCount(group.items.length);
  const data = { status };
  if (status !== "pending_siblings" && !group.firstMatchAt) {
    data.firstMatchAt = new Date();
  }
  if (status === "complete" && !group.completedAt) {
    data.completedAt = new Date();
  }

  return db.hreflangGroup.update({
    where: { id: groupId },
    data,
    include: { items: true },
  });
}

// Quita un item de su grupo (borrado real, o producto pasado a borrador) y
// deja el grupo consistente: lo borra si se queda vacío, o resincroniza el
// resto de miembros si no.
async function removeItemAndCleanupGroup(item, logAction, logDetails) {
  await db.hreflangItem.delete({ where: { id: item.id } });
  await logMatching(item.groupId, logAction, logDetails);

  const remaining = await db.hreflangGroup.findUnique({
    where: { id: item.groupId },
    include: { items: true },
  });
  if (!remaining) return;

  if (remaining.items.length === 0) {
    await db.hreflangGroup.delete({ where: { id: remaining.id } });
    return;
  }

  const updated = await recomputeGroupStatus(remaining.id);
  await pushMetafieldsForGroup(updated);
}

async function pushMetafieldsForGroup(group) {
  for (const item of group.items) {
    const otherItems = group.items.filter((other) => other.id !== item.id);
    // Sin pareja todavía: no tocar custom.href_lang, para no vaciar un valor
    // ya existente (asignado a mano o por otro sistema).
    const otherUrls = otherItems.length === 0 ? null : otherItems.map((other) => other.url);
    await setHreflangMetafields(item.shopDomain, item.shopifyGid, group.hreflangId, otherUrls);
  }
}

// Moves an existing item into a different group — used by the Pending Review
// "approve" action and the Manual Matching page. The item's previous group is
// cleaned up (deleted if left empty, otherwise re-synced).
export async function attachItemToGroup(itemId, targetGroupId, { criteria, confidence } = {}) {
  const item = await db.hreflangItem.findUnique({ where: { id: itemId } });
  if (!item) throw new Error("Item not found");
  if (item.groupId === targetGroupId) return;

  const targetGroup = await db.hreflangGroup.findUnique({
    where: { id: targetGroupId },
    include: { items: true },
  });
  if (!targetGroup) throw new Error("Target group not found");
  if (targetGroup.items.some((existing) => existing.storeId === item.storeId)) {
    throw new Error("Target group already has an item from this store");
  }

  const sourceGroupId = item.groupId;
  await db.hreflangItem.update({ where: { id: itemId }, data: { groupId: targetGroupId } });

  if (criteria) {
    await db.hreflangGroup.update({
      where: { id: targetGroupId },
      data: { matchCriteria: criteria, matchConfidence: confidence ?? null },
    });
  }
  await logMatching(targetGroupId, "manual_attach", { itemId, fromGroupId: sourceGroupId, criteria });

  const sourceRemaining = await db.hreflangItem.count({ where: { groupId: sourceGroupId } });
  if (sourceRemaining === 0) {
    await db.hreflangGroup.delete({ where: { id: sourceGroupId } });
  } else {
    const updatedSource = await recomputeGroupStatus(sourceGroupId);
    await pushMetafieldsForGroup(updatedSource);
  }

  const updatedTarget = await recomputeGroupStatus(targetGroupId);
  await pushMetafieldsForGroup(updatedTarget);
}

export async function handleResourceEvent({ resourceType, action, shopDomain, admin, numericId }) {
  if (!(await isMatchingEnabled())) {
    console.log(`[matchingEngine] matching disabled, ignoring ${resourceType} ${action} ${numericId}`);
    return;
  }

  const store = getStoreByShopDomain(shopDomain);
  if (!store) {
    console.log(`[matchingEngine] shop ${shopDomain} not in STORE_MAP, ignoring ${resourceType} ${action} ${numericId}`);
    return;
  }
  console.log(`[matchingEngine] handling ${resourceType} ${action} ${numericId} for store ${store.storeId}`);

  const gid = buildResourceGid(resourceType, numericId);

  if (action === "delete") {
    const item = await db.hreflangItem.findUnique({
      where: { storeId_shopifyGid: { storeId: store.storeId, shopifyGid: gid } },
    });
    if (!item) return;
    await removeItemAndCleanupGroup(item, "item_deleted", { storeId: store.storeId, gid });
    return;
  }

  const details = await fetchResourceDetails(admin, resourceType, numericId);
  if (!details) return; // resource was deleted before/while we processed the event

  const existingItem = await db.hreflangItem.findUnique({
    where: { storeId_shopifyGid: { storeId: store.storeId, shopifyGid: details.gid } },
  });

  // Los productos en borrador no cuentan: si ya estaba trackeado (de cuando
  // no era borrador), se retira del grupo; si es nuevo, se ignora.
  if (resourceType === "product" && details.status === "DRAFT") {
    console.log(`[matchingEngine] product ${numericId} is DRAFT, skipping`);
    if (existingItem) {
      await removeItemAndCleanupGroup(existingItem, "item_unpublished_draft", {
        storeId: store.storeId,
        gid: details.gid,
      });
    }
    return;
  }

  const { group, matched, criteria, confidence, isNewOrphan } = await resolveGroup({
    resourceType,
    storeId: store.storeId,
    details,
    existingItem,
  });

  await db.hreflangItem.upsert({
    where: { storeId_shopifyGid: { storeId: store.storeId, shopifyGid: details.gid } },
    update: {
      groupId: group.id,
      handle: details.handle,
      title: details.title,
      sku: details.sku,
      url: `${store.publicUrl}${details.path}`,
    },
    create: {
      groupId: group.id,
      storeId: store.storeId,
      shopDomain,
      shopifyGid: details.gid,
      handle: details.handle,
      title: details.title,
      sku: details.sku,
      url: `${store.publicUrl}${details.path}`,
    },
  });

  if (matched) {
    await db.hreflangGroup.update({
      where: { id: group.id },
      data: { matchCriteria: criteria, matchConfidence: confidence },
    });
    await logMatching(group.id, "auto_match", { storeId: store.storeId, criteria, confidence });
  } else if (isNewOrphan) {
    await logMatching(group.id, "created_orphan", { storeId: store.storeId, resourceType });
  } else {
    await logMatching(group.id, "item_synced", { storeId: store.storeId, action });
  }

  const updated = await recomputeGroupStatus(group.id);
  await pushMetafieldsForGroup(updated);
}

// Re-ejecuta el matching sobre todo lo que ya está en la base de datos sin
// completar (huérfanos/parciales). Útil tras corregir STORE_MAP o una
// definición de metacampo — no hace falta esperar a que cada producto se
// vuelva a editar para que dispare un webhook nuevo.
export async function rescanAllPendingGroups() {
  const items = await db.hreflangItem.findMany({
    where: { group: { status: { not: "complete" } } },
  });

  let matchesMade = 0;
  let removed = 0;
  for (const item of items) {
    const current = await db.hreflangItem.findUnique({
      where: { id: item.id },
      include: { group: true },
    });
    if (!current || current.group.status === "complete") continue;

    if (current.group.resourceType === "product") {
      const { admin } = await unauthenticated.admin(current.shopDomain);
      const numericId = current.shopifyGid.split("/").pop();
      const details = await fetchResourceDetails(admin, "product", numericId);

      if (!details) {
        // Ya no existe en Shopify pero seguía en nuestra base de datos.
        await removeItemAndCleanupGroup(current, "item_deleted_on_rescan", { storeId: current.storeId });
        removed++;
        continue;
      }
      if (details.status === "DRAFT") {
        await removeItemAndCleanupGroup(current, "item_unpublished_draft_on_rescan", {
          storeId: current.storeId,
        });
        removed++;
        continue;
      }
    }

    if (current.group.resourceType === "collection") continue; // nunca auto-enlazar, solo sugerir

    const candidate = await findMatchCandidate(current.group.resourceType, current.storeId, {
      sku: current.sku,
      handle: current.handle,
    });
    if (!candidate) continue;

    await attachItemToGroup(current.id, candidate.item.groupId, {
      criteria: candidate.criteria,
      confidence: candidate.confidence,
    });
    matchesMade++;
  }

  return { matchesMade, removed };
}

// SOLO PARA PRUEBAS: agrupa por el valor del campo legado custom.href_lang_id
// (el que se asignaba a mano en el sistema anterior) en vez de por SKU/handle.
// Usado por app/services/legacyImport.server.js. Si el item ya pertenecía a
// otro grupo (p. ej. un auto-match previo), ese grupo antiguo se limpia.
export async function importLegacyGroup(hreflangId, resourceType, itemsData) {
  const group = await findOrCreateGroupByHreflangId(hreflangId, resourceType);
  const staleGroupIds = new Set();

  for (const data of itemsData) {
    const existing = await db.hreflangItem.findUnique({
      where: { storeId_shopifyGid: { storeId: data.storeId, shopifyGid: data.gid } },
    });
    if (existing && existing.groupId !== group.id) {
      staleGroupIds.add(existing.groupId);
    }

    await db.hreflangItem.upsert({
      where: { storeId_shopifyGid: { storeId: data.storeId, shopifyGid: data.gid } },
      update: { groupId: group.id, handle: data.handle, title: data.title, sku: data.sku, url: data.url },
      create: {
        groupId: group.id,
        storeId: data.storeId,
        shopDomain: data.shopDomain,
        shopifyGid: data.gid,
        handle: data.handle,
        title: data.title,
        sku: data.sku,
        url: data.url,
      },
    });
  }

  await logMatching(group.id, "legacy_import", { hreflangId, resourceType, storeCount: itemsData.length });

  for (const staleGroupId of staleGroupIds) {
    const remainingCount = await db.hreflangItem.count({ where: { groupId: staleGroupId } });
    if (remainingCount === 0) {
      await db.hreflangGroup.delete({ where: { id: staleGroupId } });
    } else {
      const resynced = await recomputeGroupStatus(staleGroupId);
      await pushMetafieldsForGroup(resynced);
    }
  }

  const updated = await recomputeGroupStatus(group.id);
  await pushMetafieldsForGroup(updated);
  return updated;
}
