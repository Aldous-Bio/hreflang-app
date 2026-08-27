import { authenticate } from "../shopify.server";
import { handleResourceEvent } from "../services/matchingEngine.server";

// Matching de colecciones desactivado temporalmente — solo productos por ahora.
// Para reactivarlo, quita este bloque.
const COLLECTIONS_MATCHING_ENABLED = false;

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  if (!COLLECTIONS_MATCHING_ENABLED) {
    return new Response();
  }

  const action =
    topic === "COLLECTIONS_CREATE"
      ? "create"
      : topic === "COLLECTIONS_DELETE"
        ? "delete"
        : "update";

  if (action !== "delete" && !admin) {
    return new Response();
  }

  await handleResourceEvent({
    resourceType: "collection",
    action,
    shopDomain: shop,
    admin,
    numericId: payload.id,
  });

  return new Response();
};
