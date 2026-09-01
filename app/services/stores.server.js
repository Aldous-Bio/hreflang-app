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

// Solo actualiza el campo `position` según el nuevo orden — el `id` (y por
// tanto cualquier referencia existente desde HreflangLink) no se toca nunca.
export function reorderStores(orderedIds) {
  return db.$transaction(
    orderedIds.map((id, index) => db.store.update({ where: { id }, data: { position: index } })),
  );
}
