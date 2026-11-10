import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-10";

interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
  expires_in: number;
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function validateShopifyConfig(): void {
  if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Shopify configuration missing. Check your root .env file.");
  }
}

export async function getAdminAccessToken(): Promise<string> {
  validateShopifyConfig();

  if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  const tokenUrl = `https://${SHOP}.myshopify.com/admin/oauth/access_token`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Shopify authentication failed: ${JSON.stringify(result)}`);
  }

  const tokenData = result as ShopifyTokenResponse;
  if (!tokenData.access_token || !tokenData.expires_in) {
    throw new Error("Shopify did not return a valid access token.");
  }

  cachedToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + tokenData.expires_in * 1000;

  console.log("Shopify Admin API authentication successful.");
  console.log("Granted scopes:", tokenData.scope);
  return cachedToken;
}

export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const token = await getAdminAccessToken();
  const endpoint = `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Shopify API request failed: ${JSON.stringify(result)}`);
  }
  if (result.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(result.errors)}`);
  }
  return result.data as T;
}
