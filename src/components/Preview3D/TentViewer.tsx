
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
} from "react";

import {
  Canvas,
  useFrame,
  useThree,
} from "@react-three/fiber";

import {
  OrbitControls,
  Environment,
  useGLTF,
} from "@react-three/drei";

import {
  Box3,
  Sphere,
  Vector3,
  Mesh,
  MeshStandardMaterial,
  CanvasTexture,
  PerspectiveCamera,
  SRGBColorSpace,
  Group,
  Texture,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
} from "three";

import type { TentDesign } from "../Editor2D/TentDesignEditor";

type PanelId = "front" | "back" | "left" | "right" | "roof";

type PanelDesigns = Record<PanelId, TentDesign>;

interface TentModelProps {
  modelPath: string;
  fabricColor: string;
  innerFabricColor: string;
  frameColor: string;
  designImages: PanelDesigns;
}

interface CameraControllerProps {
  modelPath: string;
  selectedPanel: PanelId;
}

interface UVIsland {
  faces: number[];
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  center: Vector3;
}

const PANEL_IDS: PanelId[] = [
  "front",
  "back",
  "left",
  "right",
  "roof",
];

function getIslandPanel(
  island: UVIsland,
  minY: number,
  maxY: number
): PanelId {
  const height = Math.max(maxY - minY, 0.001);

  // The outer-fabric mesh contains the sloping roof and the
  // vertical valance. Their centers are separated near 25% of
  // this mesh's own height. Do not use the whole tent bounds:
  // the legs make that threshold incorrect.
  const roofThreshold = minY + height * 0.25;

  if (island.center.y >= roofThreshold) {
    return "roof";
  }

  const x = island.center.x;
  const z = island.center.z;

  if (Math.abs(z) >= Math.abs(x)) {
    return z >= 0 ? "front" : "back";
  }

  return x >= 0 ? "right" : "left";
}

/**
 * Find connected UV islands.
 */
function findUVIslands(mesh: Mesh): UVIsland[] {
  const geometry = mesh.geometry;

  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const index = geometry.index;

  if (!position || !uv) return [];

  const faceCount = index
    ? index.count / 3
    : position.count / 3;

  const getVertexIndex = (
    face: number,
    corner: number
  ) => {
    const offset = face * 3 + corner;
    return index ? index.getX(offset) : offset;
  };

  const getUVKey = (vertexIndex: number) =>
    `${uv.getX(vertexIndex).toFixed(6)},${uv
      .getY(vertexIndex)
      .toFixed(6)}`;

  const edgeFaces = new Map<string, number[]>();

  for (let face = 0; face < faceCount; face++) {
    const ids = [
      getVertexIndex(face, 0),
      getVertexIndex(face, 1),
      getVertexIndex(face, 2),
    ];

    const keys = ids.map(getUVKey);

    const edges = [
      [keys[0], keys[1]],
      [keys[1], keys[2]],
      [keys[2], keys[0]],
    ];

    edges.forEach(([a, b]) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;

      if (!edgeFaces.has(key)) {
        edgeFaces.set(key, []);
      }

      edgeFaces.get(key)!.push(face);
    });
  }

  const adjacency: Set<number>[] = Array.from(
    { length: faceCount },
    () => new Set<number>()
  );

  edgeFaces.forEach((faces) => {
    if (faces.length < 2) return;

    faces.forEach((face) => {
      faces.forEach((other) => {
        if (face !== other) {
          adjacency[face].add(other);
        }
      });
    });
  });

  const visited = new Set<number>();
  const islands: UVIsland[] = [];

  for (let start = 0; start < faceCount; start++) {
    if (visited.has(start)) continue;

    const stack = [start];
    const faces: number[] = [];

    visited.add(start);

    while (stack.length > 0) {
      const face = stack.pop()!;
      faces.push(face);

      adjacency[face].forEach((next) => {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      });
    }

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;

    const center = new Vector3();
    let vertexCount = 0;

    faces.forEach((face) => {
      for (let corner = 0; corner < 3; corner++) {
        const vertexIndex = getVertexIndex(face, corner);

        const u = uv.getX(vertexIndex);
        const v = uv.getY(vertexIndex);

        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);

        center.x += position.getX(vertexIndex);
        center.y += position.getY(vertexIndex);
        center.z += position.getZ(vertexIndex);

        vertexCount++;
      }
    });

    if (vertexCount > 0) {
      center.divideScalar(vertexCount);

      // UV island positions must be classified in world space.
      // GLB meshes can have their own rotations/transforms.
      mesh.updateWorldMatrix(true, false);
      center.applyMatrix4(mesh.matrixWorld);
    }

    islands.push({
      faces,
      minU,
      maxU,
      minV,
      maxV,
      center,
    });
  }

  return islands;
}

