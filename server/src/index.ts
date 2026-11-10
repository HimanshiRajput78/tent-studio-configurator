import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  getAdminAccessToken,
  shopifyGraphQL,
} from "./shopify.js";

dotenv.config({ path: "../.env" });

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const MAX_PREVIEW_BYTES = 2.5 * 1024 * 1024;

app.use(cors({ origin: "http://localhost:5173" }));
// 4 cart items × 2.5 MB maximum image payload, plus JSON overhead.
app.use(express.json({ limit: "15mb" }));

type TentPricingRequest = {
  size: "5 × 5 Tent" | "6.5 × 6.5 Tent" | "8 × 8 Tent";
  product: "canopy-frame" | "canopy-only";
  frameType: "standard" | "light-up";
  sideWalls: "none" | "1" | "3";
  wallPrinting: "single" | "double";
  halfWalls: "none" | "single" | "double";
};

type CustomerRequest = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryAddress: string;
};

type PreviewUploadResult = {
  url: string;
  fileId: string;
  fileStatus: string;
};

class CartValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartValidationError";
  }
}

const BASE_PRICES: Record<TentPricingRequest["size"], number> = {
  "5 × 5 Tent": 5000,
  "6.5 × 6.5 Tent": 7500,
  "8 × 8 Tent": 10000,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidText(value: unknown, maxLength = 250): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function splitCustomerName(name: string) {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || parts[0],
  };
}

function calculateTentPrice(config: TentPricingRequest): number {
  if (!isObject(config)) throw new CartValidationError("Tent pricing configuration is missing.");
  if (!(config.size in BASE_PRICES)) throw new CartValidationError(`Invalid tent size: ${String(config.size)}.`);
  if (!["canopy-frame", "canopy-only"].includes(config.product)) throw new CartValidationError("Invalid tent product.");
  if (!["standard", "light-up"].includes(config.frameType)) throw new CartValidationError("Invalid frame type.");
  if (!["none", "1", "3"].includes(config.sideWalls)) throw new CartValidationError("Invalid side wall selection.");
  if (!["single", "double"].includes(config.wallPrinting)) throw new CartValidationError("Invalid wall printing.");
  if (!["none", "single", "double"].includes(config.halfWalls)) throw new CartValidationError("Invalid half wall selection.");

  let total = BASE_PRICES[config.size];
  if (config.product === "canopy-frame") total += config.frameType === "light-up" ? 4500 : 2500;

  const wallCount = config.sideWalls === "none" ? 0 : Number(config.sideWalls);
  total += wallCount * 1200;
  if (wallCount > 0 && config.wallPrinting === "double") total += wallCount * 500;
  if (config.halfWalls === "single") total += 800;
  else if (config.halfWalls === "double") total += 1200;

  return total;
}

