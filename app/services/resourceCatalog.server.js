import { unauthenticated } from "../shopify.server";

const SEARCH_QUERIES = {
  product: `#graphql
    query SearchProducts($query: String!) {
      products(first: 10, query: $query) {
        nodes { id handle title }
      }
    }`,
  collection: `#graphql
    query SearchCollections($query: String!) {
      collections(first: 10, query: $query) {
        nodes { id handle title }
      }
    }`,
  page: `#graphql
    query SearchPages($query: String!) {
      pages(first: 10, query: $query) {
        nodes { id handle title }
      }
    }`,
  blog: `#graphql
    query SearchBlogs($query: String!) {
      blogs(first: 10, query: $query) {
        nodes { id handle title }
      }
    }`,
  article: `#graphql
    query SearchArticles($query: String!) {
      articles(first: 10, query: $query) {
        nodes { id handle title blog { handle } }
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

// Query GraphQL para buscar por handle exacto (usado al resolver una URL pegada a mano).
const HANDLE_QUERIES = SEARCH_QUERIES;

function buildPath(resourceType, node) {
  switch (resourceType) {
    case "product":
      return `/products/${node.handle}`;
    case "collection":
      return `/collections/${node.handle}`;
    case "page":
      return `/pages/${node.handle}`;
    case "blog":
      return `/blogs/${node.handle}`;
    case "article":
      return `/blogs/${node.blog?.handle}/${node.handle}`;
    default:
      return `/${node.handle}`;
  }
}

function escapeQueryTerm(term) {
  return term.replace(/["\\]/g, "");
}

function toResult(resourceType, node, store) {
  return {
    gid: node.id,
    handle: node.handle,
    title: node.title,
    url: `${store.publicUrl}${buildPath(resourceType, node)}`,
  };
}

// Devuelve { results } o { error } — nunca lanza, para que el llamador pueda
// mostrar el fallo (p. ej. "no hay sesión para esta tienda") sin romper la UI.
export async function searchResources(store, resourceType, term) {
  const trimmed = term?.trim();
  if (!trimmed) return { results: [] };

  try {
    const { admin } = await unauthenticated.admin(store.shopDomain);
    const safeTerm = escapeQueryTerm(trimmed);
    const response = await admin.graphql(SEARCH_QUERIES[resourceType], {
      variables: { query: `title:*${safeTerm}*` },
    });
    const json = await response.json();
    const nodes = json?.data?.[ROOT_FIELD[resourceType]]?.nodes ?? [];
    return { results: nodes.map((node) => toResult(resourceType, node, store)) };
  } catch (error) {
    return { error: error.message };
  }
}

function extractHandles(store, resourceType, url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.startsWith(store.publicUrl) ? url.slice(store.publicUrl.length) : url;
  }
  const segments = pathname.split("/").filter(Boolean);

  if (resourceType === "article") {
    // /blogs/{blogHandle}/{articleHandle}
    if (segments.length < 3) return null;
    return { blogHandle: segments[1], handle: segments[segments.length - 1] };
  }

  // /products/{handle}, /collections/{handle}, /pages/{handle}, /blogs/{handle}
  if (segments.length < 2) return null;
  return { handle: segments[segments.length - 1] };
}

// Resuelve una URL pegada a mano al recurso real de esa tienda (por handle),
// para poder escribirle el metacampo aunque no se haya usado el buscador.
export async function resolveResourceByUrl(store, resourceType, url) {
  const handles = extractHandles(store, resourceType, url);
  if (!handles) return { error: "No se pudo interpretar la URL." };

  try {
    const { admin } = await unauthenticated.admin(store.shopDomain);
    const response = await admin.graphql(HANDLE_QUERIES[resourceType], {
      variables: { query: `handle:'${handles.handle}'` },
    });
    const json = await response.json();
    const nodes = json?.data?.[ROOT_FIELD[resourceType]]?.nodes ?? [];

    const node =
      resourceType === "article"
        ? nodes.find((candidate) => candidate.blog?.handle === handles.blogHandle)
        : nodes[0];

    if (!node) return { error: "No se encontró ningún recurso con esa URL en esta tienda." };
    return { result: toResult(resourceType, node, store) };
  } catch (error) {
    return { error: error.message };
  }
}
