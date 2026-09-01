import db from "../db.server";

export function listStores() {
  return db.store.findMany({ orderBy: { position: "asc" } });
}

export function getStoreById(id) {
  return db.store.findUnique({ where: { id } });
}

function normalizePublicUrl(publicUrl) {
  return publicUrl.replace(/\/+$/, "");
}

export async function createStore({ storeId, shopDomain, label, locale, publicUrl }) {
  const maxPosition = await db.store.aggregate({ _max: { position: true } });
  return db.store.create({
    data: {
      storeId,
      shopDomain,
      label,
      locale,
      publicUrl: normalizePublicUrl(publicUrl),
      position: (maxPosition._max.position ?? -1) + 1,
    },
  });
}

export function updateStore(id, { storeId, shopDomain, label, locale, publicUrl }) {
  return db.store.update({
    where: { id },
    data: { storeId, shopDomain, label, locale, publicUrl: normalizePublicUrl(publicUrl) },
  });
}

export function deleteStore(id) {
  return db.store.delete({ where: { id } });
}
