import { authenticate } from "../shopify.server";
import { handleResourceEvent } from "../services/matchingEngine.server";

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  const action =
    topic === "PRODUCTS_CREATE" ? "create" : topic === "PRODUCTS_DELETE" ? "delete" : "update";

  if (action !== "delete" && !admin) {
    // No offline session for this shop (e.g. app mid-uninstall) — nothing we can do.
    return new Response();
  }

  await handleResourceEvent({
    resourceType: "product",
    action,
    shopDomain: shop,
    admin,
    numericId: payload.id,
  });

  return new Response();
};
