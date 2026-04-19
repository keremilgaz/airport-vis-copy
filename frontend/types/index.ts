export interface AirportNode {
  iata: string;
  icao: string;
  city: string;
  descr: string;
  region: string;
  country: string;
  continent: string;
  lat: number;
  lon: number;
  runways: number;
  longest: number;
  altitude: number;
  degree: number;
}

export interface FlightEdge {
  src: string;
  dest: string;
  dist: number;
}

export interface GraphData {
  nodes: AirportNode[];
  edges: FlightEdge[];
}

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

export interface PathResult {
  success: boolean;
  path: string[];
  cities: string[];
  distances: number[];
  total_dist: number;
  hops: number;
  error?: string;
}
