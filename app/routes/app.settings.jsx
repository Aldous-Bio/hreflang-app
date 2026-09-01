import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { listStores, createStore, updateStore, deleteStore } from "../services/stores.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { stores: await listStores() };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const data = {
    storeId: formData.get("storeId")?.trim(),
    shopDomain: formData.get("shopDomain")?.trim(),
    label: formData.get("label")?.trim(),
    locale: formData.get("locale")?.trim(),
    publicUrl: formData.get("publicUrl")?.trim(),
  };

  try {
    if (intent === "createStore") {
      await createStore(data);
      return { ok: true };
    }

    if (intent === "updateStore") {
      await updateStore(Number(formData.get("id")), data);
      return { ok: true };
    }

    if (intent === "deleteStore") {
      await deleteStore(Number(formData.get("id")));
      return { ok: true };
    }
  } catch (error) {
    return { error: error.message };
  }

  return null;
};

function StoreModal({ editingStore, modalKey }) {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const formRef = useRef(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      shopify.modal.hide("store-modal");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  return (
    <s-modal id="store-modal" heading={editingStore ? "Editar tienda" : "Añadir tienda"}>
      <fetcher.Form method="post" id="store-form" ref={formRef} key={modalKey}>
        <s-stack gap="base">
          <input type="hidden" name="intent" value={editingStore ? "updateStore" : "createStore"} />
          {editingStore && <input type="hidden" name="id" value={editingStore.id} />}

          <s-text-field
            name="storeId"
            label="ID interno (slug)"
            placeholder="main-es"
            defaultValue={editingStore?.storeId ?? ""}
            required
          ></s-text-field>
          <s-text-field
            name="shopDomain"
            label="Dominio *.myshopify.com"
            placeholder="mi-tienda.myshopify.com"
            defaultValue={editingStore?.shopDomain ?? ""}
            required
          ></s-text-field>
          <s-text-field
            name="label"
            label="Nombre"
            placeholder="España"
            defaultValue={editingStore?.label ?? ""}
            required
          ></s-text-field>
          <s-text-field
            name="locale"
            label="Idioma"
            placeholder="es"
            defaultValue={editingStore?.locale ?? ""}
            required
          ></s-text-field>
          <s-url-field
            name="publicUrl"
            label="URL pública"
            placeholder="https://mitienda.com"
            defaultValue={editingStore?.publicUrl ?? ""}
            required
          ></s-url-field>

          {fetcher.data?.error && <s-text tone="critical">Error: {fetcher.data.error}</s-text>}
        </s-stack>
      </fetcher.Form>

      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => formRef.current?.requestSubmit()}
        loading={fetcher.state !== "idle"}
      >
        Guardar
      </s-button>
      <s-button slot="secondary-actions" commandFor="store-modal" command="--hide">
        Cancelar
      </s-button>
    </s-modal>
  );
}

export default function Settings() {
  const { stores } = useLoaderData();
  const [editingStore, setEditingStore] = useState(null);
  const [modalKey, setModalKey] = useState(0);
  const deleteFetcher = useFetcher();

  function openModal(store) {
    setEditingStore(store);
    setModalKey((key) => key + 1);
  }

  return (
    <s-page heading="Configuración">
      <s-section heading="Tiendas">
       <s-stack gap="base">
        <s-button commandFor="store-modal" command="--show" onClick={() => openModal(null)}>
          Añadir tienda
        </s-button>

        {stores.length === 0 ? (
          <s-paragraph>No hay tiendas configuradas todavía.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>ID interno</s-table-header>
              <s-table-header>Dominio</s-table-header>
              <s-table-header>Nombre</s-table-header>
              <s-table-header>Idioma</s-table-header>
              <s-table-header>URL pública</s-table-header>
              <s-table-header>Acciones</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stores.map((store) => (
                <s-table-row key={store.id}>
                  <s-table-cell>{store.storeId}</s-table-cell>
                  <s-table-cell>{store.shopDomain}</s-table-cell>
                  <s-table-cell>{store.label}</s-table-cell>
                  <s-table-cell>{store.locale}</s-table-cell>
                  <s-table-cell>
                    <s-link href={store.publicUrl} target="_blank">
                      {store.publicUrl}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <div style={{ display: "flex", flexWrap: "nowrap", gap: "8px" }}>
                      <s-button
                        commandFor="store-modal"
                        command="--show"
                        icon="edit"
                        accessibilityLabel="Editar"
                        onClick={() => openModal(store)}
                      ></s-button>
                      <deleteFetcher.Form method="post">
                        <input type="hidden" name="intent" value="deleteStore" />
                        <input type="hidden" name="id" value={store.id} />
                        <s-button type="submit" tone="critical" icon="delete" accessibilityLabel="Borrar"></s-button>
                      </deleteFetcher.Form>
                    </div>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
       </s-stack>
      </s-section>

      <StoreModal editingStore={editingStore} modalKey={modalKey} />
    </s-page>
  );
}
