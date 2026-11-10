
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import jsPDF from "jspdf";

import TentViewer from "./components/Preview3D/TentViewer";

import { createShopifyCheckout } from "./lib/shopify";
import TentDesignEditor, {
  type TentDesign,
} from "./components/Editor2D/TentDesignEditor";

import CartDrawer, {
  type CartItem,
} from "./components/Cart/CartDrawer";

import {
  getTentPricing,
  type TentPricingRequest,
  type TentPricingResult,
} from "./services/pricingService";
import {
  buildTentConfiguration,
  downloadConfigurationJson,
} from "./utils/tentConfiguration";

import "./App.css";


// ==========================================
// TENT MODELS
// ==========================================

const tentModels = [
  { name: "5 × 5 Tent", path: "/models/Tent_5_5.glb" },
  { name: "6.5 × 6.5 Tent", path: "/models/Tent%206.5_6.5.glb" },
  { name: "8 × 8 Tent", path: "/models/Tent_8_8.glb" },
];

// ==========================================
// DEFAULT COLORS
// ==========================================

const DEFAULT_COLORS = {
  fabric: "#F2D35C",
  inner: "#FFFFFF",
  frame: "#858585",
};

// ==========================================
// DESIGN PANELS
// ==========================================

const panels = [
  { id: "front", name: "Front Panel", icon: "⬆" },
  { id: "back", name: "Back Panel", icon: "⬇" },
  { id: "left", name: "Left Panel", icon: "⬅" },
  { id: "right", name: "Right Panel", icon: "➡" },
  { id: "roof", name: "Roof Panel", icon: "⌂" },
] as const;

type PanelId = (typeof panels)[number]["id"];

// ==========================================
// SETUP TYPES
// ==========================================

type SetupConfiguration = {
  product: "canopy-frame" | "canopy-only";
  frameType: "standard" | "light-up";
  sideWalls: "none" | "1" | "3";
  wallPrinting: "single" | "double";
  halfWalls: "none" | "single" | "double";
};

// ==========================================
// DEFAULT DESIGN
// ==========================================

const createDefaultDesign = (): TentDesign => ({
  companyText: "",
  textColor: "#222222",
  fontSize: 32,
  logo: null,
  position: { x: 350, y: 210 },
  image: null,
});

// ==========================================
// CART STORAGE
// ==========================================

const CART_STORAGE_KEY = "tent-studio-cart";

function loadCart(): CartItem[] {
  try {
    const savedCart = localStorage.getItem(CART_STORAGE_KEY);
    if (!savedCart) return [];

    const parsed: unknown = JSON.parse(savedCart);

    if (!Array.isArray(parsed)) {
      localStorage.removeItem(CART_STORAGE_KEY);
      return [];
    }

    // Remove old cart items without pricing configuration
    const validItems = parsed.filter(
      (item): item is CartItem =>
        item !== null &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.pricingRequest !== null &&
        typeof item.pricingRequest === "object" &&
        typeof item.pricingRequest.size === "string" &&
        typeof item.pricingRequest.product === "string" &&
        typeof item.pricingRequest.frameType === "string" &&
        typeof item.pricingRequest.sideWalls === "string" &&
        typeof item.pricingRequest.wallPrinting === "string" &&
        typeof item.pricingRequest.halfWalls === "string"
    );

    if (validItems.length !== parsed.length) {
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify(validItems)
      );
    }

    return validItems;
  } catch (error) {
    console.error("Unable to load saved cart:", error);
    return [];
  }
}

// Capture a compact JPEG from the live WebGL canvas for Shopify.
function captureTentPreview(): string | undefined {
  const source = document.querySelector<HTMLCanvasElement>(
    ".preview-container canvas"
  );
  if (!source || source.width === 0 || source.height === 0) return undefined;

  try {
    const maxWidth = 900;
    const scale = Math.min(1, maxWidth / source.width);
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(source.width * scale));
    output.height = Math.max(1, Math.round(source.height * scale));
    const context = output.getContext("2d");
    if (!context) return undefined;
    context.drawImage(source, 0, 0, output.width, output.height);
    return output.toDataURL("image/jpeg", 0.72);
  } catch (error) {
    console.warn("Could not capture tent preview:", error);
    return undefined;
  }
}

// ==========================================
// MAIN APP
// ==========================================

