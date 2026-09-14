import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const definitionsResponse = await admin.graphql(
    `#graphql
    query {
      metaobjectDefinitions(first: 50) {
        nodes {
          id
          type
          name
        }
      }
    }`,
  );
  const definitionsJson = await definitionsResponse.json();
  const definition = definitionsJson.data.metaobjectDefinitions.nodes.find(
    (node) => node.name === "Example",
  );

  if (!definition) {
    return { ok: true, message: "No 'Example' metaobject definition found." };
  }

  const deleteResponse = await admin.graphql(
    `#graphql
    mutation DeleteMetaobjectDefinition($id: ID!) {
      metaobjectDefinitionDelete(id: $id) {
        deletedId
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { id: definition.id } },
  );
  const deleteJson = await deleteResponse.json();

  return {
    ok: true,
    deletedId: deleteJson.data.metaobjectDefinitionDelete.deletedId,
    userErrors: deleteJson.data.metaobjectDefinitionDelete.userErrors,
  };
};
