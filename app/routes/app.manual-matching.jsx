import { Form, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { attachItemToGroup } from "../services/matchingEngine.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  const items = q
    ? await db.hreflangItem.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { handle: { contains: q } },
            { sku: { contains: q } },
          ],
        },
        include: { group: true },
        take: 50,
        orderBy: { title: "asc" },
      })
    : [];

  return { q, items };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();

  const targetItemId = Number(formData.get("targetItemId"));
  const sourceItemId = Number(formData.get("sourceItemId"));

  const targetItem = await db.hreflangItem.findUnique({ where: { id: targetItemId } });
  if (!targetItem) {
    return { error: "Target item not found" };
  }

  try {
    await attachItemToGroup(sourceItemId, targetItem.groupId, {
      criteria: "manual",
      confidence: 100,
    });
  } catch (error) {
    return { error: error.message };
  }

  return { ok: true };
};

export default function ManualMatching() {
  const { q, items } = useLoaderData();
  const [searchParams] = useSearchParams();

  return (
    <s-page heading="Manual matching">
      <s-section heading="Search products, collections, pages, and articles">
        <Form method="get">
          <s-stack direction="inline" gap="base">
            <s-text-field
              name="q"
              label="Search by title, handle, or SKU"
              defaultValue={searchParams.get("q") ?? ""}
            ></s-text-field>
            <s-button type="submit">Search</s-button>
          </s-stack>
        </Form>
      </s-section>

      {q && (
        <s-section heading={`Results for "${q}"`}>
          {items.length === 0 ? (
            <s-paragraph>No matches found.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Item ID</s-table-header>
                <s-table-header>Store</s-table-header>
                <s-table-header>Title</s-table-header>
                <s-table-header>Handle</s-table-header>
                <s-table-header>SKU</s-table-header>
                <s-table-header>Group</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {items.map((item) => (
                  <s-table-row key={item.id}>
                    <s-table-cell>{item.id}</s-table-cell>
                    <s-table-cell>{item.storeId}</s-table-cell>
                    <s-table-cell>{item.title}</s-table-cell>
                    <s-table-cell>{item.handle}</s-table-cell>
                    <s-table-cell>{item.sku ?? "—"}</s-table-cell>
                    <s-table-cell>
                      {item.group.hreflangId} ({item.group.status})
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      )}

      <s-section heading="Link two items" slot="aside">
        <s-paragraph>
          Enter the Item ID (from the search results) of the item whose group should stay, and the Item ID of
          the item from a different store you want to add to that group.
        </s-paragraph>
        <Form method="post">
          <s-stack gap="base">
            <s-text-field name="targetItemId" label="Item ID to keep (target group)" type="number"></s-text-field>
            <s-text-field name="sourceItemId" label="Item ID to attach" type="number"></s-text-field>
            <s-button type="submit" variant="primary">
              Link items
            </s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
