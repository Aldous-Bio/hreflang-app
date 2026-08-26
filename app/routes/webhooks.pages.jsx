import { authenticate } from "../shopify.server";
import { handleResourceEvent } from "../services/matchingEngine.server";

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  const action =
    topic === "PAGES_CREATE" ? "create" : topic === "PAGES_DELETE" ? "delete" : "update";

  if (action !== "delete" && !admin) {
    return new Response();
  }

  await handleResourceEvent({
    resourceType: "page",
    action,
    shopDomain: shop,
    admin,
    numericId: payload.id,
  });

  return new Response();
};
