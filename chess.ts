import { CrossSection, Manifold, Mesh } from "manifold-3d/manifoldCAD";
import DxfParser from "dxf-parser";
import { DXF_BASE64, STL_BASE64 } from "./assets";

type Vec2 = [number, number];

export const PIECE_IDS = [
  "pawn",
  "rook",
  "bishop",
  "knight",
  "queen",
  "king",
  "split_pawn",
  "split_bishop",
  "split_bishop2",
  "split_knight",
  "split_knight2",
  "split_queen",
  "split_king",
] as const;

export type PieceId = (typeof PIECE_IDS)[number];

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(base64, "base64"));
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64ToUtf8(base64: string): string {
  const bytes = base64ToBytes(base64);
  return new TextDecoder().decode(bytes);
}

function parseDxfToLoops(dxf: any): Vec2[][] {
  const loops: Vec2[][] = [];
  const entities = Array.isArray(dxf?.entities) ? dxf.entities : [];
  for (const entity of entities) {
    const t = entity?.type;
    if (t !== "LWPOLYLINE" && t !== "POLYLINE") continue;
    const vertices = Array.isArray(entity?.vertices) ? entity.vertices : [];
    if (vertices.length < 3) continue;
    const loop: Vec2[] = vertices.map((v: any) => [Number(v.x), Number(v.y)]);
    loops.push(loop);
  }
  if (loops.length === 0) throw new Error("DXF contained no usable POLYLINE/LWPOLYLINE entities.");
  return loops;
}

const dxfParser = new DxfParser();
const dxfLoopsCache = new Map<string, Vec2[][]>();

function loadDxfProfile(name: keyof typeof DXF_BASE64): CrossSection {
  const cached = dxfLoopsCache.get(name);
  const loops = cached ?? (() => {
    const text = base64ToUtf8(DXF_BASE64[name]);
    const dxf = dxfParser.parseSync(text) as any;
    const parsed = parseDxfToLoops(dxf);
    dxfLoopsCache.set(name, parsed);
    return parsed;
  })();
  return new CrossSection(loops);
}

function parseBinaryStlToMesh(data: Uint8Array): Mesh {
  if (data.byteLength < 84) throw new Error("STL too small.");

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const triCount = view.getUint32(80, true);
  const expectedBytes = 84 + triCount * 50;
  if (expectedBytes > data.byteLength) {
    throw new Error(`STL appears truncated (expected ${expectedBytes} bytes, got ${data.byteLength}).`);
  }

  const scratch = new DataView(new ArrayBuffer(4));
  const vertices: number[] = [];
  const triVerts: number[] = [];
  const vertIndex = new Map<string, number>();

  const bitsToFloat = (bits: number) => {
    scratch.setUint32(0, bits, true);
    return scratch.getFloat32(0, true);
  };

  const addVertexFromOffset = (offset: number): { index: number; next: number } => {
    const xb = view.getUint32(offset, true);
    const yb = view.getUint32(offset + 4, true);
    const zb = view.getUint32(offset + 8, true);
    const key = `${xb},${yb},${zb}`;
    const existing = vertIndex.get(key);
    if (existing !== undefined) return { index: existing, next: offset + 12 };

    const idx = vertices.length / 3;
    vertices.push(bitsToFloat(xb), bitsToFloat(yb), bitsToFloat(zb));
    vertIndex.set(key, idx);
    return { index: idx, next: offset + 12 };
  };

  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    offset += 12; // normal
    const v0 = addVertexFromOffset(offset);
    const v1 = addVertexFromOffset(v0.next);
    const v2 = addVertexFromOffset(v1.next);
    triVerts.push(v0.index, v1.index, v2.index);
    offset = v2.next + 2; // attribute byte count
  }

  return new Mesh({
    numProp: 3,
    vertProperties: new Float32Array(vertices),
    triVerts: new Uint32Array(triVerts),
  });
}

const stlMeshCache = new Map<string, Mesh>();

function loadStlMesh(name: keyof typeof STL_BASE64): Mesh {
  const cached = stlMeshCache.get(name);
  if (cached) return cached;
  const bytes = base64ToBytes(STL_BASE64[name]);
  const mesh = parseBinaryStlToMesh(bytes);
  stlMeshCache.set(name, mesh);
  return mesh;
}

function stlToManifold(name: keyof typeof STL_BASE64): Manifold {
  const mesh = loadStlMesh(name);
  return Manifold.ofMesh(mesh);
}

const SEGMENTS = 64;

function createPawnUnscaled(): Manifold {
  const profile = loadDxfProfile("pawn_profile.dxf");
  return Manifold.revolve(profile, SEGMENTS).translate([0, 0, 140]);
}

function createPawn(): Manifold {
  return createPawnUnscaled().scale(0.2);
}

