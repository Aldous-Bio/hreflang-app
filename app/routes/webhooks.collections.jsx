import { authenticate } from "../shopify.server";
import { handleResourceEvent } from "../services/matchingEngine.server";

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`[webhooks.collections] topic=${topic} shop=${shop} admin=${admin ? "yes" : "no"} id=${payload?.id}`);

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
