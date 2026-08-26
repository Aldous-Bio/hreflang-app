# Hreflang App

Shopify app privada que gestiona automáticamente las etiquetas **hreflang** SEO entre las 4 tiendas multiidioma de Aldous Bio:

| Tienda    | Idioma | Dominio               |
| --------- | ------ | -------------------   |
| main-es   | ES     | aldousbio.com         |
| main-it   | IT     | aldousbio.it          |
| main-pt   | PT     | aldousbio.pt          |
| main-fr   | FR     | aldousbio.fr          |

## Qué problema resuelve

Antes, para que un producto o colección tuviera el hreflang correcto había que:

1. Crear el mismo contenido en las 4 tiendas.
2. Asignar **manualmente** el mismo valor en el metafield `custom.href_lang_id` a las 4 versiones.
3. Esperar a que un cronjob externo detectara los IDs coincidentes y rellenara `custom.href_lang` con las URLs de las otras tiendas.

Esta app elimina el paso manual: escucha los webhooks de las 4 tiendas en tiempo real, busca automáticamente la "pareja" equivalente en las otras tiendas y rellena los dos metafields sin intervención humana.

## Cómo funciona

**Solo cubre productos y colecciones.** Shopify no ofrece webhooks de creación/actualización/borrado para páginas ni artículos de blog desde que migró esos recursos a los tipos GraphQL `Page`/`Article` (API 2024-10) — los topics clásicos `pages/*` y `articles/*` ya no existen, así que no hay forma de enterarse en tiempo real de cambios en ese contenido. Páginas y artículos quedan fuera del matching automático hasta que se implemente algún tipo de sincronización manual/periódica (fuera del alcance de esta versión).

Cada vez que se crea, actualiza o borra un producto o colección en cualquiera de las 4 tiendas, la app:

1. **Registra el recurso** en su base de datos (tabla `HreflangItem`), asociado a un "grupo" hreflang (`HreflangGroup`).
2. **Busca una pareja** en las otras tiendas usando estos criterios, por orden de prioridad:
   - **SKU idéntico** (solo productos) → confianza 95%, se enlaza automáticamente.
   - **Handle muy similar** (≥80%) → confianza 75%, se enlaza automáticamente.
   - **Handle moderadamente similar** (55–80%) → no se enlaza solo, aparece como sugerencia en la página "Pending review" para aprobación manual.
   - Si el recurso ya tiene un `custom.href_lang_id` asignado manualmente (compatibilidad con el sistema anterior), la app respeta ese ID y añade el recurso a ese mismo grupo en vez de crear uno nuevo.
3. **Actualiza los metafields** `custom.href_lang_id` y `custom.href_lang` en todas las tiendas del grupo, en cada tienda con las URLs de las otras.
4. **Registra el estado del grupo**: `pending_siblings` (huérfano, solo 1 tienda), `partial` (2–3 tiendas) o `complete` (las 4 tiendas).

Como cada recurso se registra en la base de datos en el momento en que ocurre su webhook, el matching es una simple consulta local — no hace falta llamar a la API de las otras tiendas en cada evento, solo cuando toca escribir el metafield en el resultado del match.

**Limitación conocida:** el matching automático solo funciona sobre contenido creado o actualizado *después* de instalar la app (porque depende de los webhooks). El contenido antiguo que nunca ha disparado un webhook debe enlazarse manualmente desde "Manual matching", o se enlazará solo la próxima vez que se edite en cualquiera de las 2 tiendas.

**No incluido en esta versión:** matching por traducción automática del título (requeriría una API de traducción de pago) y el script de importación del JSON legado — quedaron fuera de alcance a propósito, ver más abajo.

## Páginas de la app

- **Dashboard** (`/app`): contadores por estado (completos, parciales, huérfanos) y tabla de los últimos grupos.
- **Pending review** (`/app/pending-review`): sugerencias de match con confianza media (55–80%) para aprobar o descartar a mano.
- **Manual matching** (`/app/manual-matching`): buscador por título/handle/SKU para enlazar manualmente dos recursos de distintas tiendas.

