/**
 * Build packages/web/src/data/worldMap.ts — the country outlines /data draws.
 *
 * /data ships no charting library: every chart on it is plain SVG sized in a
 * fixed viewBox (see the "Chart geometry" note in src/pages/data.astro). The
 * geographic breakdown follows the same rule, so the country shapes are
 * projected here, once, and committed as flat path strings. The page then
 * renders a map by emitting `<path d={...}>` — no runtime projection, no
 * TopoJSON decoder in the bundle, nothing to load client-side.
 *
 * Source is Natural Earth's 110m admin-0 set, as published by world-atlas.
 * 110m is the coarsest of the three, which is what this wants: the map is
 * ~1000px wide on screen, so finer coastlines would cost bytes no reader can
 * see.
 *
 * Projection is equirectangular, clipped to the inhabited band (see LAT_*).
 * Antarctica is dropped — it has no users, and keeping it wastes a third of the
 * vertical space on a landmass that would never be shaded.
 *
 * Countries are keyed by ISO 3166-1 alpha-2, because that is what
 * `cf-ipcountry` gives us at the edge — the code the feeds actually carry.
 *
 * Run with:
 *   bun run --cwd packages/web script/build-world-map.ts
 *
 * Re-run only to pick up a new Natural Earth revision; the output is otherwise
 * stable and committed.
 */
import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, "..")
const OUTPUT_FILE = path.join(webRoot, "src/data/worldMap.ts")

const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
const CODES_URL = "https://cdn.jsdelivr.net/npm/i18n-iso-countries@7/codes.json"

/** Drawing box. Width is the page's usual 1000-unit chart width. */
const MAP_W = 1000
/**
 * Latitude clip. The north edge keeps Greenland and the Canadian Arctic whole;
 * the south edge sits below Tierra del Fuego and New Zealand and above
 * Antarctica. Everything in between is where people are.
 */
const LAT_NORTH = 84
const LAT_SOUTH = -56
/** ISO numeric for Antarctica, dropped outright. */
const ANTARCTICA = "010"

/** One decimal is ~0.04° at this scale — below a pixel, and it halves the file. */
const PRECISION = 1

/**
 * Places with no polygon at 110m.
 *
 * Natural Earth's coarsest set has no outline for a city-state or a small
 * island, so several jurisdictions that show up in real traffic — Singapore and
 * Hong Kong among the largest — would rank in the list beside a map that never
 * shaded them. They get a marker at these coordinates instead: a dot is honest
 * about a place too small to draw, whereas silence reads as no data.
 *
 * Latitude/longitude are the population centre, not the geometric one, which
 * for an archipelago is where a reader looks.
 */
const MARKERS: ReadonlyArray<[code: string, name: string, lat: number, lon: number]> = [
  ["SG", "Singapore", 1.35, 103.82],
  ["HK", "Hong Kong", 22.32, 114.17],
  ["MO", "Macao", 22.2, 113.54],
  ["MT", "Malta", 35.9, 14.51],
  ["BH", "Bahrain", 26.07, 50.55],
  ["MU", "Mauritius", -20.35, 57.55],
  ["MC", "Monaco", 43.73, 7.42],
  ["LI", "Liechtenstein", 47.17, 9.55],
  ["AD", "Andorra", 42.51, 1.52],
  ["SM", "San Marino", 43.94, 12.46],
  ["XK", "Kosovo", 42.6, 20.9],
  ["GI", "Gibraltar", 36.14, -5.35],
  ["JE", "Jersey", 49.21, -2.13],
  ["GG", "Guernsey", 49.47, -2.58],
  ["IM", "Isle of Man", 54.24, -4.55],
  ["MV", "Maldives", 3.2, 73.22],
  ["SC", "Seychelles", -4.68, 55.49],
  ["KM", "Comoros", -11.65, 43.33],
  ["ST", "São Tomé and Príncipe", 0.19, 6.61],
  ["CV", "Cabo Verde", 16.0, -24.01],
  ["BB", "Barbados", 13.19, -59.54],
  ["AG", "Antigua and Barbuda", 17.06, -61.8],
  ["LC", "Saint Lucia", 13.91, -60.98],
  ["GD", "Grenada", 12.12, -61.68],
  ["VC", "Saint Vincent and the Grenadines", 13.25, -61.2],
  ["KN", "Saint Kitts and Nevis", 17.36, -62.78],
  ["DM", "Dominica", 15.41, -61.37],
  ["WS", "Samoa", -13.76, -172.1],
  ["TO", "Tonga", -21.18, -175.2],
]

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] }
  arcs: number[][][]
  objects: {
    countries: {
      geometries: Array<{
        type: "Polygon" | "MultiPolygon"
        id?: string
        properties?: { name?: string }
        arcs: unknown
      }>
    }
  }
}

