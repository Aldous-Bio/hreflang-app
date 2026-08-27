import { Form, useFetcher, useLoaderData, useSearchParams, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getAllStores } from "../config/stores.server";
import { isMatchingEnabled, setMatchingEnabled } from "../services/settings.server";
import { rescanAllPendingGroups } from "../services/matchingEngine.server";

const STATUS_TONE = {
  complete: "success",
  partial: "warning",
  pending_siblings: "critical",
};

const ADMIN_PATH_BY_RESOURCE_TYPE = {
  product: "products",
  collection: "collections",
  page: "pages",
  article: "articles",
};

function adminEditUrl(item, resourceType) {
  const numericId = item.shopifyGid.split("/").pop();
  const path = ADMIN_PATH_BY_RESOURCE_TYPE[resourceType];
  if (!path) return item.url;
  return `https://${item.shopDomain}/admin/${path}/${numericId}`;
}

const PAGE_WINDOW_SIZE = 5;

function pageWindow(current, total) {
  const half = Math.floor(PAGE_WINDOW_SIZE / 2);
  let start = Math.max(1, current - half);
  const end = Math.min(total, start + PAGE_WINDOW_SIZE - 1);
  start = Math.max(1, end - PAGE_WINDOW_SIZE + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(url.searchParams.get("pageSize")))
    ? Number(url.searchParams.get("pageSize"))
    : DEFAULT_PAGE_SIZE;
  const requestedPage = Number(url.searchParams.get("page")) || 1;

  const where = q
    ? {
        OR: [
          { hreflangId: { contains: q } },
          {
            items: {
              some: {
                OR: [{ title: { contains: q } }, { handle: { contains: q } }, { sku: { contains: q } }],
              },
            },
          },
        ],
      }
    : {};

  const [pendingSiblings, partial, complete, matchingEnabled, totalCount] = await Promise.all([
    db.hreflangGroup.count({ where: { status: "pending_siblings" } }),
    db.hreflangGroup.count({ where: { status: "partial" } }),
    db.hreflangGroup.count({ where: { status: "complete" } }),
    isMatchingEnabled(),
    db.hreflangGroup.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(requestedPage, 1), totalPages);

  const groups = await db.hreflangGroup.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { items: true },
  });

  return {
    stats: {
      total: pendingSiblings + partial + complete,
      pendingSiblings,
      partial,
      complete,
    },
    groups,
    storeIds: getAllStores().map((store) => store.storeId),
    matchingEnabled,
    q,
    page,
    pageSize,
    totalCount,
    totalPages,
  };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle") {
    const enabled = await isMatchingEnabled();
    await setMatchingEnabled(!enabled);
    return { toggled: true };
  }

  if (intent === "rescan") {
    const { matchesMade, removed } = await rescanAllPendingGroups();
    return { rescanned: true, matchesMade, removed };
  }

  return null;
};

