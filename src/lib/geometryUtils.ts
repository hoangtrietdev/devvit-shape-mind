import * as THREE from 'three';
import type { ShapeType } from './gameLogic';

export type FaceData = {
  id: number;
  centroid: THREE.Vector3;
  normal: THREE.Vector3;
};

export function extractFaces(
  geometry: THREE.BufferGeometry,
  shapeType: ShapeType
): FaceData[] {
  // Ensure non-indexed for per-triangle access
  let geo = geometry.clone();
  if (geo.index) {
    geo = geo.toNonIndexed();
  }
  geo.computeVertexNormals();

  const posAttr = geo.attributes['position'];
  if (!posAttr) return [];

  const numTriangles = posAttr.count / 3;

  let trianglesPerFace = 1;
  if (shapeType === 'cube') trianglesPerFace = 2;
  if (shapeType === 'dodecahedron') trianglesPerFace = 3;

  const numFaces = Math.floor(numTriangles / trianglesPerFace);
  const faces: FaceData[] = [];

  for (let f = 0; f < numFaces; f++) {
    const centroid = new THREE.Vector3();
    const normal = new THREE.Vector3();

    for (let t = 0; t < trianglesPerFace; t++) {
      const triIdx = f * trianglesPerFace + t;
      const base = triIdx * 3;

      const p0 = new THREE.Vector3(
        posAttr.getX(base),
        posAttr.getY(base),
        posAttr.getZ(base)
      );
      const p1 = new THREE.Vector3(
        posAttr.getX(base + 1),
        posAttr.getY(base + 1),
        posAttr.getZ(base + 1)
      );
      const p2 = new THREE.Vector3(
        posAttr.getX(base + 2),
        posAttr.getY(base + 2),
        posAttr.getZ(base + 2)
      );

      centroid.add(p0).add(p1).add(p2);

      // Compute normal from first triangle only
      if (t === 0) {
        const cb = new THREE.Vector3().subVectors(p2, p1);
        const ab = new THREE.Vector3().subVectors(p0, p1);
        cb.cross(ab).normalize();
        normal.copy(cb);
      }
    }

    centroid.divideScalar(trianglesPerFace * 3);
    faces.push({ id: f, centroid, normal });
  }

  return faces;
}
