// SOLO PARA LA FASE DE PRUEBAS. Lee el metafield legado custom.href_lang_id
// (el que se asignaba a mano en el sistema anterior) de todos los productos y
// colecciones de las 4 tiendas, agrupa lo que comparta el mismo valor, y
// alimenta con eso el sistema de la app (incluyendo custom.href_lang). Sirve
// también como vía segura para colecciones, sin depender de comparar handles
// entre idiomas.
import { unauthenticated } from "../shopify.server";
import { getAllStores } from "../config/stores.server";
import { importLegacyGroup } from "./matchingEngine.server";

const NAMESPACE = "custom";
const LEGACY_HREFLANG_ID_KEY = "href_lang_id";
const MAX_PAGES_PER_STORE_AND_TYPE = 30; // ~3000 items, margen de sobra

const QUERIES = {
  product: `#graphql
    query LegacyImportProducts($cursor: String) {
      products(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
          status
          variants(first: 1) { nodes { sku } }
          legacyId: metafield(namespace: "${NAMESPACE}", key: "${LEGACY_HREFLANG_ID_KEY}") { value }
        }
      }
    }`,
  collection: `#graphql
    query LegacyImportCollections($cursor: String) {
      collections(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
          legacyId: metafield(namespace: "${NAMESPACE}", key: "${LEGACY_HREFLANG_ID_KEY}") { value }
        }
      }
    }`,
};

const ROOT_FIELD = { product: "products", collection: "collections" };

async function fetchLegacyItems(admin, resourceType) {
  const items = [];
  let cursor = null;

  for (let page = 0; page < MAX_PAGES_PER_STORE_AND_TYPE; page++) {
    const response = await admin.graphql(QUERIES[resourceType], { variables: { cursor } });
    const json = await response.json();
    const connection = json?.data?.[ROOT_FIELD[resourceType]];
    if (!connection) break;

    for (const node of connection.nodes) {
      const legacyId = node.legacyId?.value?.trim();
      if (!legacyId) continue;
      if (resourceType === "product" && node.status === "DRAFT") continue;

      items.push({
        gid: node.id,
        handle: node.handle,
        title: node.title,
        sku: node.variants?.nodes?.[0]?.sku ?? null,
        legacyId,
        path: resourceType === "product" ? `/products/${node.handle}` : `/collections/${node.handle}`,
      });
    }

    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  return items;
}

export async function runLegacyImport() {
  const groups = new Map(); // "resourceType:legacyId" -> itemsData[]

  for (const store of getAllStores()) {
    const { admin } = await unauthenticated.admin(store.shopDomain);

    for (const resourceType of ["product", "collection"]) {
      const items = await fetchLegacyItems(admin, resourceType);
      for (const item of items) {
        const key = `${resourceType}:${item.legacyId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({
          storeId: store.storeId,
          shopDomain: store.shopDomain,
          gid: item.gid,
          handle: item.handle,
          title: item.title,
          sku: item.sku,
          url: `${store.publicUrl}${item.path}`,
        });
      }
    }
  }

  let groupsProcessed = 0;
  let itemsLinked = 0;

  for (const [key, itemsData] of groups) {
    const [resourceType, legacyId] = key.split(":");

    // Por si el mismo legacyId aparece dos veces en la misma tienda: nos
    // quedamos con la primera aparición, un grupo no puede tener 2 items de
    // la misma tienda.
    const seenStores = new Set();
    const deduped = itemsData.filter((item) => {
      if (seenStores.has(item.storeId)) return false;
      seenStores.add(item.storeId);
      return true;
    });

    if (deduped.length < 2) continue; // no sirve de nada un "grupo" de 1 sola tienda

    await importLegacyGroup(legacyId, resourceType, deduped);
    groupsProcessed++;
    itemsLinked += deduped.length;
  }

  return { groupsProcessed, itemsLinked };
}