function createRook(): Manifold {
  const profile = loadDxfProfile("rook_profile.dxf");
  const body = Manifold.revolve(profile, SEGMENTS);

  const trianglePts: Vec2[] = [
    [0, 0],
    [60, 30],
    [30, 60],
  ];
  const triangleCs = new CrossSection([trianglePts]);
  const cutterBase = Manifold.extrude(triangleCs, 20);

  const cut1 = cutterBase;
  const cut2 = cutterBase.rotate([0, 0, 90]);
  const cut3 = cutterBase.rotate([0, 0, 180]);
  const cut4 = cutterBase.rotate([0, 0, 270]);

  const allCutters = Manifold.union([cut1, cut2, cut3, cut4]).translate([0, 0, 20]);

  return Manifold.difference(body, allCutters).translate([0, 0, 160]).scale(0.2);
}

function createBishop(): Manifold {
  const profile = loadDxfProfile("bishop_profile.dxf");
  const body = Manifold.revolve(profile, SEGMENTS);
  const cube = Manifold.cube([10, 80, 80], true).rotate([0, -45, 0]).translate([-30, 0, 5]);
  return Manifold.difference(body, cube).translate([0, 0, 222]).scale(0.2);
}

function createKnight(): Manifold {
  const profile = loadDxfProfile("knight_profile.dxf");
  const base = Manifold.revolve(profile, SEGMENTS);
  const horse = stlToManifold("horse3.stl").scale(3.2).translate([-8, -12, 28]);
  return Manifold.union([base, horse]).translate([0, 0, 30]).scale(0.2);
}

function createQueen(): Manifold {
  const profile = loadDxfProfile("queen_profile.dxf");
  const base = Manifold.revolve(profile, SEGMENTS);
  const crown = stlToManifold("queen_crown2.stl").scale(7.0).translate([0, 0, 28]);
  return Manifold.union([base, crown]).translate([0, 0, 216]).scale(0.185);
}

function createKing(): Manifold {
  const profile = loadDxfProfile("king_profile.dxf");
  const base = Manifold.revolve(profile, SEGMENTS);
  const crossProfile = loadDxfProfile("cross_profile.dxf");
  const cross = Manifold.extrude(crossProfile, 10).rotate([90, 0, 0]).translate([-25, 5, 40]);
  return Manifold.union([base, cross]).translate([0, 0, 277]).scale(0.185);
}

function createSplitPawn(): Manifold {
  const piece = createPawnUnscaled().rotate([90, 180, 0]);
  const splitter = Manifold.cube([120, 60, 200], false).translate([-60, 0, -10]).rotate([90, 180, 0]);
  const holeBase = Manifold.cylinder(20, 5.0, 5.0, 6, true);
  const h1 = holeBase.translate([0, -20, 0]);
  const h2 = holeBase.translate([0, -135, 0]);
  return piece.subtract(splitter).subtract(h1).subtract(h2).scale(0.2);
}

function createSplitBishop(): Manifold {
  const profile = loadDxfProfile("bishop_profile.dxf");
  const body = Manifold.revolve(profile, SEGMENTS).translate([0, 0, 140]).rotate([90, 180, 0]);
  const miterCut = Manifold.cube([10, 80, 80], true).rotate([0, 0, 45]).translate([30, -140, 0]);
  const splitter = Manifold.cube([200, 100, 300], false).translate([-100, 0, -100]).rotate([90, 180, 0]);
  const holeBase = Manifold.cylinder(20, 5.0, 5.0, 6, true);
  const h1 = holeBase.translate([0, 35, 0]);
  const h2 = holeBase.translate([0, -95, 0]);
  return body.subtract(miterCut).subtract(splitter).subtract(h1).subtract(h2).scale(0.2);
}

function createSplitBishop2(): Manifold {
  const profile = loadDxfProfile("bishop_profile.dxf");
  const body = Manifold.revolve(profile, SEGMENTS).translate([0, 0, 140]).rotate([90, 180, 0]);
  const miterCut = Manifold.cube([10, 80, 80], true).rotate([0, 0, 45]).translate([30, -140, 0]);
  const splitter = Manifold.cube([200, 100, 300], false).translate([-100, 0, -100]).rotate([90, 0, 0]);
  const holeBase = Manifold.cylinder(20, 5.0, 5.0, 6, true);
  const h1 = holeBase.translate([0, 35, 0]);
  const h2 = holeBase.translate([0, -95, 0]);
  return body
    .subtract(miterCut)
    .subtract(splitter)
    .subtract(h1)
    .subtract(h2)
    .rotate([0, 180, 0])
    .scale(0.2);
}

