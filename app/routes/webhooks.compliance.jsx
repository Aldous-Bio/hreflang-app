import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
    // authenticate.webhook valida el HMAC; si no es válido, responde 401 por sí solo
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    switch (topic) {
        case "CUSTOMERS_DATA_REQUEST":
        case "CUSTOMERS_REDACT":
            // La app no guarda datos de clientes: no hay nada que devolver ni borrar
            break;
        case "SHOP_REDACT":
            // Llega 48h después de desinstalar: borrar los datos de esa tienda
            await db.session.deleteMany({ where: { shop } });
            break;
    }

    return new Response();
};
