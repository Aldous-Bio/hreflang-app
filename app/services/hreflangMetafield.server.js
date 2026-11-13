import db from "../db.server";
import { unauthenticated } from "../shopify.server";

const NAMESPACE = "custom";
const KEY = "href_lang";

async function setHreflangMetafield(shopDomain, resourceGid, urls) {
  const { admin } = await unauthenticated.admin(shopDomain);

  const response = await admin.graphql(
    `#graphql
      mutation SetHreflang($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: resourceGid,
            namespace: NAMESPACE,
            key: KEY,
            type: "list.single_line_text_field",
            value: JSON.stringify(urls),
          },
        ],
      },
    },
  );

  const json = await response.json();
  const userErrors = json?.data?.metafieldsSet?.userErrors ?? [];
  const topLevelErrors = json?.errors;

  if (userErrors.length > 0 || topLevelErrors || !json?.data?.metafieldsSet) {
    throw new Error(
      `Failed to set custom.href_lang on ${resourceGid} (${shopDomain}): ${JSON.stringify({ userErrors, topLevelErrors })}`,
    );
  }
}

// Escribe custom.href_lang en cada link resuelto de la entry, con las URLs de
// sus hermanos resueltos. Un link sin hermanos resueltos todavía no se toca,
// para no vaciar un valor ya existente. Los fallos se guardan en
// HreflangLink.lastError en vez de abortar el resto de links.
export async function syncEntryMetafields(entryId) {
  const entry = await db.hreflangEntry.findUnique({
    where: { id: entryId },
    include: { links: { include: { store: true } } },
  });
  if (!entry) return;

  const resolvedLinks = entry.links.filter((link) => link.shopifyGid);

  for (const link of resolvedLinks) {
    const siblingUrls = resolvedLinks.filter((other) => other.id !== link.id).map((other) => other.url);
    if (siblingUrls.length === 0) continue;

    try {
      await setHreflangMetafield(link.store.shopDomain, link.shopifyGid, siblingUrls);
      await db.hreflangLink.update({ where: { id: link.id }, data: { lastError: null } });
    } catch (error) {
      await db.hreflangLink.update({ where: { id: link.id }, data: { lastError: error.message } });
    }
  }
}

// Recorre todas las entradas y reescribe custom.href_lang en cada una, por si
// algún valor se editó a mano en Shopify y se descuadró con lo que hay en la
// base de datos de la app. No crea ni borra entradas ni enlaces, solo
// resincroniza el metacampo a partir de lo ya guardado.
export async function syncAllEntryMetafields() {
  const entries = await db.hreflangEntry.findMany({ select: { id: true } });

  let synced = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      await syncEntryMetafields(entry.id);
      synced++;
    } catch (error) {
      failed++;
    }
  }

  return { synced, failed };
}
