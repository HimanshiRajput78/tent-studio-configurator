import type { TentDesign } from "../components/Editor2D/TentDesignEditor";
import type { TentPricingResult } from "../services/pricingService";

export interface TentConfigurationInput {
  model: { name: string; path: string };
  setup: {
    product: "canopy-frame" | "canopy-only";
    frameType: "standard" | "light-up";
    sideWalls: "none" | "1" | "3";
    wallPrinting: "single" | "double";
    halfWalls: "none" | "single" | "double";
  };
  colors: {
    fabric: string;
    inner: string;
    frame: string;
  };
  panelDesigns: Record<"front" | "back" | "left" | "right" | "roof", TentDesign>;
  pricing: TentPricingResult | null;
  quantity: number;
}

export interface TentConfiguration {
  schemaVersion: "1.0.0";
  product: {
    id: "custom-canopy-tent";
    name: string;
    modelPath: string;
  };
  selections: TentConfigurationInput["setup"];
  colors: TentConfigurationInput["colors"];
  branding: Record<
    "front" | "back" | "left" | "right" | "roof",
    {
      companyText: string;
      textColor: string;
      fontSize: number;
      logo: string | null;
      position: { x: number; y: number };
      image: string | null;
    }
  >;
  pricing: {
    currency: "INR";
    quantity: number;
    unitPrice: number | null;
    totalPrice: number | null;
    breakdown: TentPricingResult["breakdown"] | null;
    source: string | null;
  };
  metadata: {
    createdAt: string;
    application: "Tent Studio";
  };
}

export function buildTentConfiguration(
  input: TentConfigurationInput,
): TentConfiguration {
  const branding = Object.fromEntries(
    (Object.keys(input.panelDesigns) as Array<keyof TentConfigurationInput["panelDesigns"]>)
      .map((panel) => {
        const design = input.panelDesigns[panel];
        return [
          panel,
          {
            companyText: design.companyText,
            textColor: design.textColor,
            fontSize: design.fontSize,
            logo: design.logo,
            position: { ...design.position },
            image: design.image,
          },
        ];
      }),
  ) as TentConfiguration["branding"];

  const unitPrice = input.pricing?.total ?? null;

  return {
    schemaVersion: "1.0.0",
    product: {
      id: "custom-canopy-tent",
      name: input.model.name,
      modelPath: input.model.path,
    },
    selections: { ...input.setup },
    colors: { ...input.colors },
    branding,
    pricing: {
      currency: "INR",
      quantity: input.quantity,
      unitPrice,
      totalPrice: unitPrice === null ? null : unitPrice * input.quantity,
      breakdown: input.pricing?.breakdown ?? null,
      source: input.pricing?.source ?? null,
    },
    metadata: {
      createdAt: new Date().toISOString(),
      application: "Tent Studio",
    },
  };
}

export function downloadConfigurationJson(
  configuration: TentConfiguration,
): void {
  const json = JSON.stringify(configuration, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `tent-configuration-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