function loadImage(
  source: string | null
): Promise<HTMLImageElement | null> {
  if (!source) return Promise.resolve(null);

  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);

    image.src = source;
  });
}

/**
 * Draw design only inside the real UV triangles.
 * This prevents artwork from leaking into overlapping UV rectangles.
 */
function createFabricAtlas(
  mesh: Mesh,
  fabricColor: string,
  designs: Record<PanelId, HTMLImageElement | null>
): CanvasTexture {
  const canvas = document.createElement("canvas");

  // High-resolution atlas for sharper logos and lettering.
  canvas.width = 4096;
  canvas.height = 4096;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create fabric texture.");
  }

  context.fillStyle = fabricColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const index = geometry.index;

  if (!position || !uv) {
    return new CanvasTexture(canvas);
  }

  const islands = findUVIslands(mesh);

  // Classify islands against the outer-fabric mesh bounds only.
  // Whole-model bounds include the legs and frame and misclassify
  // the roof as side panels.
  mesh.updateWorldMatrix(true, false);
  const fabricBounds = new Box3().setFromObject(mesh);
  const fabricMinY = fabricBounds.min.y;
  const fabricMaxY = fabricBounds.max.y;

  const getVertexIndex = (
    face: number,
    corner: number
  ) => {
    const offset = face * 3 + corner;
    return index ? index.getX(offset) : offset;
  };

  islands.forEach((island) => {
    const panel = getIslandPanel(island, fabricMinY, fabricMaxY);
    const image = designs[panel];

    if (!image) return;

    const x = island.minU * canvas.width;
    const y = (1 - island.maxV) * canvas.height;

    const width =
      (island.maxU - island.minU) * canvas.width;

    const height =
      (island.maxV - island.minV) * canvas.height;

    if (width <= 0 || height <= 0) return;

    context.save();

    // Build an exact clipping path from this island's triangles.
    context.beginPath();

    island.faces.forEach((face) => {
      const a = getVertexIndex(face, 0);
      const b = getVertexIndex(face, 1);
      const c = getVertexIndex(face, 2);

      const ax = uv.getX(a) * canvas.width;
      const ay = (1 - uv.getY(a)) * canvas.height;

      const bx = uv.getX(b) * canvas.width;
      const by = (1 - uv.getY(b)) * canvas.height;

      const cx = uv.getX(c) * canvas.width;
      const cy = (1 - uv.getY(c)) * canvas.height;

      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.lineTo(cx, cy);
      context.closePath();
    });

    context.clip();

    // Keep the original artwork proportions. Stretching a logo to fit
    // every UV island makes circles oval and text visibly distorted.
    const imageAspect = image.width / Math.max(image.height, 1);
    const islandAspect = width / height;

    let drawWidth = width;
    let drawHeight = height;

    if (imageAspect > islandAspect) {
      drawHeight = width / imageAspect;
    } else {
      drawWidth = height * imageAspect;
    }

    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

    context.restore();
  });

  const texture = new CanvasTexture(canvas);

  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 16;
  texture.needsUpdate = true;

  return texture;
}

