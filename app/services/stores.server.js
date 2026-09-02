import db from "../db.server";

export function listStores() {
  return db.store.findMany({ orderBy: { id: "asc" } });
}

export function getStoreById(id) {
  return db.store.findUnique({ where: { id } });
}

function normalizePublicUrl(publicUrl) {
  return publicUrl.replace(/\/+$/, "");
}

export async function createStore({ storeId, shopDomain, label, locale, publicUrl }) {
  return db.store.create({
    data: {
      storeId,
      shopDomain,
      label,
      locale,
      publicUrl: normalizePublicUrl(publicUrl),
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

// Se ejecuta en el hook afterAuth cada vez que una tienda completa el login/
// instalación. Si ya existe una Store para ese shopDomain no hace nada; si no,
// crea una fila con lo que Shopify nos puede dar gratis (nombre, dominio
// primario). El idioma se deja en blanco: no hay forma de deducirlo sin pedir
// un scope nuevo (read_locales), así que se rellena a mano desde Configuración.
export async function ensureStoreForShop(shopDomain, admin) {
  const existing = await db.store.findUnique({ where: { shopDomain } });
  if (existing) return existing;

  let label = shopDomain;
  let publicUrl = `https://${shopDomain}`;

  try {
    const response = await admin.graphql(`#graphql
      query ShopInfo {
        shop {
          name
          primaryDomain { url }
        }
      }`);
    const json = await response.json();
    label = json?.data?.shop?.name ?? label;
    publicUrl = json?.data?.shop?.primaryDomain?.url ?? publicUrl;
  } catch {
    // Si falla la consulta, seguimos con los valores por defecto derivados
    // del propio shopDomain — se pueden corregir a mano después.
  }

  const baseSlug = shopDomain.replace(/\.myshopify\.com$/, "");
  let storeId = baseSlug;
  let suffix = 2;
  while (await db.store.findUnique({ where: { storeId } })) {
    storeId = `${baseSlug}-${suffix}`;
    suffix++;
  }

  return db.store.create({
    data: {
      storeId,
      shopDomain,
      label,
      locale: "",
      publicUrl: normalizePublicUrl(publicUrl),
    },
  });
}
