import db from "../db.server";
import { getStoreByShopDomain, totalStoreCount } from "../config/stores.server";
import {
  buildResourceGid,
  fetchResourceDetails,
  setHreflangMetafields,
} from "./shopifyResource.server";
import { AUTO_MATCH_THRESHOLD, handleSimilarity } from "../utils/similarity.server";

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

async function findMatchCandidate(resourceType, storeId, details) {
  if (details.sku) {
    const bySku = await db.hreflangItem.findFirst({
      where: {
        storeId: { not: storeId },
        sku: details.sku,
        group: { resourceType, items: { none: { storeId } } },
      },
    });
    if (bySku) return { item: bySku, criteria: "sku", confidence: 95 };
  }

  const candidates = await db.hreflangItem.findMany({
    where: {
      storeId: { not: storeId },
      group: { resourceType, items: { none: { storeId } } },
    },
  });

  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = handleSimilarity(candidate.handle, details.handle);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best && bestScore >= AUTO_MATCH_THRESHOLD) {
    return {
      item: best,
      criteria: "handle_similarity",
      confidence: Math.round(bestScore * 100),
    };
  }

  return null;
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

  const candidate = await findMatchCandidate(resourceType, storeId, details);
  if (candidate) {
    const group = await db.hreflangGroup.findUnique({
      where: { id: candidate.item.groupId },
    });
    return { group, matched: true, criteria: candidate.criteria, confidence: candidate.confidence };
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

async function pushMetafieldsForGroup(group) {
  for (const item of group.items) {
    const otherUrls = group.items
      .filter((other) => other.id !== item.id)
      .map((other) => other.url);
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
  const store = getStoreByShopDomain(shopDomain);
  if (!store) return;

  const gid = buildResourceGid(resourceType, numericId);

  if (action === "delete") {
    const item = await db.hreflangItem.findUnique({
      where: { storeId_shopifyGid: { storeId: store.storeId, shopifyGid: gid } },
    });
    if (!item) return;

    await db.hreflangItem.delete({ where: { id: item.id } });
    await logMatching(item.groupId, "item_deleted", { storeId: store.storeId, gid });

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
    return;
  }

  const details = await fetchResourceDetails(admin, resourceType, numericId);
  if (!details) return; // resource was deleted before/while we processed the event

  const existingItem = await db.hreflangItem.findUnique({
    where: { storeId_shopifyGid: { storeId: store.storeId, shopifyGid: details.gid } },
  });

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