async function getJSON<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return (await response.json()) as T
}

const MAP_H = Math.round((MAP_W * (LAT_NORTH - LAT_SOUTH)) / 360)

/** Equirectangular: longitude maps linearly to x, latitude linearly to y. */
function project(lon: number, lat: number): [number, number] {
  const x = ((lon + 180) / 360) * MAP_W
  const y = ((LAT_NORTH - lat) / (LAT_NORTH - LAT_SOUTH)) * MAP_H
  return [x, y]
}

const round = (value: number) => Number(value.toFixed(PRECISION))

/**
 * Decodes one TopoJSON arc to projected points.
 *
 * TopoJSON stores arcs quantized and delta-encoded: the first position is
 * absolute in grid units, every later one is an offset from the previous. The
 * transform turns grid units back into degrees.
 */
function decodeArcs(topology: Topology): [number, number][][] {
  const { scale, translate } = topology.transform
  return topology.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => {
      x += dx
      y += dy
      return project(x * scale[0] + translate[0], y * scale[1] + translate[1])
    })
  })
}

/** A negative index means "this arc, reversed" — the shared-edge encoding. */
function ringPoints(indexes: number[], arcs: [number, number][][]): [number, number][] {
  const points: [number, number][] = []
  for (const index of indexes) {
    const arc = index < 0 ? [...arcs[~index]].reverse() : arcs[index]
    // Consecutive arcs in a ring share their join, so drop the duplicate.
    points.push(...(points.length > 0 ? arc.slice(1) : arc))
  }
  return points
}

/**
 * Guards the drawing box on the y axis.
 *
 * Nothing in the current data reaches it — the clip sits above the northernmost
 * land and below the southernmost, so no coastline is cut — but a future
 * Natural Earth revision that added a stray polar vertex would otherwise draw
 * outside the viewBox.
 */
const clampY = (y: number) => Math.min(Math.max(y, 0), MAP_H)

/**
 * Splits a ring where it crosses the antimeridian.
 *
 * Russia, Fiji and the Aleutians each have rings that run past 180 degrees and
 * come back at -180. Equirectangular sends those two neighbouring points to
 * opposite edges of the box, and joining them draws a line straight across the
 * whole map — six of them in this dataset, which is what "horizontal lines
 * breaking the map" looks like.
 *
 * A jump wider than half the map is therefore read as a wrap rather than as
 * geometry: the ring is cut there and each side continues as its own subpath,
 * carried out to the edge it was heading for so the coastline meets the border
 * cleanly instead of stopping short of it.
 */
function splitAtAntimeridian(points: [number, number][]): [number, number][][] {
  const parts: [number, number][][] = []
  let current: [number, number][] = [points[0]]

  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1]
    const [cx, cy] = points[i]
    if (Math.abs(cx - px) <= MAP_W / 2) {
      current.push(points[i])
      continue
    }
    // Eastbound leaves by the right edge and re-enters on the left; westbound
    // is the mirror. The crossing latitude is interpolated across the seam, so
    // both pieces end at the same height.
    const eastbound = px > cx
    const toEdge = eastbound ? MAP_W - px : px
    const span = eastbound ? MAP_W - px + cx : MAP_W - cx + px
    const y = span === 0 ? py : py + (cy - py) * (toEdge / span)
    current.push([eastbound ? MAP_W : 0, y])
    parts.push(current)
    current = [[eastbound ? 0 : MAP_W, y], points[i]]
  }

  parts.push(current)
  return parts
}

