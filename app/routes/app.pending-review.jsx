import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { attachItemToGroup } from "../services/matchingEngine.server";
import { REVIEW_THRESHOLD, handleSimilarity } from "../utils/similarity.server";

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

  const incompleteGroups = await db.hreflangGroup.findMany({
    where: { status: { in: ["pending_siblings", "partial"] } },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });

  const suggestions = [];

  // Solo colecciones: los productos se identifican por SKU (matchingEngine),
  // que es un dato real e independiente del idioma. El handle es solo texto
  // — dos productos distintos ("packs" con nombres parecidos en cada idioma)
  // pueden coincidir por casualidad sin ser el mismo, así que no se usa para
  // sugerir productos. Sin SKU compartido, un producto simplemente no tiene
  // pareja, y eso es correcto: no forzamos nada.
  for (const group of incompleteGroups.filter((group) => group.resourceType === "collection")) {
    const groupStoreIds = new Set(group.items.map((item) => item.storeId));

    const candidates = await db.hreflangItem.findMany({
      where: {
        storeId: { notIn: [...groupStoreIds] },
        group: { resourceType: group.resourceType, id: { not: group.id } },
      },
      include: { group: true },
    });

    let best = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      for (const item of group.items) {
        const score = handleSimilarity(item.handle, candidate.handle);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
    }

    if (best && bestScore >= REVIEW_THRESHOLD) {
      suggestions.push({
        group,
        candidate: best,
        confidence: Math.round(bestScore * 100),
      });
    }
  }

  return { suggestions };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "approve") {
    await attachItemToGroup(Number(formData.get("candidateItemId")), Number(formData.get("groupId")), {
      criteria: "manual_review",
      confidence: Number(formData.get("confidence")),
    });
  }

  return { ok: true };
};

export default function PendingReview() {
  const { suggestions } = useLoaderData();
  const fetcher = useFetcher();

  return (
    <s-page heading="Pending review">
      <s-section heading="Suggested matches">
        {suggestions.length === 0 ? (
          <s-paragraph>
            No suggested matches right now. Products only auto-link on an identical SKU — no suggestions are
            shown for products, since a text-based guess could pair two unrelated products by mistake.
            Collections (no SKU) show handle-similarity suggestions here for manual approval.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Group</s-table-header>
              <s-table-header>Existing stores</s-table-header>
              <s-table-header>Suggested item</s-table-header>
              <s-table-header>Confidence</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {suggestions.map(({ group, candidate, confidence }) => (
                <s-table-row key={`${group.id}-${candidate.id}`}>
                  <s-table-cell>
                    {group.hreflangId} ({group.resourceType})
                  </s-table-cell>
                  <s-table-cell>
                    {group.items.map((item, index) => (
                      <span key={item.id}>
                        {index > 0 && " / "}
                        {item.storeId}:{" "}
                        <s-link href={adminEditUrl(item, group.resourceType)} target="_blank">
                          {item.title}
                        </s-link>
                      </span>
                    ))}
                  </s-table-cell>
                  <s-table-cell>
                    {candidate.storeId}:{" "}
                    <s-link href={adminEditUrl(candidate, group.resourceType)} target="_blank">
                      {candidate.title}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{confidence}%</s-table-cell>
                  <s-table-cell>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="approve" />
                      <input type="hidden" name="groupId" value={group.id} />
                      <input type="hidden" name="candidateItemId" value={candidate.id} />
                      <input type="hidden" name="confidence" value={confidence} />
                      <s-button type="submit" variant="primary">
                        Approve match
                      </s-button>
                    </fetcher.Form>
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
