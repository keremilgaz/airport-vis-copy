"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import { AirportNode, FlightEdge, GraphData, PathResult } from "@/types";

const CONTINENT_COLORS: Record<string, string> = {
  EU: "#3b82f6",
  NA: "#22c55e",
  AS: "#f97316",
  OC: "#a855f7",
  Unknown: "#94a3b8",
};

const CONTINENT_LABELS: Record<string, string> = {
  EU: "Europe",
  NA: "N. America",
  AS: "Asia",
  OC: "Oceania",
  Unknown: "Other",
};

const RUNWAY_COLORS: Record<number, string> = {
  1: "#4ade80", 2: "#a3e635", 3: "#facc15",
  4: "#fb923c", 5: "#f87171", 6: "#e879f9", 7: "#a855f7",
};
const RUNWAY_MAX = 7;

export type ColorMode = "continent" | "runways";
export type SizeMode  = "degree"    | "runways";

function nodeColor(node: AirportNode, colorMode: ColorMode, isSelected: boolean, isPath: boolean, isNeighbor: boolean): string {
  if (isSelected || isPath) return "#fbbf24";
  if (isNeighbor) return "#60a5fa";
  if (colorMode === "runways") {
    const r = Math.max(1, Math.min(RUNWAY_MAX, Math.round(node.runways ?? 1)));
    return RUNWAY_COLORS[r] ?? "#94a3b8";
  }
  return CONTINENT_COLORS[node.continent] ?? "#94a3b8";
}

function nodeRadius(node: AirportNode, sizeMode: SizeMode, maxDegree: number, isSelected: boolean): number {
  const base = sizeMode === "runways"
    ? 3 + ((node.runways ?? 1) / RUNWAY_MAX) * 11
    : 3 + (Math.log1p(node.degree) / Math.log1p(maxDegree)) * 10;
  return isSelected ? base + 3 : base;
}

interface GraphViewProps {
  data: GraphData;
  selectedIata: string | null;
  pathIatas: string[];
  onSelect: (iata: string | null) => void;
  colorMode: ColorMode;
  sizeMode: SizeMode;
}

