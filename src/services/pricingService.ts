
/**
 * Mock Pricing API for Tent Studio
 */

export type TentSize =
  | "5 × 5 Tent"
  | "6.5 × 6.5 Tent"
  | "8 × 8 Tent";

export type TentProductType =
  | "canopy-frame"
  | "canopy-only";

export type TentFrameType =
  | "standard"
  | "light-up";

export type TentSideWalls = "none" | "1" | "3";
export type TentPrinting = "single" | "double";
export type TentHalfWalls = "none" | "single" | "double";

export interface TentPricingRequest {
  size: TentSize;
  product: TentProductType;
  frameType: TentFrameType;
  sideWalls: TentSideWalls;
  wallPrinting: TentPrinting;
  halfWalls: TentHalfWalls;
}

export interface TentPricingBreakdown {
  basePrice: number;
  framePrice: number;
  sideWallPrice: number;
  printingPrice: number;
  halfWallPrice: number;
}

export interface TentPricingResult {
  currency: "INR";
  breakdown: TentPricingBreakdown;
  total: number;
  source: "mock-pricing-service";
}

const MOCK_PRICE_CATALOG: Record<string, number> = {
  "5 × 5 Tent": 5000,
  "6.5 × 6.5 Tent": 7500,
  "8 × 8 Tent": 10000,
};

const ADD_ON_PRICES = {
  standardFrame: 2500,
  lightUpFrame: 4500,
  sideWall: 1200,
  doubleSidedPrintingPerWall: 500,
  halfWallSingle: 800,
  halfWallDouble: 1200,
} as const;

export async function getTentPricing(
  request: TentPricingRequest
): Promise<TentPricingResult> {

  // Simulate API response delay
  await new Promise<void>((resolve) =>
    window.setTimeout(resolve, 120)
  );

  const basePrice = MOCK_PRICE_CATALOG[request.size];

  if (typeof basePrice !== "number") {
    throw new Error(
      `Pricing is not available for ${request.size}.`
    );
  }

  const framePrice =
    request.product === "canopy-frame"
      ? request.frameType === "light-up"
        ? ADD_ON_PRICES.lightUpFrame
        : ADD_ON_PRICES.standardFrame
      : 0;

  const wallCount =
    request.sideWalls === "none"
      ? 0
      : Number(request.sideWalls);

  const sideWallPrice =
    wallCount * ADD_ON_PRICES.sideWall;

  const printingPrice =
    wallCount > 0 && request.wallPrinting === "double"
      ? wallCount *
        ADD_ON_PRICES.doubleSidedPrintingPerWall
      : 0;

  const halfWallPrice =
    request.halfWalls === "single"
      ? ADD_ON_PRICES.halfWallSingle
      : request.halfWalls === "double"
        ? ADD_ON_PRICES.halfWallDouble
        : 0;

  const breakdown: TentPricingBreakdown = {
    basePrice,
    framePrice,
    sideWallPrice,
    printingPrice,
    halfWallPrice,
  };

  const total = Object.values(breakdown).reduce(
    (sum, amount) => sum + amount,
    0
  );

  return {
    currency: "INR",
    breakdown,
    total,
    source: "mock-pricing-service",
  };
}
