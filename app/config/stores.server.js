let stores = null;

function loadStores() {
  if (stores) return stores;

  const raw = process.env.STORE_MAP;
  if (!raw) {
    throw new Error(
      "STORE_MAP env var is not set. See .env.example for the expected shape.",
    );
  }

  const parsed = JSON.parse(raw);
  stores = {
    byStoreId: new Map(parsed.map((store) => [store.storeId, store])),
    byShopDomain: new Map(parsed.map((store) => [store.shopDomain, store])),
    all: parsed,
  };
  return stores;
}

export function getStoreByShopDomain(shopDomain) {
  return loadStores().byShopDomain.get(shopDomain) ?? null;
}

export function getStoreById(storeId) {
  return loadStores().byStoreId.get(storeId) ?? null;
}

export function getAllStores() {
  return loadStores().all;
}

export function totalStoreCount() {
  return getAllStores().length;
}