## Arquitectura técnica

Construida sobre el template oficial de Shopify (`npm init @shopify/app@latest`): **React Router** + **Prisma** + componentes web de **Polaris** (`s-page`, `s-table`, etc.), sin necesidad de un backend Express ni un cliente React aparte.

- **Multi-tienda sin tabla extra**: la app se instala una vez en cada una de las 4 tiendas. La tabla `Session` que ya trae el template (vía `PrismaSessionStorage`) guarda el token de acceso de cada tienda — se reutiliza para hacer llamadas a la Admin API de las otras tiendas cuando hay que escribir un metafield cruzado (`unauthenticated.admin(shopDomain)` en `app/shopify.server.js`).
- **Base de datos**: PostgreSQL vía Prisma (`prisma/schema.prisma`), pensado para Supabase u otro proveedor Postgres gestionado.
- **Motor de matching**: `app/services/matchingEngine.server.js`.
- **Escritura de metafields**: `app/services/shopifyResource.server.js`.
- **Webhooks**: `app/routes/webhooks.{products,collections}.jsx`, declarados en `shopify.app.toml`.
- **Configuración de tiendas**: variable de entorno `STORE_MAP` (ver `.env.example`), leída por `app/config/stores.server.js`.

## Puesta en marcha

### Requisitos

- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) instalado.
- Una base de datos PostgreSQL (por ejemplo, un proyecto gratuito de [Supabase](https://supabase.com/)).

### Variables de entorno

Copia `.env.example` a `.env` y rellena:

- `DATABASE_URL`: cadena de conexión a Postgres.
- `STORE_MAP`: array JSON con los 4 dominios `*.myshopify.com` reales, su `storeId`, idioma y URL pública. Ver el propio `.env.example` para el formato exacto.

### Base de datos

```shell
npx prisma migrate dev --name add_hreflang_tables
```

### Desarrollo local

```shell
npm run dev
```

Pulsa `P` para abrir la URL de la app e instalarla en una tienda de desarrollo. Repite la instalación en las 4 tiendas — sin eso, la escritura de metafields cruzados fallará porque no habrá token guardado para esa tienda.

### Comprobar que funciona

1. Crea (o edita) dos productos con el mismo SKU en dos tiendas distintas.
2. Revisa la tabla `HreflangItem`/`HreflangGroup` con `npx prisma studio`.
3. Comprueba en el admin de Shopify que ambos productos tienen ya `custom.href_lang_id` y `custom.href_lang` rellenos.

## Despliegue

Sigue la [guía de despliegue de Shopify](https://shopify.dev/docs/apps/launch/deployment) para alojar la app (Railway, Render, Fly.io, Google Cloud Run...). Recuerda configurar `DATABASE_URL`, `STORE_MAP` y `NODE_ENV=production` como variables de entorno en el hosting elegido.

## Problemas conocidos / troubleshooting

### "The table `HreflangGroup` does not exist"

No se ha corrido la migración de Prisma. Ejecuta `npx prisma migrate dev` (desarrollo) o `npx prisma migrate deploy` (producción, ya integrado en el script `setup`).

### El `admin` llega `undefined` en un webhook

Pasa cuando el webhook lo dispara una tienda que no tiene la app instalada (o se prueba con `shopify app webhook trigger`, que usa una tienda ficticia). Es el comportamiento esperado: sin sesión guardada no hay token con el que llamar a la Admin API.

### Los metafields no se escriben en las otras tiendas

Comprueba que la app está instalada en las 4 tiendas (debe haber una fila por tienda en la tabla `Session`) y que los dominios en `STORE_MAP` son exactamente los `*.myshopify.com`, no los dominios personalizados.

## Recursos

- [Documentación de Shopify Apps](https://shopify.dev/docs/apps/getting-started)
- [Shopify App React Router](https://shopify.dev/docs/api/shopify-app-react-router)
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components)
- [Metafields](https://shopify.dev/docs/apps/build/custom-data/metafields)
