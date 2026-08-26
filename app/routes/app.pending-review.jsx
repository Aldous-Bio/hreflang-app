import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { attachItemToGroup } from "../services/matchingEngine.server";
import { AUTO_MATCH_THRESHOLD, REVIEW_THRESHOLD, handleSimilarity } from "../utils/similarity.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const incompleteGroups = await db.hreflangGroup.findMany({
    where: { status: { in: ["pending_siblings", "partial"] } },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });

  const suggestions = [];

  for (const group of incompleteGroups) {
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

    if (best && bestScore >= REVIEW_THRESHOLD && bestScore < AUTO_MATCH_THRESHOLD) {
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
          <s-paragraph>No suggested matches right now. High-confidence matches (handle similarity 80%+, or identical SKU) are linked automatically.</s-paragraph>
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
                    {group.items.map((item) => `${item.storeId}: ${item.title}`).join(" / ")}
                  </s-table-cell>
                  <s-table-cell>
                    {candidate.storeId}: {candidate.title}
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