function parsePreviewDataUrl(value: unknown): { buffer: Buffer; mimeType: string; extension: string } | null {
  if (typeof value !== "string" || !value.startsWith("data:")) return null;

  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new CartValidationError("Preview image must be a base64 PNG, JPEG, or WebP data URL.");

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw new CartValidationError("Preview image is empty.");
  if (buffer.length > MAX_PREVIEW_BYTES) {
    throw new CartValidationError("Each tent preview image must be 2.5 MB or smaller.");
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  return { buffer, mimeType, extension };
}

async function uploadPreviewToShopify(
  dataUrl: unknown,
  itemName: string,
  itemIndex: number
): Promise<PreviewUploadResult | null> {
  const parsed = parsePreviewDataUrl(dataUrl);
  if (!parsed) return null;

  const safeName = itemName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tent";
  const filename = `${safeName}-${Date.now()}-${itemIndex + 1}.${parsed.extension}`;

  const stagedMutation = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `;

  const staged = await shopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(stagedMutation, {
    input: [{
      filename,
      mimeType: parsed.mimeType,
      httpMethod: "POST",
      resource: "FILE",
    }],
  });

  const stagedPayload = staged.stagedUploadsCreate;
  if (stagedPayload.userErrors.length) {
    throw new Error(`Shopify staged upload error: ${JSON.stringify(stagedPayload.userErrors)}`);
  }

  const target = stagedPayload.stagedTargets[0];
  if (!target?.url || !target.resourceUrl) {
    throw new Error("Shopify did not return a staged upload target.");
  }

  const form = new FormData();
  for (const parameter of target.parameters) {
    form.append(parameter.name, parameter.value);
  }
  form.append("file", new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mimeType }), filename);

  const uploadResponse = await fetch(target.url, { method: "POST", body: form });
  if (!uploadResponse.ok) {
    const uploadError = await uploadResponse.text();
    throw new Error(`Shopify binary upload failed (${uploadResponse.status}): ${uploadError.slice(0, 500)}`);
  }

  const fileCreateMutation = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          alt
          ... on MediaImage { image { url } }
        }
        userErrors { field message }
      }
    }
  `;

  const created = await shopifyGraphQL<{
    fileCreate: {
      files: Array<{
        id: string;
        fileStatus: string;
        alt: string | null;
        image?: { url: string } | null;
      }>;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(fileCreateMutation, {
    files: [{
      originalSource: target.resourceUrl,
      contentType: "IMAGE",
      alt: `${itemName} 3D configurator preview`,
    }],
  });

  if (created.fileCreate.userErrors.length) {
    throw new Error(`Shopify fileCreate error: ${JSON.stringify(created.fileCreate.userErrors)}`);
  }

  const file = created.fileCreate.files[0];
  if (!file?.id) throw new Error("Shopify fileCreate did not return a file.");

  // Shopify can initially return PROCESSING. Fetch the MediaImage URL after creation.
  let imageUrl = file.image?.url || "";
  let fileStatus = file.fileStatus;

  if (!imageUrl) {
    const statusQuery = `
      query previewFileStatus($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            id
            fileStatus
            image { url }
          }
        }
      }
    `;

    for (let attempt = 0; attempt < 8 && !imageUrl; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const status = await shopifyGraphQL<{
        node: { id: string; fileStatus: string; image: { url: string } | null } | null;
      }>(statusQuery, { id: file.id });

      if (status.node) {
        fileStatus = status.node.fileStatus;
        imageUrl = status.node.image?.url || "";
        if (fileStatus === "FAILED") break;
      }
    }
  }

  if (!imageUrl) {
    throw new Error(`Shopify file created (${file.id}) but image URL is not ready. Status: ${fileStatus}`);
  }

  return { url: imageUrl, fileId: file.id, fileStatus };
}


type ShopifyProductResult = {
  productId: string;
  variantId: string;
};

/**
 * Creates a Shopify product with the uploaded configurator preview attached.
 * Draft-order line items then reference its variant so Shopify can render the
 * product media thumbnail instead of the generic custom-line-item placeholder.
 */
async function createConfiguratorProduct(
  itemName: string,
  previewUrl: string,
  itemIndex: number
): Promise<ShopifyProductResult> {
  const mutation = `
    mutation createConfiguratorProduct(
      $product: ProductCreateInput!
      $media: [CreateMediaInput!]
    ) {
      productCreate(product: $product, media: $media) {
        product {
          id
          title
          variants(first: 1) {
            nodes { id }
          }
          media(first: 1) {
            nodes {
              ... on MediaImage {
                id
                image { url }
              }
            }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const uniqueTitle = `${itemName} - Tent Studio Custom ${Date.now()}-${itemIndex + 1}`;
  const result = await shopifyGraphQL<{
    productCreate: {
      product: {
        id: string;
        title: string;
        variants: { nodes: Array<{ id: string }> };
        media: { nodes: Array<{ id: string; image: { url: string } | null }> };
      } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(mutation, {
    product: {
      title: uniqueTitle,
      vendor: "Tent Studio",
      productType: "Custom Tent",
      status: "ACTIVE",
      tags: ["Tent Studio", "Configurator", "Custom Preview"],
    },
    media: [{
      originalSource: previewUrl,
      mediaContentType: "IMAGE",
      alt: `${itemName} customized 3D tent preview`,
    }],
  });

  const payload = result.productCreate;
  if (payload.userErrors.length) {
    throw new Error(`Shopify productCreate error: ${JSON.stringify(payload.userErrors)}`);
  }

  const product = payload.product;
  const variantId = product?.variants.nodes[0]?.id;
  if (!product?.id || !variantId) {
    throw new Error(`Shopify product was created without a variant for cart item ${itemIndex + 1}.`);
  }

  console.log(`Shopify configurator product ${itemIndex + 1} created:`, {
    productId: product.id,
    variantId,
    title: product.title,
    mediaAttached: product.media.nodes.length > 0,
  });

  return { productId: product.id, variantId };
}

function buildShopifyLineItem(
  rawItem: unknown,
  index: number,
  previewUrl: string | null,
  variantId: string | null
) {
  if (!isObject(rawItem)) throw new CartValidationError(`Cart item ${index + 1} is missing or invalid.`);
  const item = rawItem;

  const itemName = typeof item.name === "string" ? item.name.trim() : "";
  if (!isValidText(itemName, 150)) throw new CartValidationError(`Cart item ${index + 1}: Invalid item name.`);

  const quantity = Number(item.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new CartValidationError(`Cart item ${index + 1}: Invalid quantity (${String(item.quantity)}).`);
  }

  if (!isObject(item.pricingRequest)) {
    throw new CartValidationError(`Cart item ${index + 1}: pricingRequest is missing.`);
  }

  const config = item.pricingRequest as unknown as TentPricingRequest;
  const unitPrice = calculateTentPrice(config);
  const colors = isObject(item.colors) ? item.colors : {};

  const attributes = [
    { key: "Tent Size", value: String(config.size) },
    { key: "Product", value: config.product === "canopy-frame" ? "Canopy with Frame" : "Canopy Only" },
    { key: "Frame", value: config.product === "canopy-frame" ? String(config.frameType) : "Not applicable" },
    { key: "Side Walls", value: String(config.sideWalls) },
    { key: "Wall Printing", value: String(config.wallPrinting) },
    { key: "Half Walls", value: String(config.halfWalls) },
    { key: "Fabric Color", value: String(colors.fabric || "Not specified") },
    { key: "Inner Color", value: String(colors.inner || "Not specified") },
    { key: "Frame Color", value: String(colors.frame || "Not specified") },
    ...(previewUrl ? [{ key: "Tent Preview URL", value: previewUrl }] : []),
  ];

  // When a variant is supplied, use priceOverride (not
  // originalUnitPriceWithCurrency) to preserve the configurator's calculated INR price.
  if (variantId) {
    return {
      variantId,
      quantity,
      requiresShipping: true,
      priceOverride: {
        amount: unitPrice.toFixed(2),
        currencyCode: "INR" as const,
      },
      customAttributes: attributes,
    };
  }

  // Fallback for carts where no preview image was captured.
  return {
    title: itemName,
    quantity,
    requiresShipping: true,
    originalUnitPriceWithCurrency: {
      amount: unitPrice.toFixed(2),
      currencyCode: "INR" as const,
    },
    customAttributes: attributes,
  };
}

app.get("/api/health", (_req, res) => {
  res.status(200).json({ success: true, message: "Tent Studio Backend is running!", timestamp: new Date().toISOString() });
});

app.get("/api/shopify/test", async (_req, res) => {
  try {
    const token = await getAdminAccessToken();
    res.status(200).json({ success: true, message: "Shopify Admin API connected successfully!", tokenGenerated: Boolean(token) });
  } catch (error) {
    console.error("Shopify authentication error:", error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Shopify authentication failed" });
  }
});

app.get("/api/shopify/store", async (_req, res) => {
  try {
    const data = await shopifyGraphQL<{ shop: { name: string; myshopifyDomain: string } }>(`
      query { shop { name myshopifyDomain } }
    `);
    res.status(200).json({ success: true, message: "Shopify GraphQL API connected!", store: data.shop });
  } catch (error) {
    console.error("Shopify GraphQL error:", error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Shopify GraphQL API failed" });
  }
});

app.post("/api/shopify/draft-order", async (req, res) => {
  try {
    if (!isObject(req.body)) {
      res.status(400).json({ success: false, message: "Invalid request body." });
      return;
    }

    const body = req.body as unknown as CustomerRequest & { items: unknown };
    const { customerName, customerEmail, customerPhone, deliveryAddress, items } = body;

    if (!isValidText(customerName, 100)) {
      res.status(400).json({ success: false, message: "Invalid customerName. Please enter customer name." });
      return;
    }
    if (!isValidText(customerEmail, 254) || !isValidEmail(customerEmail.trim())) {
      res.status(400).json({ success: false, message: "Invalid customerEmail. Please enter a valid email." });
      return;
    }
    if (!isValidText(customerPhone, 25)) {
      res.status(400).json({ success: false, message: "Invalid customerPhone. Please enter phone number with country code." });
      return;
    }
    if (!isValidText(deliveryAddress, 500)) {
      res.status(400).json({ success: false, message: "Invalid deliveryAddress. Please enter delivery address." });
      return;
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
      res.status(400).json({ success: false, message: "Cart must contain between 1 and 20 items." });
      return;
    }

    const { firstName, lastName } = splitCustomerName(customerName);

    // Upload every supplied preview independently. If one fails, keep the failure visible
    // rather than silently creating a draft order that looks like image upload succeeded.
    const uploadedPreviews: Array<{ itemIndex: number; url: string; fileId: string; fileStatus: string }> = [];
    const previewUrls: Array<string | null> = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!isObject(item)) throw new CartValidationError(`Cart item ${index + 1} is invalid.`);
      console.log(`Cart item ${index + 1} received:`, {
        keys: Object.keys(item),
        name: item.name,
        quantity: item.quantity,
        hasPricingRequest: Boolean(item.pricingRequest),
        hasPreviewImage: typeof item.previewImage === "string" && item.previewImage.startsWith("data:image/"),
        previewImageLength: typeof item.previewImage === "string" ? item.previewImage.length : 0,
      });

      try {
        const uploaded = await uploadPreviewToShopify(item.previewImage, String(item.name || `Tent ${index + 1}`), index);
        previewUrls[index] = uploaded?.url || null;
        if (uploaded) {
          uploadedPreviews.push({ itemIndex: index + 1, ...uploaded });
          console.log(`Tent preview ${index + 1} uploaded:`, {
            fileId: uploaded.fileId,
            fileStatus: uploaded.fileStatus,
            url: uploaded.url,
          });
        } else {
          console.warn(`Tent preview ${index + 1} was not supplied. No image uploaded.`);
        }
      } catch (uploadError) {
        console.error(`Tent preview ${index + 1} upload failed:`, uploadError);
        res.status(502).json({
          success: false,
          message: `Tent preview image ${index + 1} upload failed. Draft Order was not created.`,
          error: uploadError instanceof Error ? uploadError.message : String(uploadError),
          uploadedPreviewCount: uploadedPreviews.length,
        });
        return;
      }
    }

    // Create a real Shopify product for each configured cart line that has a preview.
    // The product media becomes the source of the checkout thumbnail.
    const productResults: Array<ShopifyProductResult | null> = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!isObject(item)) throw new CartValidationError(`Cart item ${index + 1} is invalid.`);
      const itemName = typeof item.name === "string" ? item.name.trim() : `Tent ${index + 1}`;
      const previewUrl = previewUrls[index];

      if (previewUrl) {
        try {
          const product = await createConfiguratorProduct(itemName, previewUrl, index);
          productResults[index] = product;
        } catch (productError) {
          console.error(`Shopify product creation failed for cart item ${index + 1}:`, productError);
          res.status(502).json({
            success: false,
            message: `Shopify product/image association failed for tent ${index + 1}. Draft Order was not created.`,
            error: productError instanceof Error ? productError.message : String(productError),
            uploadedPreviewCount: uploadedPreviews.length,
          });
          return;
        }
      } else {
        productResults[index] = null;
      }
    }

    const lineItems = items.map((item, index) =>
      buildShopifyLineItem(
        item,
        index,
        previewUrls[index],
        productResults[index]?.variantId || null
      )
    );
    const customerAttributes = [
      { key: "Customer Name", value: customerName.trim() },
      { key: "Customer Phone", value: customerPhone.trim() },
      { key: "Order Source", value: "Tent Studio Configurator" },
    ];

    const mutation = `
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            name
            invoiceUrl
            totalPriceSet { shopMoney { amount currencyCode } }
          }
          userErrors { field message }
        }
      }
    `;

    const variables = {
      input: {
        email: customerEmail.trim(),
        phone: customerPhone.trim(),
        shippingAddress: {
          firstName,
          lastName,
          address1: deliveryAddress.trim(),
          countryCode: "IN",
          phone: customerPhone.trim(),
        },
        presentmentCurrencyCode: "INR",
        acceptAutomaticDiscounts: false,
        allowDiscountCodesInCheckout: false,
        note: `Tent Studio Configurator Order | Customer: ${customerName.trim()}`,
        tags: ["Tent Studio", "Configurator"],
        customAttributes: customerAttributes,
        lineItems,
      },
    };

    const result = await shopifyGraphQL<{
      draftOrderCreate: {
        draftOrder: {
          id: string;
          name: string;
          invoiceUrl: string | null;
          totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
        } | null;
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>(mutation, variables);

    const response = result.draftOrderCreate;
    if (response.userErrors.length) {
      console.error("Shopify Draft Order errors:", response.userErrors);
      res.status(400).json({ success: false, message: "Shopify could not create the Draft Order.", errors: response.userErrors });
      return;
    }
    if (!response.draftOrder) {
      res.status(502).json({ success: false, message: "Shopify did not return a Draft Order." });
      return;
    }
    if (!response.draftOrder.invoiceUrl) {
      res.status(502).json({ success: false, message: "Draft Order created, but checkout URL is unavailable.", draftOrderId: response.draftOrder.id });
      return;
    }

    console.log("Draft Order created:", response.draftOrder.name);
    res.status(201).json({
      success: true,
      message: "Shopify Draft Order created successfully!",
      uploadedPreviewCount: uploadedPreviews.length,
      uploadedPreviews,
      createdProducts: productResults.filter((item): item is ShopifyProductResult => item !== null),
      draftOrder: {
        id: response.draftOrder.id,
        name: response.draftOrder.name,
        total: response.draftOrder.totalPriceSet.shopMoney.amount,
        currency: response.draftOrder.totalPriceSet.shopMoney.currencyCode,
        invoiceUrl: response.draftOrder.invoiceUrl,
      },
    });
  } catch (error) {
    console.error("Draft Order creation error:", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unable to create Shopify Draft Order.",
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({ success: false, message: "API route not found" });
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ success: false, message: "Invalid JSON request body." });
    return;
  }
  next(error);
});

app.listen(PORT, () => {
  console.log("-----------------------------------");
  console.log("       TENT STUDIO BACKEND");
  console.log("-----------------------------------");
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(`Shopify Auth: http://localhost:${PORT}/api/shopify/test`);
  console.log(`Shopify Store: http://localhost:${PORT}/api/shopify/store`);
  console.log(`Draft Order: http://localhost:${PORT}/api/shopify/draft-order`);
  console.log("-----------------------------------");
  console.log(
    "Shopify Configuration:",
    process.env.SHOPIFY_SHOP && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET
      ? "Loaded"
      : "Missing"
  );
});
