import { unauthenticated } from "../shopify.server";

const HREFLANG_ID_KEY = "href_lang_group_id";
const HREFLANG_URLS_KEY = "href_lang";
const NAMESPACE = "custom";

export async function setHreflangMetafields(shopDomain, resourceGid, hreflangId, urls) {
  const { admin } = await unauthenticated.admin(shopDomain);

  const response = await admin.graphql(
    `#graphql
      mutation SetHreflangMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: resourceGid,
            namespace: NAMESPACE,
            key: HREFLANG_ID_KEY,
            type: "single_line_text_field",
            value: hreflangId,
          },
          {
            ownerId: resourceGid,
            namespace: NAMESPACE,
            key: HREFLANG_URLS_KEY,
            type: "list.single_line_text_field",
            value: JSON.stringify(urls),
          },
        ],
      },
    },
  );

  const json = await response.json();
  const userErrors = json?.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      `Failed to set hreflang metafields on ${resourceGid} (${shopDomain}): ${JSON.stringify(userErrors)}`,
    );
  }
}

export function readHreflangIdFromMetafields(metafields) {
  const entry = (metafields ?? []).find(
    (m) => m?.namespace === NAMESPACE && m?.key === HREFLANG_ID_KEY,
  );
  return entry?.value ?? null;
}

const GRAPHQL_TYPE_BY_RESOURCE_TYPE = {
  product: "Product",
  collection: "Collection",
  page: "Page",
  article: "Article",
};

export function buildResourceGid(resourceType, numericId) {
  return `gid://shopify/${GRAPHQL_TYPE_BY_RESOURCE_TYPE[resourceType]}/${numericId}`;
}

const RESOURCE_DETAIL_QUERIES = {
  product: `#graphql
    query HreflangProduct($id: ID!) {
      product(id: $id) {
        id
        handle
        title
        variants(first: 1) { nodes { sku } }
        hreflangId: metafield(namespace: "custom", key: "${HREFLANG_ID_KEY}") { value }
      }
    }`,
  collection: `#graphql
    query HreflangCollection($id: ID!) {
      collection(id: $id) {
        id
        handle
        title
        hreflangId: metafield(namespace: "custom", key: "${HREFLANG_ID_KEY}") { value }
      }
    }`,
  page: `#graphql
    query HreflangPage($id: ID!) {
      page(id: $id) {
        id
        handle
        title
        hreflangId: metafield(namespace: "custom", key: "${HREFLANG_ID_KEY}") { value }
      }
    }`,
  article: `#graphql
    query HreflangArticle($id: ID!) {
      article(id: $id) {
        id
        handle
        title
        blog { handle }
        hreflangId: metafield(namespace: "custom", key: "${HREFLANG_ID_KEY}") { value }
      }
    }`,
};

const RESOURCE_ROOT_FIELD = {
  product: "product",
  collection: "collection",
  page: "page",
  article: "article",
};

// Returns null if the resource was deleted/unavailable by the time we queried it
// (webhooks can race with fast create->delete sequences).
export async function fetchResourceDetails(admin, resourceType, numericId) {
  const gid = buildResourceGid(resourceType, numericId);
  const response = await admin.graphql(RESOURCE_DETAIL_QUERIES[resourceType], {
    variables: { id: gid },
  });
  const json = await response.json();
  const node = json?.data?.[RESOURCE_ROOT_FIELD[resourceType]];
  if (!node) return null;

  const path =
    resourceType === "article"
      ? `/blogs/${node.blog?.handle}/${node.handle}`
      : `/${resourceType === "page" ? "pages" : `${resourceType}s`}/${node.handle}`;

  return {
    gid: node.id,
    handle: node.handle,
    title: node.title,
    sku: node.variants?.nodes?.[0]?.sku ?? null,
    existingHreflangId: node.hreflangId?.value ?? null,
    path,
  };
}