function CameraController({
  modelPath,
  selectedPanel,
}: CameraControllerProps) {
  const { camera, size } = useThree();
  const { scene } = useGLTF(modelPath);

  const controlsRef = useRef<any>(null);
  const isCameraAnimating = useRef(false);

  const targetPosition = useRef(
    new Vector3(4, 3, 5)
  );

  const targetLookAt = useRef(
    new Vector3(0, 0, 0)
  );

  const fitDistance = useMemo(() => {
    const box = new Box3().setFromObject(scene);
    const sphere = box.getBoundingSphere(new Sphere());

    const radius = Math.max(sphere.radius, 0.5);

    const perspectiveCamera =
      camera as PerspectiveCamera;

    const verticalFov =
      (perspectiveCamera.fov * Math.PI) / 180;

    const aspect = Math.max(
      size.width / Math.max(size.height, 1),
      0.1
    );

    const horizontalFov =
      2 *
      Math.atan(
        Math.tan(verticalFov / 2) * aspect
      );

    const verticalDistance =
      radius / Math.sin(verticalFov / 2);

    const horizontalDistance =
      radius / Math.sin(horizontalFov / 2);

    return (
      Math.max(verticalDistance, horizontalDistance) * 0.90
    );
  }, [scene, camera, size.width, size.height]);

  useEffect(() => {
    const directions: Record<PanelId, Vector3> = {
      front: new Vector3(0, 0.16, 1),
      back: new Vector3(0, 0.16, -1),
      left: new Vector3(-1, 0.16, 0),
      right: new Vector3(1, 0.16, 0),
      roof: new Vector3(0, 1, 0.001),
    };

    targetPosition.current
      .copy(directions[selectedPanel].clone().normalize())
      .multiplyScalar(fitDistance);

    targetLookAt.current.set(0, 0, 0);
    isCameraAnimating.current = true;

    camera.up.set(
      0,
      selectedPanel === "roof" ? 0 : 1,
      selectedPanel === "roof" ? -1 : 0
    );

    camera.updateProjectionMatrix();
  }, [selectedPanel, fitDistance, camera]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;

    if (!controls) return;

    // Animate only when a panel is selected. After the transition,
    // OrbitControls owns the camera so manual 360-degree rotation works.
    if (isCameraAnimating.current) {
      const smoothness = 1 - Math.exp(-5 * delta);

      camera.position.lerp(
        targetPosition.current,
        smoothness
      );

      controls.target.lerp(
        targetLookAt.current,
        smoothness
      );

      if (camera.position.distanceTo(targetPosition.current) < 0.01) {
        camera.position.copy(targetPosition.current);
        controls.target.copy(targetLookAt.current);
        isCameraAnimating.current = false;
      }
    }

    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan
      enableZoom
      enableRotate
      enableDamping
      dampingFactor={0.08}
      minDistance={1}
      maxDistance={fitDistance * 2.5}
      target={[0, 0, 0]}
    />
  );
}

