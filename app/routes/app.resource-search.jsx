import { authenticate } from "../shopify.server";
import { getStoreById } from "../services/stores.server";
import { searchResources } from "../services/resourceCatalog.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const resourceType = url.searchParams.get("resourceType");
  const storeId = Number(url.searchParams.get("storeId"));
  const q = url.searchParams.get("q") ?? "";

  const store = await getStoreById(storeId);
  if (!store) return { error: "Tienda no encontrada." };

  return searchResources(store, resourceType, q);
};
