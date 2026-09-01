import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { listStores } from "../services/stores.server";
import { resolveResourceByUrl } from "../services/resourceCatalog.server";
import { syncEntryMetafields } from "../services/hreflangMetafield.server";

const RESOURCE_TYPES = [
  { value: "product", label: "Productos" },
  { value: "collection", label: "Colecciones" },
  { value: "page", label: "Páginas" },
  { value: "blog", label: "Blogs" },
  { value: "article", label: "Artículos de blog" },
];

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "product";

  const [stores, entries, maxDisplayId] = await Promise.all([
    listStores(),
    db.hreflangEntry.findMany({
      where: { resourceType: type },
      include: { links: { include: { store: true } } },
      orderBy: { displayId: "asc" },
    }),
    db.hreflangEntry.aggregate({ where: { resourceType: type }, _max: { displayId: true } }),
  ]);

  return {
    stores,
    entries,
    type,
    nextDisplayId: (maxDisplayId._max.displayId ?? 0) + 1,
  };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "deleteEntry") {
      await db.hreflangEntry.delete({ where: { id: Number(formData.get("entryId")) } });
      return { ok: true };
    }

    if (intent === "saveEntry") {
      const resourceType = formData.get("resourceType");
      const displayId = Number(formData.get("displayId"));
      const entryIdRaw = formData.get("entryId");
      const stores = await listStores();

      const entry = entryIdRaw
        ? await db.hreflangEntry.update({ where: { id: Number(entryIdRaw) }, data: { displayId } })
        : await db.hreflangEntry.create({ data: { resourceType, displayId } });

      for (const store of stores) {
        const rawUrl = formData.get(`url__${store.storeId}`)?.trim();
        const existingLink = await db.hreflangLink.findUnique({
          where: { entryId_storeId: { entryId: entry.id, storeId: store.id } },
        });

        if (!rawUrl) {
          if (existingLink) await db.hreflangLink.delete({ where: { id: existingLink.id } });
          continue;
        }

        const gid = formData.get(`gid__${store.storeId}`)?.trim() || null;
        let linkData = {
          url: rawUrl,
          source: gid ? "picker" : "manual",
          shopifyGid: gid,
          handle: formData.get(`handle__${store.storeId}`)?.trim() || null,
          title: formData.get(`title__${store.storeId}`)?.trim() || null,
        };

        if (!linkData.shopifyGid) {
          const resolved = await resolveResourceByUrl(store, resourceType, rawUrl);
          if (resolved.result) {
            linkData = { ...linkData, ...resolved.result };
          }
        }

        await db.hreflangLink.upsert({
          where: { entryId_storeId: { entryId: entry.id, storeId: store.id } },
          update: linkData,
          create: { entryId: entry.id, storeId: store.id, ...linkData },
        });
      }

      await syncEntryMetafields(entry.id);
      return { ok: true };
    }
  } catch (error) {
    return { error: error.message };
  }

  return null;
};

