import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent } from "react";
import "./TentDesignEditor.css";

export interface TentDesign {
  companyText: string;
  textColor: string;
  fontSize: number;
  logo: string | null;
  position: {
    x: number;
    y: number;
  };
  image: string | null;
}

interface TentDesignEditorProps {
  design: TentDesign;
  onDesignChange: (design: TentDesign) => void;
}

const CANVAS_WIDTH = 700;
const CANVAS_HEIGHT = 420;
const EXPORT_SCALE = 4;
const MAX_LOGO_FILE_SIZE = 5 * 1024 * 1024;

const DEFAULT_DESIGN: TentDesign = {
  companyText: "",
  textColor: "#222222",
  fontSize: 32,
  logo: null,
  position: { x: 350, y: 210 },
  image: null,
};

export default function TentDesignEditor({
  design,
  onDesignChange,
}: TentDesignEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [companyText, setCompanyText] = useState(
    design.companyText ?? DEFAULT_DESIGN.companyText
  );
  const [textColor, setTextColor] = useState(
    design.textColor ?? DEFAULT_DESIGN.textColor
  );
  const [fontSize, setFontSize] = useState(
    design.fontSize ?? DEFAULT_DESIGN.fontSize
  );
  const [logo, setLogo] = useState<string | null>(design.logo ?? null);
  const [position, setPosition] = useState(
    design.position ?? { ...DEFAULT_DESIGN.position }
  );
  const [dragging, setDragging] = useState(false);

  // App.tsx keys this editor by selected panel, so switching panels remounts
  // it with that panel's saved design without effect-driven state updates.

  // Draw a normal-size editor preview and export a 4x PNG for the 3D texture.
  useEffect(() => {
    const previewCanvas = canvasRef.current;
    if (!previewCanvas) return;

    const previewContext = previewCanvas.getContext("2d");
    if (!previewContext) return;

    let cancelled = false;

    const drawArtwork = (
      context: CanvasRenderingContext2D,
      scale: number,
      image?: HTMLImageElement
    ) => {
      context.clearRect(
        0,
        0,
        CANVAS_WIDTH * scale,
        CANVAS_HEIGHT * scale
      );
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      if (image) {
        const maxWidth = 140;
        const maxHeight = 110;
        const imageScale = Math.min(
          maxWidth / image.width,
          maxHeight / image.height,
          1
        );
        const width = image.width * imageScale;
        const height = image.height * imageScale;

        context.drawImage(
          image,
          (position.x - width / 2) * scale,
          (position.y - height / 2 - 35) * scale,
          width * scale,
          height * scale
        );
      }

      if (companyText.trim()) {
        context.fillStyle = textColor;
        context.font = `bold ${fontSize * scale}px Arial`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
          companyText,
          position.x * scale,
          (position.y + (image ? 45 : 0)) * scale,
          560 * scale
        );
      }
    };

    const render = (image?: HTMLImageElement) => {
      if (cancelled) return;

      drawArtwork(previewContext, 1, image);

      // Export the combined artwork only when the panel actually contains
      // text or a successfully loaded logo. An empty canvas must stay null,
      // otherwise jsPDF treats its transparent PNG as an existing design.
      const hasArtwork = Boolean(companyText.trim()) || Boolean(logo && image);
      let imageData: string | null = null;

      if (hasArtwork) {
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = CANVAS_WIDTH * EXPORT_SCALE;
        exportCanvas.height = CANVAS_HEIGHT * EXPORT_SCALE;

        const exportContext = exportCanvas.getContext("2d");
        if (exportContext) {
          drawArtwork(exportContext, EXPORT_SCALE, image);
          imageData = exportCanvas.toDataURL("image/png");
        }
      }

      onDesignChange({
        companyText,
        textColor,
        fontSize,
        logo,
        position: { ...position },
        image: imageData,
      });
    };

    if (logo) {
      const image = new Image();
      image.onload = () => render(image);
      image.onerror = () => render();
      image.src = logo;
    } else {
      render();
    }

    return () => {
      cancelled = true;
    };
  }, [companyText, textColor, fontSize, logo, position, onDesignChange]);

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_LOGO_FILE_SIZE) {
      alert("Image size must be below 5 MB.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogo(reader.result);
      }
    };
    reader.onerror = () =>
      alert("Could not read this image. Please try another file.");
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const getCanvasPosition = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPosition(event);
    const isInside =
      point.x >= position.x - 150 &&
      point.x <= position.x + 150 &&
      point.y >= position.y - 90 &&
      point.y <= position.y + 90;

    if (isInside) {
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    const point = getCanvasPosition(event);

    setPosition({
      x: Math.max(60, Math.min(640, point.x)),
      y: Math.max(60, Math.min(360, point.y)),
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleReset = () => {
    setCompanyText(DEFAULT_DESIGN.companyText);
    setTextColor(DEFAULT_DESIGN.textColor);
    setFontSize(DEFAULT_DESIGN.fontSize);
    setLogo(null);
    setPosition({ ...DEFAULT_DESIGN.position });
    setDragging(false);
  };

  return (
    <section className="design-editor">
      <div className="editor-header">
        <div>
          <h2>2D Design Editor</h2>
          <p>Customize your tent fabric and branding</p>
        </div>
        <span className="editor-status">LIVE DESIGN</span>
      </div>

      <div className="editor-layout">
        <div className="editor-controls">
          <div className="editor-field">
            <label htmlFor="companyText">Company Name</label>
            <input
              id="companyText"
              type="text"
              value={companyText}
              maxLength={40}
              onChange={(event) => setCompanyText(event.target.value)}
              placeholder="YOUR BRAND"
            />
          </div>

          <div className="editor-field">
            <label htmlFor="logoUpload">Upload Company Logo</label>
            <input
              id="logoUpload"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleLogoUpload}
            />
            {logo && (
              <button
                type="button"
                className="editor-secondary-button"
                onClick={() => setLogo(null)}
              >
                Remove Logo
              </button>
            )}
          </div>

          <div className="editor-field">
            <label htmlFor="textColor">Text Color</label>
            <input
              id="textColor"
              type="color"
              value={textColor}
              onChange={(event) => setTextColor(event.target.value)}
            />
          </div>

          <div className="editor-field">
            <label htmlFor="fontSize">Text Size: {fontSize}px</label>
            <input
              id="fontSize"
              type="range"
              min="14"
              max="60"
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </div>

          <button
            type="button"
            className="editor-secondary-button"
            onClick={handleReset}
          >
            Reset Design
          </button>
        </div>

        <div className="editor-canvas-section">
          <p className="canvas-instruction">
            Drag your logo or text to change its position.
          </p>
          <div className="design-canvas-wrapper">
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className="design-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
