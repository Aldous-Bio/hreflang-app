import { authenticate } from "../shopify.server";
import { handleResourceEvent } from "../services/matchingEngine.server";

export const action = async ({ request }) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`[webhooks.products] topic=${topic} shop=${shop} admin=${admin ? "yes" : "no"} id=${payload?.id}`);

  const action =
    topic === "PRODUCTS_CREATE" ? "create" : topic === "PRODUCTS_DELETE" ? "delete" : "update";

  if (action !== "delete" && !admin) {
    // No offline session for this shop (e.g. app mid-uninstall) — nothing we can do.
    return new Response();
  }

  try {
    await handleResourceEvent({
      resourceType: "product",
      action,
      shopDomain: shop,
      admin,
      numericId: payload.id,
    });
  } catch (error) {
    // No dejar que Shopify reintente el webhook en bucle por un fallo nuestro
    // (p. ej. un metacampo mal tipado en alguna tienda).
    console.log(`[webhooks.products] error procesando id=${payload?.id}: ${error.message}`);
  }

  return new Response();
};
