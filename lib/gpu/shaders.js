// lib/gpu/shaders.js — the WGSL behind a splat3d figure: a Lambert mesh pass,
// a wireframe pass, and the Gaussian splat pass (instanced quads whose
// vertex stage projects each 3D covariance to the screen through the EWA
// Jacobian and whose fragment stage evaluates the 2D Gaussian). Premultiplied
// alpha throughout: the canvas is configured premultiplied and the splats
// blend with (one, one-minus-src-alpha), drawn back to front.
export const MESH_WGSL = /* wgsl */ `
struct U { mvp: mat4x4<f32>, light: vec4<f32>, color: vec4<f32>, params: vec4<f32> };
@group(0) @binding(0) var<uniform> u: U;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) n: vec3<f32> };
@vertex fn vs(@location(0) p: vec3<f32>, @location(1) n: vec3<f32>) -> VOut {
  var o: VOut;
  o.pos = u.mvp * vec4<f32>(p, 1.0);
  o.n = n;
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {
  let d = max(dot(normalize(i.n), normalize(u.light.xyz)), 0.0);
  let s = u.params.x + (1.0 - u.params.x) * d;
  let a = u.params.y;
  return vec4<f32>(u.color.rgb * s * a, a);
}`;

export const WIRE_WGSL = /* wgsl */ `
struct U { mvp: mat4x4<f32>, light: vec4<f32>, color: vec4<f32>, params: vec4<f32> };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@location(0) p: vec3<f32>) -> @builtin(position) vec4<f32> { return u.mvp * vec4<f32>(p, 1.0); }
@fragment fn fs() -> @location(0) vec4<f32> { let a = u.params.y; return vec4<f32>(u.color.rgb * a, a); }`;

export const SPLAT_WGSL = /* wgsl */ `
struct Cam { view: mat4x4<f32>, proj: mat4x4<f32>, focal: vec2<f32>, viewport: vec2<f32>, color: vec4<f32>, params: vec4<f32> };
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> g: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> order: array<u32>;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) d: vec2<f32>, @location(1) conic: vec3<f32>, @location(2) col: vec4<f32> };
const CORNERS = array<vec2<f32>, 6>(vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0));
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let idx = order[ii];
  let a0 = g[idx * 3u]; let a1 = g[idx * 3u + 1u]; let a2 = g[idx * 3u + 2u];
  let p = cam.view * vec4<f32>(a0.xyz, 1.0);
  // behind the camera or too close: collapse the quad
  if (p.z > -0.05) { o.pos = vec4<f32>(0.0, 0.0, 2.0, 1.0); return o; }
  let S = mat3x3<f32>(a1.x, a1.y, a1.z, a1.y, a2.x, a2.y, a1.z, a2.y, a2.z);
  let W = mat3x3<f32>(cam.view[0].xyz, cam.view[1].xyz, cam.view[2].xyz);
  let tz = p.z; let tx = p.x; let ty = p.y;
  let fx = cam.focal.x; let fy = cam.focal.y;
  // J: the Jacobian of the perspective projection at p (columns)
  let J = mat3x3<f32>(fx / tz, 0.0, 0.0, 0.0, fy / tz, 0.0, -fx * tx / (tz * tz), -fy * ty / (tz * tz), 0.0);
  let C = J * (W * S * transpose(W)) * transpose(J);
  var cxx = C[0][0] + 0.3; let cxy = C[0][1]; var cyy = C[1][1] + 0.3;
  let det = cxx * cyy - cxy * cxy;
  if (det <= 0.0) { o.pos = vec4<f32>(0.0, 0.0, 2.0, 1.0); return o; }
  let mid = 0.5 * (cxx + cyy);
  let l1 = mid + sqrt(max(0.1, mid * mid - det));
  let radius = min(ceil(3.0 * sqrt(l1)), 0.6 * max(cam.viewport.x, cam.viewport.y));
  let center = cam.proj * p;
  let ndc = center.xy / center.w;
  let corner = CORNERS[vi] * radius;              // pixels, y up
  let delta = corner * 2.0 / cam.viewport;        // NDC
  o.pos = vec4<f32>((ndc + delta) * center.w, center.z, center.w);
  o.d = corner;
  o.conic = vec3<f32>(cyy / det, -cxy / det, cxx / det);
  let shade = a0.w; let opacity = a1.w;
  o.col = vec4<f32>(cam.color.rgb * shade, opacity * cam.params.x);
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {
  let power = -0.5 * (i.conic.x * i.d.x * i.d.x + i.conic.z * i.d.y * i.d.y) - i.conic.y * i.d.x * i.d.y;
  if (power > 0.0) { discard; }
  let alpha = min(0.99, i.col.a * exp(power));
  if (alpha < 0.0039) { discard; }
  return vec4<f32>(i.col.rgb * alpha, alpha);
}`;