function TentModel({
  modelPath,
  fabricColor,
  innerFabricColor,
  frameColor,
  designImages,
}: TentModelProps) {
  const { scene } = useGLTF(modelPath);

  const model = useMemo(() => {
    const root = new Group();
    const cloned = scene.clone(true);

    cloned.traverse((child) => {
      if (!(child instanceof Mesh)) return;

      if (Array.isArray(child.material)) {
        child.material = child.material.map(
          (material) => material.clone()
        );
      } else {
        child.material = child.material.clone();
      }

      child.castShadow = true;
      child.receiveShadow = true;
    });

    const box = new Box3().setFromObject(cloned);
    const center = box.getCenter(new Vector3());

    cloned.position.sub(center);

    root.add(cloned);

    return root;
  }, [scene]);

  useEffect(() => {
    let cancelled = false;

    const textures: CanvasTexture[] = [];

    const originalMaterials: {
      material: MeshStandardMaterial;
      map: Texture | null;
      color: Color;
    }[] = [];

    const applyTextures = async () => {
      const loaded = await Promise.all(
        PANEL_IDS.map((panel) =>
          loadImage(designImages[panel]?.image ?? null)
        )
      );

      if (cancelled) return;

      const images: Record<
        PanelId,
        HTMLImageElement | null
      > = {
        front: loaded[0],
        back: loaded[1],
        left: loaded[2],
        right: loaded[3],
        roof: loaded[4],
      };

      model.updateWorldMatrix(true, true);

      model.traverse((child) => {
        if (!(child instanceof Mesh)) return;

        const materialList = Array.isArray(child.material)
          ? child.material
          : [child.material];

        materialList.forEach((material) => {
          if (!(material instanceof MeshStandardMaterial)) {
            return;
          }

          const name = material.name.toLowerCase();

          if (
            name === "fabric_mat" ||
            name === "inner_fabric" ||
            name === "metal_mat"
          ) {
            originalMaterials.push({
              material,
              map: material.map,
              color: material.color.clone(),
            });
          }

          if (name === "fabric_mat") {
            const texture = createFabricAtlas(
              child,
              fabricColor,
              images
            );

            textures.push(texture);

            material.map = texture;
            material.color.set("#ffffff");
            material.needsUpdate = true;
          }

          if (name === "inner_fabric") {
            material.color.set(innerFabricColor);
            material.needsUpdate = true;
          }

          if (name === "metal_mat") {
            material.color.set(frameColor);
            material.needsUpdate = true;
          }
        });
      });
    };

    applyTextures();

    return () => {
      cancelled = true;

      originalMaterials.forEach((entry) => {
        entry.material.map = entry.map;
        entry.material.color.copy(entry.color);
        entry.material.needsUpdate = true;
      });

      textures.forEach((texture) => texture.dispose());
    };
  }, [
    model,
    fabricColor,
    innerFabricColor,
    frameColor,
    designImages,
  ]);

  return <primitive object={model} />;
}

interface TentViewerProps {
  modelPath: string;
  fabricColor: string;
  innerFabricColor: string;
  frameColor: string;
  designImages: PanelDesigns;
  selectedPanel: PanelId;

  // Gives the parent component access to the rendered 3D canvas.
  // The parent can capture the current tent preview when adding to cart.
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

interface CanvasCaptureBridgeProps {
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

function CanvasCaptureBridge({
  onCanvasReady,
}: CanvasCaptureBridgeProps) {
  const { gl } = useThree();

  useEffect(() => {
    onCanvasReady?.(gl.domElement);

    return () => {
      onCanvasReady?.(null);
    };
  }, [gl, onCanvasReady]);

  return null;
}

export default function TentViewer({
  modelPath,
  fabricColor,
  innerFabricColor,
  frameColor,
  designImages,
  selectedPanel,
  onCanvasReady,
}: TentViewerProps) {
  return (
    <div className="tent-viewer">
      <Canvas
        camera={{
          position: [4, 3, 5],
          fov: 38,
          near: 0.1,
          far: 100,
        }}
        shadows
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true }}
      >
        <color
          attach="background"
          args={["#f5f5f5"]}
        />

        <ambientLight intensity={1.3} />

        <directionalLight
          position={[5, 8, 5]}
          intensity={2}
          castShadow
        />

        <directionalLight
          position={[-5, 4, -5]}
          intensity={0.9}
        />

        <CanvasCaptureBridge onCanvasReady={onCanvasReady} />

        <Suspense fallback={null}>
          <TentModel
            modelPath={modelPath}
            fabricColor={fabricColor}
            innerFabricColor={innerFabricColor}
            frameColor={frameColor}
            designImages={designImages}
          />

          <Environment preset="city" />

          <CameraController
            modelPath={modelPath}
            selectedPanel={selectedPanel}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
