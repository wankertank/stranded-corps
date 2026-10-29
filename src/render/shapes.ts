import * as THREE from 'three';

/** One cross-section of a lofted hull: a superellipse at `x`, `w` wide and `h` tall, centred at height `y`. */
export interface Section {
  x: number;
  w: number;
  h: number;
  y: number;
  /** Superellipse exponent: 2 is an ellipse, 4 and up get boxier. */
  n?: number;
  /** Squeezes the bottom half (0..1), for a flat belly under a rounded back. */
  belly?: number;
}

/**
 * Skins a run of cross-sections along +x into a closed hull, capped at both ends.
 * Good for fuselages, pods and spines. Pair with a triplanar material, since it has no UVs to speak of.
 */
export function loft(sections: Section[], radial = 28): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (const s of sections) {
    const n = s.n ?? 4;
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const py = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n) * s.h / 2, pz = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * s.w / 2;
      pos.push(s.x, s.y + (py < 0 ? py * (1 - (s.belly ?? 0)) : py), pz);
    }
  }
  for (let k = 0; k < sections.length - 1; k++) for (let i = 0; i < radial; i++) {
    const a = k * radial + i, b = k * radial + (i + 1) % radial, c = a + radial, d = b + radial;
    idx.push(a, c, b, b, c, d);
  }
  // end caps as fans around each end section's centre
  // (their own vertices, so the hull's smooth normals don't bend into them)
  for (const [k, flip] of [[0, true], [sections.length - 1, false]] as const) {
    const s = sections[k], centre = pos.length / 3; pos.push(s.x, s.y, 0);
    for (let i = 0; i < radial; i++) pos.push(pos[(k * radial + i) * 3], pos[(k * radial + i) * 3 + 1], pos[(k * radial + i) * 3 + 2]);
    for (let i = 0; i < radial; i++) {
      const a = centre + 1 + i, b = centre + 1 + (i + 1) % radial;
      if (flip) idx.push(centre, a, b); else idx.push(centre, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat plate from an outline in the x/z plane, `t` thick, with bevelled edges. Wings, fins, torn panels. */
export function plate(outline: [number, number][], t: number, bevel = 0.04): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
  g.translate(0, 0, -t / 2);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Turns a profile of [radius, x] pairs around the x axis. Engine pods, nozzles, vertebrae. */
export function latheX(profile: [number, number][], segments = 24): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), segments);
  g.rotateZ(-Math.PI / 2);
  return g;
}