function App() {
  // EMBED MODE: enable a clean iframe layout with ?embed=1
  const isEmbedMode =
    new URLSearchParams(window.location.search).get("embed") === "1";

  useEffect(() => {
    document.documentElement.classList.toggle("tent-embed-mode", isEmbedMode);
    document.body.classList.toggle("tent-embed-mode", isEmbedMode);

    return () => {
      document.documentElement.classList.remove("tent-embed-mode");
      document.body.classList.remove("tent-embed-mode");
    };
  }, [isEmbedMode]);

  // TENT MODEL

  const [selectedModel, setSelectedModel] = useState(
    tentModels[2]
  );

  // COLORS

  const [fabricColor, setFabricColor] = useState(
    DEFAULT_COLORS.fabric
  );

  const [innerFabricColor, setInnerFabricColor] = useState(
    DEFAULT_COLORS.inner
  );

  const [frameColor, setFrameColor] = useState(
    DEFAULT_COLORS.frame
  );

  // SELECTED PANEL

  const [selectedPanel, setSelectedPanel] =
    useState<PanelId>("front");

  // SETUP CONFIGURATION

  const [setup, setSetup] = useState<SetupConfiguration>({
    product: "canopy-frame",
    frameType: "standard",
    sideWalls: "none",
    wallPrinting: "single",
    halfWalls: "none",
  });

  // PRICING SERVICE RESPONSE

  const pricingRequest = {
    size: selectedModel.name as "5 × 5 Tent" | "6.5 × 6.5 Tent" | "8 × 8 Tent",
    product: setup.product,
    frameType: setup.frameType,
    sideWalls: setup.sideWalls,
    wallPrinting: setup.wallPrinting,
    halfWalls: setup.halfWalls,
  };
  const pricingRequestKey = JSON.stringify(pricingRequest);
  const [pricingState, setPricingState] = useState<{
    requestKey: string;
    result: TentPricingResult | null;
    error: string | null;
  }>({ requestKey: "", result: null, error: null });

  const pricingLoading = pricingState.requestKey !== pricingRequestKey;
  const pricingResult = pricingLoading ? null : pricingState.result;
  const pricingError = pricingLoading ? null : pricingState.error;

  const pricingRequestId = useRef(0);

  useEffect(() => {
    // Every configuration change gets a newer request id.
    // Only the newest request is allowed to update the displayed price.
    const requestId = ++pricingRequestId.current;
    let isActive = true;

    getTentPricing(JSON.parse(pricingRequestKey) as TentPricingRequest)
      .then((result) => {
        if (isActive && requestId === pricingRequestId.current) {
          setPricingState({ requestKey: pricingRequestKey, result, error: null });
        }
      })
      .catch((error: unknown) => {
        if (isActive && requestId === pricingRequestId.current) {
          setPricingState({
            requestKey: pricingRequestKey,
            result: null,
            error: error instanceof Error ? error.message : "Unable to calculate pricing.",
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, [pricingRequestKey]);

  function updateSetup<K extends keyof SetupConfiguration>(
    key: K,
    value: SetupConfiguration[K]
  ) {
    setSetup((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  // INDEPENDENT PANEL DESIGNS

  const [panelDesigns, setPanelDesigns] = useState<
    Record<PanelId, TentDesign>
  >({
    front: createDefaultDesign(),
    back: createDefaultDesign(),
    left: createDefaultDesign(),
    right: createDefaultDesign(),
    roof: createDefaultDesign(),
  });

  // SAVE SELECTED PANEL DESIGN

  const handleDesignChange = useCallback(
    (design: TentDesign) => {
      setPanelDesigns((previous) => ({
        ...previous,
        [selectedPanel]: design,
      }));
    },
    [selectedPanel]
  );

  // CART STATE

  const [cartItems, setCartItems] = useState<CartItem[]>(loadCart);
  const [productQuantity, setProductQuantity] = useState(1);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [orderConfirmation, setOrderConfirmation] = useState<{
    orderId: string;
    customerName: string;
  } | null>(null);

  const saveCart = (items: CartItem[]) => {
    setCartItems(items);

    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      console.error("Unable to save cart:", error);
    }
  };

  // CHECKOUT

  
  // ==========================================
  // CHECKOUT
  // ==========================================

  const handleStartCheckout = () => {
    if (cartItems.length === 0) {
      alert("Your cart is empty. Please add a tent first.");
      return;
    }

    setCartOpen(false);
    setOrderConfirmation(null);
    setCheckoutOpen(true);
  };

  const handlePlaceOrder = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (checkoutSubmitting) return;

    if (cartItems.length === 0) {
      alert("Your cart is empty.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const customer = {
      customerName: String(formData.get("customerName") ?? "").trim(),
      customerEmail: String(formData.get("customerEmail") ?? "").trim(),
      customerPhone: String(formData.get("customerPhone") ?? "").trim(),
      deliveryAddress: String(formData.get("deliveryAddress") ?? "").trim(),
    };

    setCheckoutSubmitting(true);
    try {
      const checkoutUrl = await createShopifyCheckout(cartItems, customer);
      window.location.assign(checkoutUrl);
    } catch (error) {
      console.error("Shopify checkout error:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Unable to connect to Shopify checkout."
      );
      setCheckoutSubmitting(false);
    }
  };

  // RESET COLORS

  const handleResetColors = () => {
    setFabricColor(DEFAULT_COLORS.fabric);
    setInnerFabricColor(DEFAULT_COLORS.inner);
    setFrameColor(DEFAULT_COLORS.frame);
  };

  // SELECTED PANEL NAME

  const selectedPanelName =
    panels.find((panel) => panel.id === selectedPanel)?.name ??
    "Front Panel";

  // ==========================================
  // PRICING FROM MOCK SERVICE
  // ==========================================

  const basePrice = pricingResult?.breakdown.basePrice ?? 0;
  const framePrice = pricingResult?.breakdown.framePrice ?? 0;
  const sideWallPrice = pricingResult?.breakdown.sideWallPrice ?? 0;
  const printingPrice = pricingResult?.breakdown.printingPrice ?? 0;
  const halfWallPrice = pricingResult?.breakdown.halfWallPrice ?? 0;
  const totalPrice = pricingResult?.total ?? 0;

  // A single, versioned JSON snapshot for sharing, restoring, and production handoff.
  const currentConfiguration = buildTentConfiguration({
    model: selectedModel,
    setup,
    colors: {
      fabric: fabricColor,
      inner: innerFabricColor,
      frame: frameColor,
    },
    panelDesigns,
    pricing: pricingResult,
    quantity: productQuantity,
  });

  const handleDownloadConfiguration = () => {
    downloadConfigurationJson(currentConfiguration);
  };

  // ==========================================
  // SETUP SUMMARY
  // ==========================================

  const setupSummary = [
    selectedModel.name,

    setup.product === "canopy-frame"
      ? "With Frame"
      : "Canopy Only",

    ...(setup.product === "canopy-frame"
      ? [
          setup.frameType === "standard"
            ? "Standard Frame"
            : "Light-Up Frame",
        ]
      : []),

    setup.sideWalls === "none"
      ? "No Side Walls"
      : `${setup.sideWalls} Side Wall${
          setup.sideWalls === "1" ? "" : "s"
        }`,

    ...(setup.sideWalls !== "none"
      ? [
          setup.wallPrinting === "single"
            ? "Single-Sided Printing"
            : "Double-Sided Printing",
        ]
      : []),

    setup.halfWalls === "none"
      ? "No Half Walls"
      : setup.halfWalls === "single"
        ? "Single-Sided Half Walls"
        : "Double-Sided Half Walls",
  ];

  // PRICE FORMATTER

  const formatPrice = (price: number) =>
    `₹${price.toLocaleString("en-IN")}`;

  // ADD CURRENT TENT CONFIGURATION TO CART

  const handleAddToCart = () => {
    if (pricingLoading || pricingError || !pricingResult) return;

    // Capture the exact live tent appearance before adding it to the cart.
    const previewImage = captureTentPreview();

    const newItem: CartItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: selectedModel.name,
      configuration: [...setupSummary],
      unitPrice: totalPrice,
      quantity: productQuantity,
      previewImage,
      colors: {
        fabric: fabricColor,
        inner: innerFabricColor,
        frame: frameColor,
      },
      pricingRequest: {
        size: selectedModel.name as TentPricingRequest["size"],
        product: setup.product,
        frameType: setup.frameType,
        sideWalls: setup.sideWalls,
        wallPrinting: setup.wallPrinting,
        halfWalls: setup.halfWalls,
      },
    };

    saveCart([...cartItems, newItem]);
    setProductQuantity(1);
    setCartOpen(true);
  };

  // UPDATE CART QUANTITY

  const handleQuantityChange = (id: string, quantity: number) => {
    if (quantity < 1) return;

    saveCart(
      cartItems.map((item) =>
        item.id === id ? { ...item, quantity } : item
      )
    );
  };

  // REMOVE CART ITEM

  const handleRemoveFromCart = (id: string) => {
    saveCart(cartItems.filter((item) => item.id !== id));
  };

  // CART ITEM COUNT

  const cartCount = cartItems.reduce(
    (total, item) => total + item.quantity,
    0
  );

  // ==========================================
  // STEP 5: PDF QUOTATION GENERATOR
  // ==========================================

  const downloadQuotation = async () => {
    const previousPanel = selectedPanel;

    // Always capture the quotation from the front perspective, even when
    // the user was editing the roof or another panel.
    if (selectedPanel !== "front") {
      setSelectedPanel("front");
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 950);
      });
    }

    try {
      const doc = new jsPDF();

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const margin = 18;
      const rightEdge = pageWidth - margin;

      let y = 20;

      // PAGE SPACE CHECK

      const checkPageSpace = (requiredSpace = 10) => {
        if (y + requiredSpace > pageHeight - 18) {
          doc.addPage();
          y = 20;
        }
      };

      // SECTION HEADING

      const addSectionHeading = (heading: string) => {
        checkPageSpace(18);

        y += 5;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(25, 45, 75);

        doc.text(heading, margin, y);

        y += 9;
      };

      // DOCUMENT HEADER

      doc.setFillColor(25, 45, 75);
      doc.rect(0, 0, pageWidth, 43, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(23);
      doc.setTextColor(255, 255, 255);

      doc.text("TENT STUDIO", margin, 19);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);

      doc.text("Custom Canopy Tent Quotation", margin, 28);

      doc.setFontSize(9);

      doc.text(
        `Date: ${new Date().toLocaleDateString("en-IN")}`,
        rightEdge,
        19,
        { align: "right" }
      );

      y = 55;

      // CURRENT 3D PREVIEW IMAGE (forced front perspective for a useful quote)
      const previewCanvas = document.querySelector<HTMLCanvasElement>(
        ".preview-container canvas"
      );
      if (previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0) {
        try {
          const previewImage = previewCanvas.toDataURL("image/png");
          addSectionHeading("3D Product Preview");
          const imageWidth = pageWidth - margin * 2;
          const imageHeight = Math.min(
            75,
            imageWidth * (previewCanvas.height / previewCanvas.width)
          );
          checkPageSpace(imageHeight + 8);
          doc.addImage(previewImage, "PNG", margin, y, imageWidth, imageHeight);
          y += imageHeight + 8;
        } catch (previewError) {
          console.warn("3D preview could not be added to quotation:", previewError);
          addSectionHeading("3D Product Preview");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(130, 130, 130);
          doc.text("Preview image is not available. Please try again.", margin, y);
          y += 8;
        }
      }

      // CONFIGURATION

      addSectionHeading("Product Configuration");

      const configurationDetails: [string, string][] = [
        ["Tent Size", selectedModel.name],

        [
          "Product Type",
          setup.product === "canopy-frame"
            ? "Canopy with Frame"
            : "Canopy Only",
        ],

        [
          "Frame Type",
          setup.product === "canopy-frame"
            ? setup.frameType === "standard"
              ? "Standard Frame"
              : "Light-Up Frame"
            : "Not Included",
        ],

        [
          "Side Walls",
          setup.sideWalls === "none"
            ? "None"
            : setup.sideWalls,
        ],

        [
          "Wall Printing",
          setup.sideWalls === "none"
            ? "Not Applicable"
            : setup.wallPrinting === "single"
              ? "Single-Sided"
              : "Double-Sided",
        ],

        [
          "Half Walls",
          setup.halfWalls === "none"
            ? "None"
            : setup.halfWalls === "single"
              ? "Single-Sided"
              : "Double-Sided",
        ],
      ];

      doc.setFontSize(10);

      configurationDetails.forEach(([label, value]) => {
        checkPageSpace(10);

        doc.setFont("helvetica", "bold");
        doc.setTextColor(60, 60, 60);
        doc.text(`${label}:`, margin, y);

        doc.setFont("helvetica", "normal");
        doc.text(value, margin + 48, y);

        y += 8;
      });

      // COLORS

      addSectionHeading("Color Configuration");

      const colorDetails: [string, string][] = [
        ["Outer Fabric", fabricColor],
        ["Inner Fabric", innerFabricColor],
        ["Metal Frame", frameColor],
      ];

      colorDetails.forEach(([label, color]) => {
        checkPageSpace(10);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);

        doc.text(`${label}: ${color.toUpperCase()}`, margin, y);

        const hex = color.replace("#", "");

        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        doc.setFillColor(r, g, b);
        doc.rect(margin + 75, y - 4, 12, 5, "F");

        doc.setDrawColor(180, 180, 180);
        doc.rect(margin + 75, y - 4, 12, 5);

        y += 8;
      });

      // PANEL BRANDING: one combined artwork preview per panel.
      // design.image already contains the composed text + logo from the editor,
      // so do not add design.logo separately (that caused duplicate logos).
      addSectionHeading("Panel Branding");

      panels.forEach((panel) => {
        const design = panelDesigns[panel.id];
        const cardHeight = 34;
        checkPageSpace(cardHeight + 5);

        const cardTop = y - 4;
        doc.setFillColor(249, 250, 252);
        doc.setDrawColor(225, 229, 235);
        doc.roundedRect(
          margin,
          cardTop,
          pageWidth - margin * 2,
          cardHeight,
          2,
          2,
          "FD"
        );

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(45, 55, 70);
        doc.text(panel.name, margin + 4, cardTop + 7);

        if (design.image) {
          try {
            const imageFormat = design.image.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
            const imageInfo = doc.getImageProperties(design.image);
            const maxWidth = 76;
            const maxHeight = 25;
            const scale = Math.min(
              maxWidth / imageInfo.width,
              maxHeight / imageInfo.height
            );
            const imageWidth = imageInfo.width * scale;
            const imageHeight = imageInfo.height * scale;
            const imageX = rightEdge - imageWidth - 5;
            const imageY = cardTop + (cardHeight - imageHeight) / 2;
            doc.addImage(
              design.image,
              imageFormat,
              imageX,
              imageY,
              imageWidth,
              imageHeight
            );
          } catch (imageError) {
            console.warn(`Could not add ${panel.name} artwork to quotation:`, imageError);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(130, 130, 130);
            doc.text("Artwork preview unavailable", margin + 4, cardTop + 16);
          }
        } else {
          // Fallback for text/logo-only designs when no composed panel image exists.
          const fallbackText = design.companyText.trim() || "No branding added";
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(90, 90, 90);
          doc.text(fallbackText, margin + 4, cardTop + 17);

          if (design.logo) {
            try {
              const logoFormat = design.logo.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
              const logoInfo = doc.getImageProperties(design.logo);
              const maxWidth = 32;
              const maxHeight = 25;
              const scale = Math.min(maxWidth / logoInfo.width, maxHeight / logoInfo.height);
              const logoWidth = logoInfo.width * scale;
              const logoHeight = logoInfo.height * scale;
              doc.addImage(
                design.logo,
                logoFormat,
                rightEdge - logoWidth - 5,
                cardTop + (cardHeight - logoHeight) / 2,
                logoWidth,
                logoHeight
              );
            } catch (logoError) {
              console.warn(`Could not add ${panel.name} logo to quotation:`, logoError);
            }
          }
        }

        y = cardTop + cardHeight + 5;
      });

      // PRICE BREAKDOWN

      addSectionHeading("Price Breakdown");

      const priceItems: [string, number][] = [
        [selectedModel.name, basePrice],
        [
          setup.product === "canopy-frame"
            ? setup.frameType === "light-up"
              ? "Light-Up Frame"
              : "Standard Frame"
            : "Frame Not Included",
          framePrice,
        ],
        ["Side Walls", sideWallPrice],
        ["Double-Sided Printing", printingPrice],
        ["Half Walls", halfWallPrice],
      ];

      priceItems.forEach(([label, price]) => {
        checkPageSpace(12);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);

        doc.text(label, margin, y);

        doc.text(
          `INR ${price.toLocaleString("en-IN")}`,
          rightEdge,
          y,
          { align: "right" }
        );

        y += 9;

        doc.setDrawColor(225, 225, 225);
        doc.line(margin, y - 4, rightEdge, y - 4);
      });

      // TOTAL

      checkPageSpace(25);

      y += 5;

      doc.setFillColor(240, 245, 252);
      doc.roundedRect(
        margin,
        y - 7,
        pageWidth - margin * 2,
        19,
        2,
        2,
        "F"
      );

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(25, 45, 75);

      doc.text("Total Estimated Price", margin + 4, y + 5);

      doc.text(
        `INR ${totalPrice.toLocaleString("en-IN")}`,
        rightEdge - 4,
        y + 5,
        { align: "right" }
      );

      y += 25;

      // FOOTER

      checkPageSpace(15);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);

      doc.text(
        "This quotation uses demo pricing and is not a final commercial offer.",
        margin,
        y
      );

      // SAVE PDF
      doc.save("Tent-Studio-Quotation.pdf");
    } catch (error) {
      console.error("PDF generation failed:", error);
      alert("Unable to generate PDF. Please try again.");
    } finally {
      // Return the live configurator to the panel the user was editing.
      if (previousPanel !== "front") {
        setSelectedPanel(previousPanel);
      }
    }
  };

  // ==========================================
  // UI
  // ==========================================

  return (
    <main className="app">

      {/* HEADER */}

      <header className="app-header">
        <div>
          <h1>TENT STUDIO</h1>
          <p>Custom Canopy Configurator</p>
        </div>

        <div className="header-actions">
          <span className="step-label">
            PRODUCT CUSTOMIZATION
          </span>

          <button
            type="button"
            className="cart-open-button"
            onClick={() => setCartOpen(true)}
          >
            🛒 Cart ({cartCount})
          </button>
        </div>
      </header>

      {checkoutOpen ? (
        <section className="checkout-page">
          {orderConfirmation ? (
            <div className="checkout-success">
              <div className="checkout-success-icon">✓</div>
              <h2>Order Placed Successfully!</h2>
              <p>Thank you, {orderConfirmation.customerName}.</p>
              <div className="checkout-order-id">
                Order ID: <strong>{orderConfirmation.orderId}</strong>
              </div>
              <p className="checkout-demo-note">
                This is a demo order. No payment has been collected.
              </p>
              <button
                type="button"
                className="checkout-primary-button"
                onClick={() => {
                  setOrderConfirmation(null);
                  setCheckoutOpen(false);
                }}
              >
                Back to Tent Configurator
              </button>
            </div>
          ) : (
            <div className="checkout-layout">
              <div className="checkout-form-card">
                <button
                  type="button"
                  className="checkout-back-button"
                  onClick={() => setCheckoutOpen(false)}
                >
                  ← Back to configurator
                </button>
                <span className="setup-step">FINAL STEP</span>
                <h2>Checkout</h2>
                <p className="checkout-intro">
                  Enter your contact and delivery details to continue to Shopify checkout.
                </p>

                <form className="checkout-form" onSubmit={handlePlaceOrder}>
                  <label htmlFor="customerName">Full Name</label>
                  <input
                    id="customerName"
                    name="customerName"
                    type="text"
                    placeholder="Enter your full name"
                    autoComplete="name"
                    required
                  />

                  <label htmlFor="customerEmail">Email Address</label>
                  <input
                    id="customerEmail"
                    name="customerEmail"
                    type="email"
                    placeholder="Enter your email"
                    autoComplete="email"
                    required
                  />

                  <label htmlFor="customerPhone">Phone Number</label>
                  <input
                    id="customerPhone"
                    name="customerPhone"
                    type="tel"
                    placeholder="+919876543210"
                    autoComplete="tel"
                    pattern="[0-9+() -]{10,20}"
                    title="Enter a valid phone number"
                    required
                  />

                  <label htmlFor="deliveryAddress">Delivery Address</label>
                  <textarea
                    id="deliveryAddress"
                    name="deliveryAddress"
                    placeholder="House/office, street, city, state, PIN code"
                    autoComplete="street-address"
                    rows={4}
                    required
                  />

                  <button type="submit" className="checkout-primary-button" disabled={checkoutSubmitting}>
                    {checkoutSubmitting ? "Creating Shopify checkout…" : "Continue to Shopify Checkout"} · {formatPrice(cartItems.reduce(
                      (sum, item) => sum + item.unitPrice * item.quantity,
                      0
                    ))}
                  </button>
                  <p className="checkout-demo-note">
                    You will be redirected to Shopify to complete checkout.
                  </p>
                </form>
              </div>

              <aside className="checkout-summary-card">
                <h3>Order Summary</h3>
                {cartItems.map((item) => (
                  <div className="checkout-summary-item" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>Qty: {item.quantity}</span>
                      <small>{item.configuration.join(" · ")}</small>
                    </div>
                    <strong>{formatPrice(item.unitPrice * item.quantity)}</strong>
                  </div>
                ))}
                <div className="checkout-summary-total">
                  <span>Subtotal</span>
                  <strong>{formatPrice(cartItems.reduce(
                    (sum, item) => sum + item.unitPrice * item.quantity,
                    0
                  ))}</strong>
                </div>
                <p>Taxes and shipping are not included.</p>
              </aside>
            </div>
          )}
        </section>
      ) : (
        <>
      {/* MVP-inspired product detail layout. Existing configurator state and handlers stay intact. */}
      <div className="product-page-grid">
        <div className="product-visual-column">
      <section className="configurator">

        {/* LIVE 3D PRODUCT VIEW */}

        <div className="preview-section">

          <div className="preview-heading">
            <div>
              <span className="eyebrow">LIVE PRODUCT PREVIEW</span>
              <h2>{selectedModel.name}</h2>
            </div>
            <span className="preview-live-pill"><i /> 3D Interactive</span>
          </div>

          <div className="preview-container">
            <TentViewer
              key={selectedModel.path}
              modelPath={selectedModel.path}
              fabricColor={fabricColor}
              innerFabricColor={innerFabricColor}
              frameColor={frameColor}
              designImages={panelDesigns}
              selectedPanel={selectedPanel}
            />
          </div>

          <div className="panel-selector">
            <div className="panel-selector-top">
              <h3>Choose branding panel</h3>
              <p>Pick a tent panel to edit its design</p>
            </div>
            <div className="panel-buttons">
              {panels.map((panel) => (
                <button
                  type="button"
                  key={panel.id}
                  className={selectedPanel === panel.id ? "panel-button active" : "panel-button"}
                  onClick={() => setSelectedPanel(panel.id)}
                >
                  <span>{panel.icon}</span>{panel.name}
                </button>
              ))}
            </div>
            <p className="selected-panel-label">Editing: <strong>{selectedPanelName}</strong></p>
          </div>
        </div>

        {/* COLOR CUSTOMIZATION BELOW THE PREVIEW */}
        <aside className="sidebar">
          {/* COLOR CUSTOMIZATION */}

          <div className="customization-controls">

            <h2>Customize Tent</h2>

            <div className="color-control">
              <label htmlFor="fabricColor">
                Outer Fabric Color
              </label>

              <input
                id="fabricColor"
                type="color"
                value={fabricColor}
                onChange={(event) =>
                  setFabricColor(event.target.value)
                }
              />

              <span>{fabricColor.toUpperCase()}</span>
            </div>

            <div className="color-control">
              <label htmlFor="innerFabricColor">
                Inner Fabric Color
              </label>

              <input
                id="innerFabricColor"
                type="color"
                value={innerFabricColor}
                onChange={(event) =>
                  setInnerFabricColor(event.target.value)
                }
              />

              <span>{innerFabricColor.toUpperCase()}</span>
            </div>

            <div className="color-control">
              <label htmlFor="frameColor">
                Metal Frame Color
              </label>

              <input
                id="frameColor"
                type="color"
                value={frameColor}
                onChange={(event) =>
                  setFrameColor(event.target.value)
                }
              />

              <span>{frameColor.toUpperCase()}</span>
            </div>

            <button
              type="button"
              className="reset-button"
              onClick={handleResetColors}
            >
              Reset Colors
            </button>

          </div>

          {/* 3D INSTRUCTIONS */}

          <div className="instructions">
            <h3>3D Controls</h3>
            <p>Left click + drag: Rotate</p>
            <p>Scroll: Zoom</p>
            <p>Right click + drag: Move</p>
          </div>

        </aside>


      </section>
        </div>

        <section className="setup-section product-options-card">
          <div className="product-title-block">
            <div className="product-breadcrumb">TENT STUDIO <span>/</span> CUSTOM CANOPY</div>
            <h1>Custom Canopy Tent</h1>
            <div className="product-rating-line"><span>★★★★★</span> <small>Build your event-ready tent</small></div>
            <div className="product-price-line"><strong>{pricingLoading ? "Calculating…" : pricingError ? "Price unavailable" : formatPrice(totalPrice)}</strong><span>Estimated total</span></div>
            <ul className="product-benefits">
              <li><b>✓</b> Custom sizes and configurations</li>
              <li><b>✓</b> Live 3D preview while you customize</li>
              <li><b>✓</b> Branding and artwork on multiple panels</li>
              <li><b>✓</b> PDF quotation available</li>
            </ul>
          </div>

          <div className="product-option-divider" />
          <div className="setup-header product-config-heading">
            <span className="setup-step">01 / CONFIGURE</span>
            <h2>Build Your Canopy</h2>
            <p>Choose the options for your custom tent.</p>
          </div>

          <div className="setup-group">
            <h3>Size <span>Required</span></h3>
            <div className="setup-options size-options">
              {tentModels.map((tent) => (
                <button type="button" key={tent.path}
                  className={`setup-option size-option ${selectedModel.path === tent.path ? "active" : ""}`}
                  aria-pressed={selectedModel.path === tent.path}
                  onClick={() => setSelectedModel(tent)}>
                  <strong>{tent.name.replace(" Tent", "")}</strong>
                  <span>Canopy size</span>
                </button>
              ))}
            </div>
          </div>

          {/* PRODUCT TYPE */}
          <div className="setup-group">
            <h3>Canopy Type <span>Required</span></h3>
            <div className="setup-options">
              <button type="button" className={`setup-option ${setup.product === "canopy-frame" ? "active" : ""}`} aria-pressed={setup.product === "canopy-frame"} onClick={() => updateSetup("product", "canopy-frame")}>
                <strong>Canopy with Frame</strong><span>Fabric canopy with metal structure</span>
              </button>
              <button type="button" className={`setup-option ${setup.product === "canopy-only" ? "active" : ""}`} aria-pressed={setup.product === "canopy-only"} onClick={() => updateSetup("product", "canopy-only")}>
                <strong>Canopy Only</strong><span>Fabric canopy without frame</span>
              </button>
            </div>
          </div>

          {setup.product === "canopy-frame" && <div className="setup-group">
            <h3>Frame Type</h3>
            <div className="setup-options">
              <button type="button" className={`setup-option ${setup.frameType === "standard" ? "active" : ""}`} aria-pressed={setup.frameType === "standard"} onClick={() => updateSetup("frameType", "standard")}><strong>Standard Frame</strong><span>Regular metal frame</span></button>
              <button type="button" className={`setup-option ${setup.frameType === "light-up" ? "active" : ""}`} aria-pressed={setup.frameType === "light-up"} onClick={() => updateSetup("frameType", "light-up")}><strong>Light-Up Frame</strong><span>Integrated lighting option</span></button>
            </div>
          </div>}

          <div className="setup-group">
            <h3>Side Walls</h3>
            <div className="setup-options">
              {(["none", "1", "3"] as const).map((value) => <button type="button" key={value} className={`setup-option ${setup.sideWalls === value ? "active" : ""}`} aria-pressed={setup.sideWalls === value} onClick={() => updateSetup("sideWalls", value)}><strong>{value === "none" ? "None" : `${value} Side Wall${value === "1" ? "" : "s"}`}</strong><span>{value === "none" ? "Open canopy" : value === "1" ? "One wall panel" : "Three wall panels"}</span></button>)}
            </div>
          </div>

          {setup.sideWalls !== "none" && <div className="setup-group">
            <h3>Side Wall Printing</h3>
            <div className="setup-options">
              <button type="button" className={`setup-option ${setup.wallPrinting === "single" ? "active" : ""}`} aria-pressed={setup.wallPrinting === "single"} onClick={() => updateSetup("wallPrinting", "single")}><strong>Single-Sided</strong><span>Print on one side</span></button>
              <button type="button" className={`setup-option ${setup.wallPrinting === "double" ? "active" : ""}`} aria-pressed={setup.wallPrinting === "double"} onClick={() => updateSetup("wallPrinting", "double")}><strong>Double-Sided</strong><span>Print on both sides</span></button>
            </div>
          </div>}

          <div className="setup-group">
            <h3>Half Walls (Set of 2)</h3>
            <div className="setup-options">
              <button type="button" className={`setup-option ${setup.halfWalls === "none" ? "active" : ""}`} aria-pressed={setup.halfWalls === "none"} onClick={() => updateSetup("halfWalls", "none")}><strong>None</strong><span>No half walls</span></button>
              <button type="button" className={`setup-option ${setup.halfWalls === "single" ? "active" : ""}`} aria-pressed={setup.halfWalls === "single"} onClick={() => updateSetup("halfWalls", "single")}><strong>Single-Sided</strong><span>Single-sided printing</span></button>
              <button type="button" className={`setup-option ${setup.halfWalls === "double" ? "active" : ""}`} aria-pressed={setup.halfWalls === "double"} onClick={() => updateSetup("halfWalls", "double")}><strong>Double-Sided</strong><span>Double-sided printing</span></button>
            </div>
          </div>

          <div className="setup-summary"><h3>Your Configuration</h3><p>{setupSummary.join("  •  ")}</p></div>
          <div className="pricing-section product-pricing-section">
            <div className="product-price-total"><span>Estimated total</span><strong>{pricingLoading ? "Calculating…" : pricingError ? "Unavailable" : formatPrice(totalPrice * productQuantity)}</strong></div>
            <p className="price-note">{pricingError ?? (pricingLoading ? "Fetching the latest configuration price…" : `${formatPrice(totalPrice)} per tent. Final pricing may vary based on artwork and order details.`)}</p>
            <div className="product-purchase-row">
              <div className="product-quantity" aria-label="Product quantity">
                <button type="button" aria-label="Decrease quantity" onClick={() => setProductQuantity((q) => Math.max(1, q - 1))}>−</button>
                <span>{productQuantity}</span>
                <button type="button" aria-label="Increase quantity" onClick={() => setProductQuantity((q) => q + 1)}>+</button>
              </div>
              <button type="button" className="add-to-cart-button" onClick={handleAddToCart} disabled={pricingLoading || Boolean(pricingError) || !pricingResult}>Add to Cart · {pricingLoading ? "Calculating…" : formatPrice(totalPrice * productQuantity)}</button>
            </div>
            <button type="button" className="download-quotation-button" onClick={downloadQuotation} disabled={pricingLoading || Boolean(pricingError) || !pricingResult}>Download PDF Quotation</button>
            <button
              type="button"
              className="download-quotation-button"
              onClick={handleDownloadConfiguration}
              disabled={pricingLoading || Boolean(pricingError) || !pricingResult}
            >
              Download Configuration JSON
            </button>
            <div className="secure-note">Custom-built for your brand <span>•</span> No setup fee for artwork preview</div>
          </div>
        </section>
      </div>

      {/* =====================================
          STEP 3: BRANDING EDITOR
      ====================================== */}

      <section className="design-editor-wrapper">

        <TentDesignEditor
          key={selectedPanel}
          design={panelDesigns[selectedPanel]}
          onDesignChange={handleDesignChange}
        />

      </section>

      {/* CART DRAWER */}

      <CartDrawer
        open={cartOpen}
        items={cartItems}
        onClose={() => setCartOpen(false)}
        onQuantityChange={handleQuantityChange}
        onRemove={handleRemoveFromCart}
        onCheckout={handleStartCheckout}
      />
        </>
      )}

    </main>
  );
}

export default App;
