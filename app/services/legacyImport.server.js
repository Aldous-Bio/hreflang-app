import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { listStores } from "./stores.server";
import { buildPath } from "./resourceCatalog.server";

const NAMESPACE = "custom";
const LEGACY_KEY = "href_lang_id";
const RESOURCE_TYPES = ["product", "collection", "page", "blog", "article"];
const MAX_PAGES_PER_STORE_AND_TYPE = 30; // ~3000 recursos por tienda y tipo, margen de sobra

const QUERIES = {
  product: `#graphql
    query LegacyProducts($cursor: String) {
      products(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
          status
          legacyId: metafield(namespace: "${NAMESPACE}", key: "${LEGACY_KEY}") { value }
        }
      }
    }`,
  collection: `#graphql
    query LegacyCollections($cursor: String) {
      collections(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
          legacyId: metafield(namespace: "${NAMESPACE}", key: "${LEGACY_KEY}") { value }
        }
      }
    }`,
  page: `#graphql
    query LegacyPages($cursor: String) {
      pages(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
          legacyId: metafield(namespace: "${NAMESPACE}", key: "${LEGACY_KEY}") { value }
        }
      }
    }`,
  blog: `#graphql
    query LegacyBlogs($cursor: String) {
      blogs(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
          legacyId: metafield(namespace: "${NAMESPACE}", key: "${LEGACY_KEY}") { value }
        }
      }
    }`,
  article: `#graphql
    query LegacyArticles($cursor: String) {
      articles(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
          blog { handle }
          legacyId: metafield(namespace: "${NAMESPACE}", key: "${LEGACY_KEY}") { value }
        }
      }
    }`,
};

const ROOT_FIELD = {
  product: "products",
  collection: "collections",
  page: "pages",
  blog: "blogs",
  article: "articles",
};

async function fetchLegacyItems(store, resourceType) {
  const { admin } = await unauthenticated.admin(store.shopDomain);
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
        legacyId,
        url: `${store.publicUrl}${buildPath(resourceType, node)}`,
      });
    }

    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  return items;
}

// Recorre las tiendas configuradas buscando el metacampo legado
// custom.href_lang_id en productos, colecciones, páginas, blogs y artículos,
// y agrupa lo que comparta el mismo valor. NO toca custom.href_lang ni
// ningún otro metacampo — solo crea/actualiza registros en nuestra base de
// datos. Reejecutable: los grupos ya importados (identificados por
// HreflangEntry.legacySourceId) se actualizan en vez de duplicarse, y nunca
// se toca un recurso que ya esté enlazado a una entrada distinta (manual u
// otro grupo legado) — se trata como si esa tienda no tuviera el recurso.
export async function runLegacyImport() {
  const stores = await listStores();

  const groups = new Map(); // "resourceType:legacyId" -> [{ storeId, gid, handle, title, url }]

  for (const resourceType of RESOURCE_TYPES) {
    for (const store of stores) {
      let items;
      try {
        items = await fetchLegacyItems(store, resourceType);
      } catch (error) {
        console.log(`[legacyImport] fallo leyendo ${resourceType} en ${store.shopDomain}: ${error.message}`);
        continue;
      }

      for (const item of items) {
        const key = `${resourceType}:${item.legacyId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ storeId: store.id, ...item });
      }
    }
  }

  const existingLinks = await db.hreflangLink.findMany({
    select: { storeId: true, shopifyGid: true, entry: { select: { legacySourceId: true } } },
  });
  const claimedBy = new Map();
  for (const link of existingLinks) {
    if (link.shopifyGid) claimedBy.set(`${link.storeId}:${link.shopifyGid}`, link.entry.legacySourceId);
  }

  const existingEntries = await db.hreflangEntry.findMany({ where: { legacySourceId: { not: null } } });
  const entryByKey = new Map(existingEntries.map((entry) => [`${entry.resourceType}:${entry.legacySourceId}`, entry]));

  const nextDisplayId = {};
  for (const resourceType of RESOURCE_TYPES) {
    const max = await db.hreflangEntry.aggregate({ where: { resourceType }, _max: { displayId: true } });
    nextDisplayId[resourceType] = (max._max.displayId ?? 0) + 1;
  }

  let groupsCreated = 0;
  let groupsUpdated = 0;
  let linksLinked = 0;
  let skippedConflicts = 0;
  let failed = 0;

  for (const [key, items] of groups) {
    const [resourceType, legacyId] = key.split(":");

    try {
      const seenStores = new Set();
      const deduped = items.filter((item) => {
        if (seenStores.has(item.storeId)) return false;
        seenStores.add(item.storeId);
        return true;
      });

      const usable = deduped.filter((item) => {
        const claimant = claimedBy.get(`${item.storeId}:${item.gid}`);
        return claimant === undefined || claimant === legacyId;
      });
      skippedConflicts += deduped.length - usable.length;

      const existingEntry = entryByKey.get(key);
      if (!existingEntry && usable.length < 2) continue; // grupo nuevo sin al menos 2 tiendas: no aporta nada

      const entry = existingEntry
        ? existingEntry
        : await db.hreflangEntry.create({
            data: { resourceType, legacySourceId: legacyId, displayId: nextDisplayId[resourceType]++ },
          });

      if (existingEntry) groupsUpdated++;
      else groupsCreated++;

      for (const item of usable) {
        await db.hreflangLink.upsert({
          where: { entryId_storeId: { entryId: entry.id, storeId: item.storeId } },
          update: { shopifyGid: item.gid, handle: item.handle, title: item.title, url: item.url, source: "legacy_import" },
          create: {
            entryId: entry.id,
            storeId: item.storeId,
            shopifyGid: item.gid,
            handle: item.handle,
            title: item.title,
            url: item.url,
            source: "legacy_import",
          },
        });
        linksLinked++;
      }
    } catch (error) {
      console.log(`[legacyImport] fallo en ${key}: ${error.message}`);
      failed++;
    }
  }

  return { groupsCreated, groupsUpdated, linksLinked, skippedConflicts, failed };
}
