import type { CartItem } from "../components/Cart/CartDrawer";
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://tent-studio-configurator.onrender.com"
).replace(/\/$/, "");

export type CheckoutCustomer = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryAddress: string;
};

type DraftOrderResponse = {
  success: boolean;
  message?: string;
  errors?: Array<{ field?: string[] | null; message: string }>;
  draftOrder?: {
    id: string;
    name: string;
    invoiceUrl: string | null;
    uploadedPreviewCount?: number;
  };
};

function normalizeIndianPhone(phone: string): string {
  const cleaned = phone.replace(/[\s()-]/g, "");
  if (/^[6-9]\d{9}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^91[6-9]\d{9}$/.test(cleaned)) return `+${cleaned}`;
  if (/^\+91[6-9]\d{9}$/.test(cleaned)) return cleaned;
  throw new Error("Enter a valid Indian mobile number, e.g. +919876543210.");
}

export async function createShopifyCheckout(
  items: CartItem[],
  customer: CheckoutCustomer
): Promise<string> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Your cart is empty.");
  }

  if (
    !customer.customerName.trim() ||
    !customer.customerEmail.trim() ||
    !customer.deliveryAddress.trim()
  ) {
    throw new Error("Please complete all customer details.");
  }

  const customerPhone = normalizeIndianPhone(customer.customerPhone);

  const payload = {
    customerName: customer.customerName.trim(),
    customerEmail: customer.customerEmail.trim(),
    customerPhone,
    deliveryAddress: customer.deliveryAddress.trim(),
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      pricingRequest: item.pricingRequest,
      colors: item.colors,
      configuration: item.configuration,
      // Local canvas snapshot captured when the tent was added to cart.
      previewImage: item.previewImage,
    })),
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/shopify/draft-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Cannot reach Tent Studio backend. Start the server on port 5000.");
  }

  const data = (await response.json().catch(() => null)) as DraftOrderResponse | null;

  if (!response.ok || !data?.success) {
    const details = data?.errors?.map((error) => error.message).join("; ");
    throw new Error(details || data?.message || `Checkout request failed (${response.status}).`);
  }

  const invoiceUrl = data.draftOrder?.invoiceUrl;
  if (!invoiceUrl) {
    throw new Error("Draft Order was created but Shopify did not return a checkout URL. Check Shopify Admin before retrying.");
  }

  const url = new URL(invoiceUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".myshopify.com")) {
    throw new Error("Shopify returned an unexpected checkout URL.");
  }

  return url.toString();
}