function StoreLinkField({ store, resourceType, link }) {
  const gidRef = useRef(null);
  const handleRef = useRef(null);
  const titleRef = useRef(null);
  const urlRef = useRef(null);
  const searchRef = useRef(null);
  const searchFetcher = useFetcher();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query.trim()) return undefined;
    const timeout = setTimeout(() => {
      searchFetcher.load(
        `/app/resource-search?resourceType=${resourceType}&storeId=${store.id}&q=${encodeURIComponent(query)}`,
      );
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function selectResult(result) {
    urlRef.current.value = result.url;
    gidRef.current.value = result.gid;
    handleRef.current.value = result.handle;
    titleRef.current.value = result.title;
    searchRef.current.value = "";
    setQuery("");
    setOpen(false);
  }

  function clearResolution() {
    gidRef.current.value = "";
    handleRef.current.value = "";
    titleRef.current.value = "";
  }

  const results = searchFetcher.data?.results ?? [];
  const searchError = searchFetcher.data?.error;

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="tight">
        <s-text type="strong">{store.label}</s-text>

        <input type="hidden" ref={gidRef} name={`gid__${store.storeId}`} defaultValue={link?.shopifyGid ?? ""} />
        <input type="hidden" ref={handleRef} name={`handle__${store.storeId}`} defaultValue={link?.handle ?? ""} />
        <input type="hidden" ref={titleRef} name={`title__${store.storeId}`} defaultValue={link?.title ?? ""} />

        <s-url-field
          ref={urlRef}
          name={`url__${store.storeId}`}
          label="URL"
          placeholder="https://..."
          defaultValue={link?.url ?? ""}
          onInput={clearResolution}
        ></s-url-field>

        <div style={{ position: "relative" }}>
          <s-search-field
            ref={searchRef}
            label="Buscar en esta tienda"
            placeholder="Buscar por título..."
            onInput={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
          ></s-search-field>

          {open && (searchFetcher.state !== "idle" || searchError || query.trim()) && (
            <div
              style={{
                position: "absolute",
                insetInlineStart: 0,
                insetInlineEnd: 0,
                top: "100%",
                marginTop: "4px",
                zIndex: 30,
                maxHeight: "220px",
                overflowY: "auto",
                background: "#fff",
                border: "1px solid #e1e1e1",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
              }}
            >
              <s-box padding="tight">
                <s-stack gap="tight">
                  {searchFetcher.state !== "idle" && <s-text tone="subdued">Buscando…</s-text>}

                  {searchFetcher.state === "idle" && searchError && (
                    <s-text tone="critical">{searchError}</s-text>
                  )}

                  {searchFetcher.state === "idle" && !searchError && results.length === 0 && (
                    <s-text tone="subdued">Sin resultados para «{query}».</s-text>
                  )}

                  {results.map((result) => (
                    <s-clickable key={result.gid} onClick={() => selectResult(result)}>
                      <s-grid gridTemplateColumns="auto 1fr" gap="tight" alignItems="center">
                        {result.image ? (
                          <s-thumbnail src={result.image} alt={result.title} size="small"></s-thumbnail>
                        ) : (
                          <s-box></s-box>
                        )}
                        <s-text>
                          {result.title} ({result.handle})
                        </s-text>
                      </s-grid>
                    </s-clickable>
                  ))}
                </s-stack>
              </s-box>
            </div>
          )}
        </div>

        {link?.lastError && <s-text tone="critical">Error al sincronizar: {link.lastError}</s-text>}
      </s-stack>
    </s-box>
  );
}

function EntryModal({ resourceType, stores, nextDisplayId, editingEntry, modalKey }) {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const formRef = useRef(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      shopify.modal.hide("entry-modal");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  function linkForStore(storeId) {
    return editingEntry?.links.find((link) => link.storeId === storeId) ?? null;
  }

  return (
    <s-modal id="entry-modal" heading={editingEntry ? "Editar entrada" : "Añadir entrada"}>
      <fetcher.Form method="post" id="entry-form" ref={formRef} key={modalKey}>
        <s-stack gap="base">
          <input type="hidden" name="intent" value="saveEntry" />
          <input type="hidden" name="resourceType" value={resourceType} />
          {editingEntry && <input type="hidden" name="entryId" value={editingEntry.id} />}

          <s-number-field
            name="displayId"
            label="ID"
            defaultValue={editingEntry?.displayId ?? nextDisplayId}
          ></s-number-field>

          {stores.map((store) => (
            <StoreLinkField
              key={store.id}
              store={store}
              resourceType={resourceType}
              link={linkForStore(store.id)}
            />
          ))}

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
      <s-button slot="secondary-actions" commandFor="entry-modal" command="--hide">
        Cancelar
      </s-button>
    </s-modal>
  );
}

export default function PagesDashboard() {
  const { stores, entries, type, nextDisplayId } = useLoaderData();
  const [searchParams] = useSearchParams();
  const [editingEntry, setEditingEntry] = useState(null);
  const [modalKey, setModalKey] = useState(0);
  const deleteFetcher = useFetcher();

  function openModal(entry) {
    setEditingEntry(entry);
    setModalKey((key) => key + 1);
  }

  function typeHref(value) {
    const params = new URLSearchParams(searchParams);
    params.set("type", value);
    return `?${params.toString()}`;
  }

  return (
    <s-page heading="Hreflang · Páginas">
      <s-section>
        <s-stack direction="inline" gap="base">
          {RESOURCE_TYPES.map((resourceType) => (
            <s-link key={resourceType.value} href={typeHref(resourceType.value)}>
              {resourceType.value === type ? <s-badge>{resourceType.label}</s-badge> : resourceType.label}
            </s-link>
          ))}
        </s-stack>
      </s-section>

      <s-section heading={RESOURCE_TYPES.find((resourceType) => resourceType.value === type)?.label}>
       <s-stack gap="base">
        <s-button
          commandFor="entry-modal"
          command="--show"
          onClick={() => openModal(null)}
        >
          Añadir entrada
        </s-button>

        {stores.length === 0 ? (
          <s-paragraph>
            No hay tiendas configuradas todavía. Añádelas en{" "}
            <s-link href="/app/settings">Configuración</s-link>.
          </s-paragraph>
        ) : entries.length === 0 ? (
          <s-paragraph>No hay entradas todavía.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>ID</s-table-header>
              {stores.map((store) => (
                <s-table-header key={store.id}>{store.label}</s-table-header>
              ))}
              <s-table-header>Acciones</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {entries.map((entry) => (
                <s-table-row key={entry.id}>
                  <s-table-cell>{entry.displayId}</s-table-cell>
                  {stores.map((store) => {
                    const link = entry.links.find((candidate) => candidate.storeId === store.id);
                    return (
                      <s-table-cell key={store.id}>
                        {link ? (
                          <s-link href={link.url} target="_blank">
                            {link.title ?? link.handle ?? link.url}
                          </s-link>
                        ) : (
                          "—"
                        )}
                      </s-table-cell>
                    );
                  })}
                  <s-table-cell>
                    <s-stack direction="inline" gap="base">
                      <s-button
                        commandFor="entry-modal"
                        command="--show"
                        onClick={() => openModal(entry)}
                      >
                        Editar
                      </s-button>
                      <deleteFetcher.Form method="post">
                        <input type="hidden" name="intent" value="deleteEntry" />
                        <input type="hidden" name="entryId" value={entry.id} />
                        <s-button type="submit" tone="critical">
                          Borrar
                        </s-button>
                      </deleteFetcher.Form>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
       </s-stack>
      </s-section>

      <EntryModal
        resourceType={type}
        stores={stores}
        nextDisplayId={nextDisplayId}
        editingEntry={editingEntry}
        modalKey={modalKey}
      />
    </s-page>
  );
}
