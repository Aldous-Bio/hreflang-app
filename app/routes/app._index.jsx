import { useFetcher, useLoaderData } from "react-router";
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

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const [pendingSiblings, partial, complete, recentGroups, matchingEnabled] = await Promise.all([
    db.hreflangGroup.count({ where: { status: "pending_siblings" } }),
    db.hreflangGroup.count({ where: { status: "partial" } }),
    db.hreflangGroup.count({ where: { status: "complete" } }),
    db.hreflangGroup.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { items: true },
    }),
    isMatchingEnabled(),
  ]);

  return {
    stats: {
      total: pendingSiblings + partial + complete,
      pendingSiblings,
      partial,
      complete,
    },
    recentGroups,
    storeIds: getAllStores().map((store) => store.storeId),
    matchingEnabled,
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
    const matchesMade = await rescanAllPendingGroups();
    return { rescanned: true, matchesMade };
  }

  return null;
};

export default function Dashboard() {
  const { stats, recentGroups, storeIds, matchingEnabled } = useLoaderData();
  const toggleFetcher = useFetcher();
  const rescanFetcher = useFetcher();

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
            <s-text>{rescanFetcher.data.matchesMade} coincidencias nuevas encontradas.</s-text>
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
        {recentGroups.length === 0 ? (
          <s-paragraph>No hreflang groups yet. They appear automatically as products, collections, pages, and articles are created across the 4 stores.</s-paragraph>
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
              {recentGroups.map((group) => (
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
      </s-section>
    </s-page>
  );
}
