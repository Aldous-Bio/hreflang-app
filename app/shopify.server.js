import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { ensureStoreForShop } from "./services/stores.server";

const ALLOWED_SHOPS = new Set([
  "aldous-bio.myshopify.com",
  "aldous-fr.myshopify.com",
  "rmmxs2-qt.myshopify.com",
  "aldous-pt.myshopify.com",
]);

function isShopAllowed(shopDomain) {
  return ALLOWED_SHOPS.has(shopDomain);
}

export async function requireAuthorizedShop(request) {
  const session = await authenticate.admin(request);
  if (!isShopAllowed(session.session.shop)) {
    throw new Response("Unauthorized shop", { status: 403 });
  }
  return session;
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      if (!isShopAllowed(session.shop)) {
        throw new Error(`Shop ${session.shop} is not authorized to use this app`);
      }
      await ensureStoreForShop(session.shop, admin);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
export { isShopAllowed };
