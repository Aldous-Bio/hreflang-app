import { requireAuthorizedShop } from "../shopify.server";
import { getStoreByIdForShop } from "../services/stores.server";
import { searchResources } from "../services/resourceCatalog.server";

export const loader = async ({ request }) => {
  const { session } = await requireAuthorizedShop(request);

  const url = new URL(request.url);
  const resourceType = url.searchParams.get("resourceType");
  const storeId = Number(url.searchParams.get("storeId"));
  const q = url.searchParams.get("q") ?? "";

  const store = await getStoreByIdForShop(storeId, session.shop);
  if (!store) return { error: "Tienda no encontrada o no autorizada." };

  return searchResources(store, resourceType, q);
};