function GraphView({ data, selectedIata, pathIatas, onSelect, colorMode, sizeMode }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const gRef         = useRef<SVGGElement>(null);
  const zoomRef      = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  const selectedRef = useRef(selectedIata);
  const pathSetRef  = useRef(new Set(pathIatas));
  useEffect(() => { selectedRef.current = selectedIata; }, [selectedIata]);

  const [tooltip,    setTooltip]    = useState<{ x: number; y: number; text: string } | null>(null);
  const [worldGeo,   setWorldGeo]   = useState<GeoJSON.FeatureCollection | null>(null);
  const [dimensions, setDimensions] = useState({ w: 0, h: 0 });

  const projection = useMemo(() => {
    if (!worldGeo || !dimensions.w) return null;
    return d3.geoNaturalEarth1().fitSize([dimensions.w, dimensions.h], worldGeo);
  }, [worldGeo, dimensions]);

  const maxDegree   = useMemo(() => Math.max(1, ...data.nodes.map(n => n.degree)), [data.nodes]);
  const nodeMap     = useMemo(() => new Map(data.nodes.map(n => [n.iata, n])), [data.nodes]);
  const pathSet     = useMemo(() => new Set(pathIatas), [pathIatas]);
  const neighborSet = useMemo(() => {
    if (!selectedIata) return new Set<string>();
    const s = new Set<string>();
    for (const e of data.edges) {
      if (e.src  === selectedIata) s.add(e.dest);
      if (e.dest === selectedIata) s.add(e.src);
    }
    return s;
  }, [selectedIata, data.edges]);

  useEffect(() => { pathSetRef.current = pathSet; }, [pathSet]);

  useEffect(() => {
    if (!worldGeo || !projection || !dimensions.w) return;
    const off = document.createElement("canvas");
    off.width  = dimensions.w;
    off.height = dimensions.h;
    const ctx = off.getContext("2d")!;
    const pathGen = d3.geoPath().projection(projection).context(ctx);
    ctx.beginPath();
    for (const f of worldGeo.features) pathGen(f as any);
    ctx.fillStyle   = "#1e293b";
    ctx.fill();
    ctx.strokeStyle = "#334155";
    ctx.lineWidth   = 0.5;
    ctx.stroke();
    offscreenRef.current = off;
  }, [worldGeo, projection, dimensions]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const svg    = svgRef.current;
    if (!canvas || !svg || !projection) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y, k } = d3.zoomTransform(svg);
    const W = canvas.width;
    const H = canvas.height;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0f172a");
    grad.addColorStop(1, "#1e293b");
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    if (offscreenRef.current) {
      ctx.drawImage(offscreenRef.current, 0, 0);
    }

    const pathEdgeSet = new Set<string>();
    for (let i = 0; i < pathIatas.length - 1; i++) {
      pathEdgeSet.add(`${pathIatas[i]}|${pathIatas[i + 1]}`);
      pathEdgeSet.add(`${pathIatas[i + 1]}|${pathIatas[i]}`);
    }

    const buckets: Record<"path" | "highlighted" | "dimmed" | "normal", FlightEdge[]> = {
      path: [], highlighted: [], dimmed: [], normal: [],
    };
    for (const edge of data.edges) {
      if (pathEdgeSet.has(`${edge.src}|${edge.dest}`)) {
        buckets.path.push(edge);
      } else if (selectedIata && (edge.src === selectedIata || edge.dest === selectedIata)) {
        buckets.highlighted.push(edge);
      } else if (selectedIata || pathSet.size > 0) {
        buckets.dimmed.push(edge);
      } else {
        buckets.normal.push(edge);
      }
    }

    const styles = {
      path:        { color: "#fbbf24", width: 2.5, alpha: 1.0  },
      highlighted: { color: "#60a5fa", width: 1.2, alpha: 0.85 },
      dimmed:      { color: "#334155", width: 0.5, alpha: 0.3  },
      normal:      { color: "#475569", width: 0.5, alpha: 0.45 },
    };

    for (const bucket of ["normal", "dimmed", "highlighted", "path"] as const) {
      const edges = buckets[bucket];
      if (!edges.length) continue;
      const s = styles[bucket];
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = s.width / k;
      ctx.globalAlpha = s.alpha;
      ctx.beginPath();
      for (const edge of edges) {
        const a = nodeMap.get(edge.src);
        const b = nodeMap.get(edge.dest);
        if (!a || !b) continue;
        const pa = projection([a.lon, a.lat]);
        const pb = projection([b.lon, b.lat]);
        if (!pa || !pb) continue;
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }, [projection, data.edges, selectedIata, pathIatas, pathSet, nodeMap]);

  const drawCanvasRef = useRef(drawCanvas);
  useEffect(() => { drawCanvasRef.current = drawCanvas; }, [drawCanvas]);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g   = d3.select(gRef.current);

    zoomRef.current = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 30])
      .on("zoom", event => {
        g.attr("transform", event.transform);
        g.selectAll<SVGTextElement, AirportNode>("text")
          .attr("opacity", d =>
            (d.iata === selectedRef.current || pathSetRef.current.has(d.iata) || event.transform.k > 2) ? 1 : 0
          );
        drawCanvasRef.current();
      });

    svg.call(zoomRef.current);
    return () => { svg.on(".zoom", null); };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
      setDimensions({ w: container.clientWidth, h: container.clientHeight });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then(r => r.json())
      .then((topo: Topology) => {
        setWorldGeo(feature(topo, (topo as any).objects.countries) as GeoJSON.FeatureCollection);
      })
      .catch(console.error);
  }, []);

  useEffect(() => { drawCanvas(); }, [drawCanvas]);

  useEffect(() => {
    if (!projection || !gRef.current) return;
    const g = d3.select(gRef.current);
    const currentK = svgRef.current ? d3.zoomTransform(svgRef.current).k : 1;

    const nodeState = new Map(data.nodes.map(d => {
      const isSelected = d.iata === selectedIata;
      const isPath     = pathSet.has(d.iata);
      const isNeighbor = neighborSet.has(d.iata);
      const isDimmed   = Boolean((selectedIata || pathSet.size > 0) && !isSelected && !isNeighbor && !isPath);
      return [d.iata, { isSelected, isPath, isNeighbor, isDimmed }];
    }));

    let nodesG = g.select<SVGGElement>(".nodes");
    if (nodesG.empty()) nodesG = g.append("g").attr("class", "nodes");

    nodesG
      .selectAll<SVGGElement, AirportNode>("g.node")
      .data(data.nodes, d => d.iata)
      .join(enter => {
        const ng = enter.append("g").attr("class", "node").style("cursor", "pointer");
        ng.append("circle");
        ng.append("text").attr("pointer-events", "none").attr("text-anchor", "middle");
        return ng;
      })
      .attr("transform", d => {
        const [px, py] = projection([d.lon, d.lat]) ?? [0, 0];
        return `translate(${px},${py})`;
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        onSelect(d.iata === selectedIata ? null : d.iata);
      })
      .on("mouseover", (event, d) =>
        setTooltip({ x: event.clientX + 12, y: event.clientY - 8, text: `${d.iata} – ${d.city} (${d.country})` })
      )
      .on("mouseout", () => setTooltip(null))
      .each(function(d) {
        const s = nodeState.get(d.iata)!;
        const r = nodeRadius(d, sizeMode, maxDegree, s.isSelected);

        d3.select(this).select("circle")
          .attr("r",            r)
          .attr("fill",         nodeColor(d, colorMode, s.isSelected, s.isPath, s.isNeighbor))
          .attr("stroke",       s.isDimmed ? "#1e293b" : "rgba(255,255,255,0.25)")
          .attr("stroke-width", s.isSelected ? 2 : 0.8)
          .attr("opacity",      s.isDimmed ? 0.25 : 1)
          .attr("filter",       (s.isSelected || s.isPath) ? "url(#glow)" : null);

        d3.select(this).select("text")
          .attr("dy",        -(r + 3))
          .attr("font-size", 8)
          .attr("fill",      "#f1f5f9")
          .attr("opacity",   (s.isSelected || s.isPath || currentK > 2) ? 1 : 0)
          .text(d.iata);
      });
  }, [projection, data.nodes, selectedIata, pathIatas, pathSet, neighborSet, colorMode, sizeMode, maxDegree, onSelect]);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition().duration(300)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        onClick={() => onSelect(null)}
      >
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g ref={gRef} />
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded px-2 py-1 text-xs text-white shadow-lg"
          style={{
            left: tooltip.x,
            top:  tooltip.y,
            background: "rgba(15,23,42,0.92)",
            border: "1px solid rgba(100,116,139,0.4)",
          }}
        >
          {tooltip.text}
        </div>
      )}

      <button
        className="absolute bottom-4 right-4 rounded px-2 py-1 text-xs text-slate-300 hover:text-white"
        style={{ background: "rgba(30,41,59,0.85)", border: "1px solid #334155" }}
        onClick={resetZoom}
      >
        Reset View
      </button>
    </div>
  );
}

