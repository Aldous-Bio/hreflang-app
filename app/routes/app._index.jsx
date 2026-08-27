import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getAllStores } from "../config/stores.server";

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

  const [pendingSiblings, partial, complete, recentGroups] = await Promise.all([
    db.hreflangGroup.count({ where: { status: "pending_siblings" } }),
    db.hreflangGroup.count({ where: { status: "partial" } }),
    db.hreflangGroup.count({ where: { status: "complete" } }),
    db.hreflangGroup.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { items: true },
    }),
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
  };
};

export default function Dashboard() {
  const { stats, recentGroups, storeIds } = useLoaderData();

  return (
    <s-page heading="Hreflang dashboard">
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
              <s-table-header>Type</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Stores</s-table-header>
              <s-table-header>Match</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recentGroups.map((group) => (
                <s-table-row key={group.id}>
                  <s-table-cell>{group.hreflangId}</s-table-cell>
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