function createSplitKnight(): Manifold {
  const profile = loadDxfProfile("knight_profile.dxf");
  const body = Manifold.revolve(profile, SEGMENTS).translate([0, 0, -80]).rotate([90, 180, 0]);
  const horse = stlToManifold("horse3.stl").scale(3.2).translate([-8, -12, -52.1]).rotate([90, 180, 0]);
  const piece = Manifold.union([body, horse]);
  const splitter = Manifold.cube([200, 100, 300], false).translate([-100, 0, -150]).rotate([90, 180, 0]);
  const holeBase = Manifold.cylinder(20, 5.0, 5.0, 6, true);
  const h1 = holeBase.translate([20, -70, 0]);
  const h2 = holeBase.translate([7, 20, 0]);
  const h3 = holeBase.translate([0, 75, 0]);
  return piece.subtract(splitter).subtract(h1).subtract(h2).subtract(h3).scale(0.2);
}

function createSplitKnight2(): Manifold {
  const profile = loadDxfProfile("knight_profile.dxf");
  const body = Manifold.revolve(profile, SEGMENTS).translate([0, 0, -80]).rotate([90, 180, 0]);
  const horse = stlToManifold("horse3.stl").scale(3.2).translate([-8, -12, -52.1]).rotate([90, 180, 0]);
  const piece = Manifold.union([body, horse]);
  const splitter = Manifold.cube([200, 100, 300], false).translate([-100, 0, -150]).rotate([90, 0, 0]);
  const holeBase = Manifold.cylinder(20, 5.0, 5.0, 6, true);
  const h1 = holeBase.translate([20, -70, 0]);
  const h2 = holeBase.translate([7, 20, 0]);
  const h3 = holeBase.translate([0, 75, 0]);
  return piece
    .subtract(splitter)
    .subtract(h1)
    .subtract(h2)
    .subtract(h3)
    .rotate([0, 180, 0])
    .scale(0.2);
}

function createSplitQueen(): Manifold {
  const profile = loadDxfProfile("queen_profile.dxf");
  const body = Manifold.revolve(profile, SEGMENTS).translate([0, 0, 140]).rotate([90, 180, 0]);
  const crown = stlToManifold("queen_crown2.stl").scale(7.0).translate([0, 0, 167]).rotate([90, 30, 0]);
  const piece = Manifold.union([body, crown]);
  const splitter = Manifold.cube([200, 100, 350], false).translate([-100, 0, -80]).rotate([90, 180, 0]);
  const holeBase = Manifold.cylinder(20, 5.42, 5.42, 6, true);
  const h1 = holeBase.translate([0, 50, 0]);
  const h2 = holeBase.translate([0, 0, 0]);
  const h3 = holeBase.translate([0, -130, 0]);
  const h4 = holeBase.translate([0, -205, 0]);
  return piece.subtract(splitter).subtract(h1).subtract(h2).subtract(h3).subtract(h4).scale(0.185);
}

function createSplitKing(): Manifold {
  const profile = loadDxfProfile("king_profile.dxf");
  const body = Manifold.revolve(profile, SEGMENTS).translate([0, 0, 140]).rotate([90, 180, 0]);
  const crossProfile = loadDxfProfile("cross_profile.dxf");
  const cross = Manifold.extrude(crossProfile, 10).translate([-25, 182, -5]).rotate([180, 180, 0]);
  const piece = Manifold.union([body, cross]);
  const splitter = Manifold.cube([200, 100, 370], false).translate([-100, 0, -150]).rotate([90, 180, 0]);
  const holeBase = Manifold.cylinder(20, 5.42, 5.42, 6, true);
  const h1 = holeBase.translate([0, -70, 0]);
  const h2 = holeBase.translate([0, -135, 0]);
  const h3 = holeBase.translate([0, 90, 0]);
  return piece.subtract(splitter).subtract(h1).subtract(h2).subtract(h3).scale(0.185);
}

const GENERATORS: Record<PieceId, () => Manifold> = {
  pawn: createPawn,
  rook: createRook,
  bishop: createBishop,
  knight: createKnight,
  queen: createQueen,
  king: createKing,
  split_pawn: createSplitPawn,
  split_bishop: createSplitBishop,
  split_bishop2: createSplitBishop2,
  split_knight: createSplitKnight,
  split_knight2: createSplitKnight2,
  split_queen: createSplitQueen,
  split_king: createSplitKing,
};

export function makePiece(id: PieceId): Manifold {
  const gen = GENERATORS[id];
  if (!gen) throw new Error(`Unknown piece id: ${id}`);
  return gen();
}

export function makeAllPieces(): Manifold[] {
  const spacing = 50;
  const rowLength = 5;
  return PIECE_IDS.map((id, index) => {
    const row = Math.floor(index / rowLength);
    const col = index % rowLength;
    return makePiece(id).translate([col * spacing, -row * spacing, 0]);
  });
}