interface NodeInfoPanelProps {
  iata: string;
  onClose: () => void;
  onPathFrom: (iata: string) => void;
  onPathTo: (iata: string) => void;
  pathFrom: string;
  pathTo: string;
}

function NodeInfoPanel({ iata, onClose, onPathFrom, onPathTo, pathFrom, pathTo }: NodeInfoPanelProps) {
  const [info, setInfo] = useState<{
    node: AirportNode;
    neighbours: Array<{ iata: string; city: string; country: string; dist: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/node/${iata}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (d.success) setInfo(d); })
      .catch(e => console.error("Node fetch error:", e))
      .finally(() => setLoading(false));
  }, [iata]);

  const color = info ? (CONTINENT_COLORS[info.node.continent] ?? "#94a3b8") : "#94a3b8";

  return (
    <div className="flex flex-col h-full text-sm" style={{ background: "#0f172a", color: "#e2e8f0" }}>
      <div className="flex items-center justify-between p-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: color }} />
          <span className="font-bold text-base">{iata}</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400">Loading…</div>
      ) : !info ? (
        <div className="p-3 text-red-400">Failed to load data.</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 border-b border-slate-800">
            <div className="font-semibold text-white">{info.node.descr}</div>
            <div className="text-slate-400 text-xs mt-0.5">
              {info.node.city} · {info.node.country} · {CONTINENT_LABELS[info.node.continent] ?? info.node.continent}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-b border-slate-800" style={{ background: "#1e293b" }}>
            {([
              ["ICAO",        info.node.icao],
              ["Connections", info.node.degree],
              ["Runways",     info.node.runways],
              ["Longest",     `${info.node.longest} ft`],
              ["Altitude",    `${info.node.altitude} ft`],
              ["Region",      info.node.region],
            ] as [string, string | number][]).map(([k, v]) => (
              <div key={k} className="p-2" style={{ background: "#0f172a" }}>
                <div className="text-slate-500 text-xs">{k}</div>
                <div className="text-white font-medium text-xs mt-0.5">{v}</div>
              </div>
            ))}
          </div>

          <div className="p-3 border-b border-slate-800">
            <div className="text-slate-400 text-xs mb-2 uppercase tracking-wide">Shortest Path</div>
            <div className="flex gap-2">
              {(["From", "To"] as const).map(dir => {
                const active = dir === "From" ? pathFrom === iata : pathTo === iata;
                return (
                  <button
                    key={dir}
                    className="flex-1 py-1 rounded text-xs font-medium"
                    style={{
                      background: active ? (dir === "From" ? "#1d4ed8" : "#166534") : "#1e293b",
                      color:      active ? (dir === "From" ? "#bfdbfe"  : "#bbf7d0") : "#94a3b8",
                      border: "1px solid #334155",
                    }}
                    onClick={() => dir === "From" ? onPathFrom(iata) : onPathTo(iata)}
                  >
                    {active ? `✓ ${dir}` : `Set as ${dir}`}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3">
            <div className="text-slate-400 text-xs mb-2 uppercase tracking-wide">
              Connections ({info.neighbours.length})
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {info.neighbours.map(n => (
                <div
                  key={n.iata}
                  className="flex items-center justify-between py-1 px-2 rounded"
                  style={{ background: "#1e293b" }}
                >
                  <div>
                    <span className="font-bold text-xs text-blue-400">{n.iata}</span>
                    <span className="text-slate-400 text-xs ml-1.5">{n.city}</span>
                  </div>
                  <span className="text-slate-500 text-xs">{n.dist} km</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [graphData,    setGraphData]    = useState<GraphData>({ nodes: [], edges: [] });
  const [loading,      setLoading]      = useState(false);
  const [loadError,    setLoadError]    = useState("");
  const [selectedIata, setSelectedIata] = useState<string | null>(null);

  const [colorMode, setColorMode] = useState<ColorMode>("continent");
  const [sizeMode,  setSizeMode]  = useState<SizeMode>("degree");

  const [filterContinent, setFilterContinent] = useState("");
  const [filterCountry,   setFilterCountry]   = useState("");
  const [filterMinDegree, setFilterMinDegree] = useState(0);
  const [filterMaxDist,   setFilterMaxDist]   = useState<number | "">("");
  const [search,          setSearch]          = useState("");

  const [pathFrom,    setPathFrom]    = useState("");
  const [pathTo,      setPathTo]      = useState("");
  const [pathResult,  setPathResult]  = useState<PathResult | null>(null);
  const [pathLoading, setPathLoading] = useState(false);

  const [stats, setStats] = useState<{ total_nodes: number; total_edges: number } | null>(null);

  const availableCountries = useMemo(() => {
    const seen = new Set<string>();
    for (const n of graphData.nodes) {
      if (!filterContinent || n.continent === filterContinent) seen.add(n.country);
    }
    return Array.from(seen).sort();
  }, [graphData.nodes, filterContinent]);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams();
      if (filterContinent)     params.set("continent",  filterContinent);
      if (filterCountry)       params.set("country",    filterCountry);
      if (filterMinDegree > 0) params.set("min_degree", String(filterMinDegree));
      if (filterMaxDist !== "") params.set("max_dist",  String(filterMaxDist));
      const res = await fetch(`/api/graph?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGraphData(await res.json());
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filterContinent, filterCountry, filterMinDegree, filterMaxDist]);

  useEffect(() => {
    fetch("/api/stats")
      .then(r => r.json())
      .then(d => setStats({ total_nodes: d.total_nodes, total_edges: d.total_edges }))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  useEffect(() => {
    if (!search.trim()) return;
    const q = search.trim().toLowerCase();
    const found = graphData.nodes.find(
      n => n.iata.toLowerCase() === q || n.city.toLowerCase().includes(q),
    );
    if (found) setSelectedIata(found.iata);
  }, [search, graphData.nodes]);

  const pathIatas = useMemo(
    () => (pathResult?.success ? pathResult.path : []),
    [pathResult],
  );

  const findPath = async () => {
    if (!pathFrom || !pathTo) return;
    setPathLoading(true);
    setPathResult(null);
    try {
      const res = await fetch(`/api/shortest-path?from=${pathFrom}&to=${pathTo}`);
      setPathResult(await res.json());
    } finally {
      setPathLoading(false);
    }
  };

  const continentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of graphData.nodes) counts[n.continent] = (counts[n.continent] ?? 0) + 1;
    return counts;
  }, [graphData.nodes]);

  const inputStyle: React.CSSProperties = {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 6,
    color: "#e2e8f0",
    padding: "4px 8px",
    fontSize: 12,
    width: "100%",
    outline: "none",
  };

  const sectionTitle = "text-xs uppercase tracking-wide text-slate-500 mb-1.5 mt-3";

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "#020617", color: "#e2e8f0" }}>
      <div
        className="flex flex-col w-56 shrink-0 overflow-y-auto p-3 text-sm"
        style={{ background: "#0f172a", borderRight: "1px solid #1e293b" }}
      >
        <div className="mb-3">
          <div className="font-bold text-base text-white flex items-center gap-1.5">
            ✈ Airport Graph
          </div>
          {stats && (
            <div className="text-slate-500 text-xs mt-0.5">
              {stats.total_nodes} airports · {stats.total_edges.toLocaleString()} routes
            </div>
          )}
        </div>

        <div className={sectionTitle}>Search</div>
        <input
          style={inputStyle}
          placeholder="IATA or city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div className={sectionTitle}>Continent</div>
        <select
          style={inputStyle}
          value={filterContinent}
          onChange={e => { setFilterContinent(e.target.value); setFilterCountry(""); }}
        >
          <option value="">All continents</option>
          {Object.entries(CONTINENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <div className={sectionTitle}>Country</div>
        <select
          style={inputStyle}
          value={filterCountry}
          onChange={e => setFilterCountry(e.target.value)}
        >
          <option value="">All countries</option>
          {availableCountries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className={sectionTitle}>
          Min connections: <span className="text-white">{filterMinDegree}</span>
        </div>
        <input
          type="range" min={0} max={100} step={5}
          value={filterMinDegree}
          onChange={e => setFilterMinDegree(Number(e.target.value))}
          style={{ width: "100%", accentColor: "#3b82f6" }}
        />

        <div className={sectionTitle}>Max route dist (km)</div>
        <input
          type="number"
          style={inputStyle}
          placeholder="e.g. 2000"
          value={filterMaxDist}
          onChange={e => setFilterMaxDist(e.target.value === "" ? "" : Number(e.target.value))}
        />

        <button
          className="mt-3 py-1.5 rounded font-medium text-xs"
          style={{ background: "#1d4ed8", color: "#bfdbfe", border: "none" }}
          onClick={fetchGraph}
          disabled={loading}
        >
          {loading ? "Loading…" : "Apply Filters"}
        </button>

        {loadError && <div className="mt-2 text-red-400 text-xs">{loadError}</div>}

        <div className={sectionTitle + " mt-4"}>Color by</div>
        <div className="flex gap-1">
          {(["continent", "runways"] as ColorMode[]).map(m => (
            <button
              key={m}
              className="flex-1 py-1 rounded text-xs font-medium"
              style={{
                background: colorMode === m ? "#1d4ed8" : "#1e293b",
                color:      colorMode === m ? "#bfdbfe" : "#94a3b8",
                border: "1px solid #334155",
              }}
              onClick={() => setColorMode(m)}
            >
              {m === "continent" ? "Continent" : "Runways"}
            </button>
          ))}
        </div>

        <div className={sectionTitle}>Size by</div>
        <div className="flex gap-1">
          {(["degree", "runways"] as SizeMode[]).map(m => (
            <button
              key={m}
              className="flex-1 py-1 rounded text-xs font-medium"
              style={{
                background: sizeMode === m ? "#166534" : "#1e293b",
                color:      sizeMode === m ? "#bbf7d0" : "#94a3b8",
                border: "1px solid #334155",
              }}
              onClick={() => setSizeMode(m)}
            >
              {m === "degree" ? "Connections" : "Runways"}
            </button>
          ))}
        </div>

        <div className={sectionTitle + " mt-4"}>Legend</div>
        <div className="space-y-1">
          {colorMode === "continent" ? (
            Object.entries(CONTINENT_COLORS).map(([k, color]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-slate-300">{CONTINENT_LABELS[k]}</span>
                {continentCounts[k] !== undefined && (
                  <span className="text-slate-500 ml-auto">{continentCounts[k]}</span>
                )}
              </div>
            ))
          ) : (
            Object.entries(RUNWAY_COLORS).map(([k, color]) => {
              const count = graphData.nodes.filter(n => n.runways === Number(k)).length;
              return (
                <div key={k} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-slate-300">{k} runway{Number(k) !== 1 ? "s" : ""}</span>
                  <span className="text-slate-500 ml-auto">{count}</span>
                </div>
              );
            })
          )}
          <div className="flex items-center gap-2 text-xs mt-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "#fbbf24" }} />
            <span className="text-slate-300">Selected / Path</span>
          </div>
        </div>

        <div className="mt-4 text-xs text-slate-500">
          Showing {graphData.nodes.length} airports, {graphData.edges.length.toLocaleString()} routes
        </div>
      </div>

      <div className="flex-1 relative">
        <GraphView
          data={graphData}
          selectedIata={selectedIata}
          pathIatas={pathIatas}
          onSelect={setSelectedIata}
          colorMode={colorMode}
          sizeMode={sizeMode}
        />

        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 rounded-lg px-3 py-2 text-xs flex gap-2 items-center"
          style={{ background: "rgba(15,23,42,0.88)", border: "1px solid #334155", minWidth: 340 }}
        >
          <span className="text-slate-400">Path:</span>
          <input
            style={{ ...inputStyle, width: 72 }}
            placeholder="From"
            value={pathFrom}
            onChange={e => setPathFrom(e.target.value.toUpperCase())}
          />
          <span className="text-slate-500">→</span>
          <input
            style={{ ...inputStyle, width: 72 }}
            placeholder="To"
            value={pathTo}
            onChange={e => setPathTo(e.target.value.toUpperCase())}
          />
          <button
            className="px-2 py-1 rounded text-xs font-medium"
            style={{ background: "#1d4ed8", color: "#bfdbfe" }}
            onClick={findPath}
            disabled={pathLoading || !pathFrom || !pathTo}
          >
            {pathLoading ? "…" : "Find"}
          </button>
          {pathResult && (
            <span className={pathResult.success ? "text-green-400" : "text-red-400"}>
              {pathResult.success
                ? `${pathResult.hops} hops · ${pathResult.total_dist.toLocaleString()} km`
                : pathResult.error}
            </span>
          )}
          {pathResult?.success && (
            <button
              className="text-slate-500 hover:text-white"
              onClick={() => { setPathResult(null); setPathFrom(""); setPathTo(""); }}
            >
              ✕
            </button>
          )}
        </div>

        {pathResult?.success && (
          <div
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg px-3 py-2 text-xs max-w-2xl"
            style={{ background: "rgba(15,23,42,0.92)", border: "1px solid #fbbf2440" }}
          >
            <span className="text-yellow-400 font-medium mr-2">Route:</span>
            {pathResult.path.map((iata, i) => (
              <span key={i}>
                <span
                  className="cursor-pointer hover:text-yellow-300 text-yellow-200 font-bold"
                  onClick={() => setSelectedIata(iata)}
                >
                  {iata}
                </span>
                {pathResult.cities[i] && (
                  <span className="text-slate-500"> ({pathResult.cities[i]})</span>
                )}
                {i < pathResult.path.length - 1 && (
                  <span className="text-slate-600 mx-1">
                    →<span className="text-slate-500">{pathResult.distances[i]}km</span>→
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        className="flex-col shrink-0 overflow-hidden transition-all duration-200"
        style={{
          display: selectedIata ? "flex" : "none",
          width: selectedIata ? 240 : 0,
          borderLeft: "1px solid #1e293b",
        }}
      >
        {selectedIata && (
          <NodeInfoPanel
            key={selectedIata}
            iata={selectedIata}
            onClose={() => setSelectedIata(null)}
            onPathFrom={setPathFrom}
            onPathTo={setPathTo}
            pathFrom={pathFrom}
            pathTo={pathTo}
          />
        )}
      </div>
    </div>
  );
}