export default function Dashboard() {
  const { stats, groups, storeIds, matchingEnabled, q, page, pageSize, totalCount, totalPages } =
    useLoaderData();
  const toggleFetcher = useFetcher();
  const rescanFetcher = useFetcher();
  const [searchParams] = useSearchParams();
  const submit = useSubmit();

  function pageHref(targetPage) {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(targetPage));
    return `?${params.toString()}`;
  }

  return (
    <s-page heading="Hreflang dashboard">
      <s-section heading="Matching automático">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-badge tone={matchingEnabled ? "success" : "critical"}>
            {matchingEnabled ? "Activado" : "Desactivado"}
          </s-badge>
          <toggleFetcher.Form method="post">
            <input type="hidden" name="intent" value="toggle" />
            <s-button type="submit" tone={matchingEnabled ? "critical" : "auto"}>
              {matchingEnabled ? "Apagar" : "Lanzar"}
            </s-button>
          </toggleFetcher.Form>
          <rescanFetcher.Form method="post">
            <input type="hidden" name="intent" value="rescan" />
            <s-button type="submit" loading={rescanFetcher.state !== "idle"}>
              Forzar re-scan ahora
            </s-button>
          </rescanFetcher.Form>
          {rescanFetcher.data?.rescanned && (
            <s-text>
              {rescanFetcher.data.matchesMade} coincidencias nuevas, {rescanFetcher.data.removed} borradores/borrados
              retirados.
            </s-text>
          )}
        </s-stack>
        <s-paragraph>
          &ldquo;Apagar&rdquo; pausa el matching automático por webhooks (nada se crea ni se escribe, pero los
          webhooks se siguen recibiendo). &ldquo;Forzar re-scan&rdquo; busca coincidencias ahora mismo entre todo
          lo que ya está huérfano en la base de datos, sin esperar a que se vuelva a editar cada producto.
        </s-paragraph>
      </s-section>

      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="tight">
              <s-text tone="subdued">Total groups</s-text>
              <s-heading>{stats.total}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="tight">
              <s-text tone="subdued">Complete</s-text>
              <s-heading>{stats.complete}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="tight">
              <s-text tone="subdued">Partial</s-text>
              <s-heading>{stats.partial}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="tight">
              <s-text tone="subdued">Orphans (no match yet)</s-text>
              <s-heading>{stats.pendingSiblings}</s-heading>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      <s-section heading="Recent groups">
        <Form method="get" onSubmit={(event) => event.preventDefault()}>
          <s-grid gridTemplateColumns="1fr 140px" gap="base">
            <s-text-field
              name="q"
              label="Buscar por título, handle, SKU o hreflang ID"
              defaultValue={q}
              onChange={(event) => submit(event.currentTarget.form)}
            ></s-text-field>
            <s-select
              name="pageSize"
              label="Por página"
              defaultValue={String(pageSize)}
              onChange={(event) => submit(event.currentTarget.form)}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <s-option key={size} value={String(size)}>
                  {size}
                </s-option>
              ))}
            </s-select>
          </s-grid>
          <input type="hidden" name="page" value="1" />
        </Form>

        {groups.length === 0 ? (
          <s-paragraph>
            {q
              ? `No hay grupos que coincidan con "${q}".`
              : "No hreflang groups yet. They appear automatically as products, collections, pages, and articles are created across the 4 stores."}
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Hreflang ID</s-table-header>
              <s-table-header>Product</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Stores</s-table-header>
              <s-table-header>Match</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {groups.map((group) => (
                <s-table-row key={group.id}>
                  <s-table-cell>{group.hreflangId}</s-table-cell>
                  <s-table-cell>{group.items[0]?.title ?? "—"}</s-table-cell>
                  <s-table-cell>{group.resourceType}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[group.status]}>{group.status}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {group.items.length === 0 ? (
                      "—"
                    ) : (
                      <s-stack direction="inline" gap="tight">
                        {storeIds
                          .map((storeId) => group.items.find((item) => item.storeId === storeId))
                          .filter(Boolean)
                          .map((item) => (
                            <s-link
                              key={item.id}
                              href={adminEditUrl(item, group.resourceType)}
                              target="_blank"
                            >
                              {item.storeId}
                            </s-link>
                          ))}
                      </s-stack>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {group.matchCriteria ? `${group.matchCriteria} (${group.matchConfidence}%)` : "—"}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}

        {totalCount > 0 && (
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text tone="subdued">
              Mostrando {(page - 1) * pageSize + 1} a {Math.min(page * pageSize, totalCount)} de {totalCount}
            </s-text>
            <s-stack direction="inline" gap="tight" alignItems="center">
              {page > 1 ? (
                <>
                  <s-link href={pageHref(1)}>&laquo;</s-link>
                  <s-link href={pageHref(page - 1)}>&lsaquo;</s-link>
                </>
              ) : (
                <>
                  <s-text tone="subdued">&laquo;</s-text>
                  <s-text tone="subdued">&lsaquo;</s-text>
                </>
              )}

              {pageWindow(page, totalPages).map((pageNumber) =>
                pageNumber === page ? (
                  <s-badge key={pageNumber}>{pageNumber}</s-badge>
                ) : (
                  <s-link key={pageNumber} href={pageHref(pageNumber)}>
                    {pageNumber}
                  </s-link>
                ),
              )}

              {page < totalPages ? (
                <>
                  <s-link href={pageHref(page + 1)}>&rsaquo;</s-link>
                  <s-link href={pageHref(totalPages)}>&raquo;</s-link>
                </>
              ) : (
                <>
                  <s-text tone="subdued">&rsaquo;</s-text>
                  <s-text tone="subdued">&raquo;</s-text>
                </>
              )}
            </s-stack>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