function ringPath(points: [number, number][]): string {
  if (points.length < 3) return ""
  return splitAtAntimeridian(points)
    .filter((part) => part.length >= 3)
    .map(
      (part) => `${part.map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x)},${round(clampY(y))}`).join("")}Z`,
    )
    .join("")
}

/** Rings smaller than this in square units are below a pixel; they cost bytes and draw nothing. */
const MIN_AREA = 0.4

function area(points: [number, number][]): number {
  let sum = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += points[j][0] * points[i][1] - points[i][0] * points[j][1]
  }
  return Math.abs(sum / 2)
}

function geometryPath(geometry: { type: string; arcs: unknown }, arcs: [number, number][][]): string {
  const polygons = (geometry.type === "Polygon" ? [geometry.arcs] : geometry.arcs) as number[][][]
  return polygons
    .flatMap((polygon) => polygon.map((ring) => ringPoints(ring, arcs)))
    .filter((points) => area(points) >= MIN_AREA)
    .map(ringPath)
    .join("")
}

const topology = await getJSON<Topology>(WORLD_URL)
const codes = await getJSON<[string, string, string, string][]>(CODES_URL)

/** ISO numeric (as world-atlas keys countries) to alpha-2 (as the edge reports it). */
const alpha2 = new Map(codes.map(([two, , numeric]) => [numeric, two]))

const arcs = decodeArcs(topology)

const countries = topology.objects.countries.geometries
  .filter((geometry) => geometry.id && geometry.id !== ANTARCTICA)
  .map((geometry) => ({
    code: alpha2.get(geometry.id!) ?? null,
    name: geometry.properties?.name ?? "",
    path: geometryPath(geometry, arcs),
  }))
  .filter((country): country is { code: string; name: string; path: string } => !!country.code && !!country.path)
  .sort((a, b) => a.code.localeCompare(b.code))

const missing = topology.objects.countries.geometries.filter(
  (geometry) => geometry.id && geometry.id !== ANTARCTICA && !alpha2.has(geometry.id),
)
if (missing.length > 0) {
  console.warn(`no alpha-2 for: ${missing.map((geometry) => geometry.properties?.name).join(", ")}`)
}

const drawn = new Set(countries.map((country) => country.code))
const markers = MARKERS.filter(([code]) => !drawn.has(code)).map(([code, name, lat, lon]) => {
  const [x, y] = project(lon, lat)
  return { code, name, x: round(x), y: round(clampY(y)) }
})

const names = Object.fromEntries([
  ...countries.map((country) => [country.code, country.name] as const),
  ...markers.map((marker) => [marker.code, marker.name] as const),
])

const file = `/**
 * Country outlines for the geographic breakdown on /data.
 *
 * GENERATED by script/build-world-map.ts — do not edit by hand.
 *
 * Natural Earth 110m, equirectangular, clipped to ${LAT_SOUTH}..${LAT_NORTH} degrees latitude,
 * projected into a ${MAP_W}x${MAP_H} box. Keyed by ISO 3166-1 alpha-2, the code
 * \`cf-ipcountry\` reports at the edge.
 */

export const MAP_WIDTH = ${MAP_W}
export const MAP_HEIGHT = ${MAP_H}

export interface CountryShape {
  /** ISO 3166-1 alpha-2. */
  code: string
  /** English name, as Natural Earth spells it. */
  name: string
  /** SVG path data in the ${MAP_W}x${MAP_H} box. */
  path: string
}

export const COUNTRY_SHAPES: CountryShape[] = ${JSON.stringify(countries, null, 2)}

export interface CountryMarker {
  /** ISO 3166-1 alpha-2. */
  code: string
  name: string
  /** Population centre, projected into the same box. */
  x: number
  y: number
}

/**
 * Places too small to have an outline at this resolution — city-states and
 * small islands. Drawn as a dot so a country that ranks in the list is always
 * visible on the map beside it.
 */
export const COUNTRY_MARKERS: CountryMarker[] = ${JSON.stringify(markers, null, 2)}

/** Name lookup for every code the map can show, shapes and markers alike. */
export const COUNTRY_NAMES: Record<string, string> = ${JSON.stringify(names, null, 2)}
`

writeFileSync(OUTPUT_FILE, file)
console.log(
  `${countries.length} countries -> ${path.relative(webRoot, OUTPUT_FILE)} (${(file.length / 1024).toFixed(0)}KB)`,
)
