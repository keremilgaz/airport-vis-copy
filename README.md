 Airport Graph — Visual Analytics Tool

An interactive, full-stack tool for **exploring and analyzing a global airport / flight-route network as a graph**. Pan and zoom through 347 airports and 10,000+ directed routes, filter by continent or country, click any airport to inspect it, and compute the shortest hop-path between any two airports — all backed by a Neo4j graph database.

<!-- 👇 Add a screenshot or short GIF here — this is the single biggest thing that makes the repo look great when someone opens it.
     Drop an image into a /docs folder and reference it, e.g.: -->
<!-- ![Airport graph screenshot](docs/screenshot.png) -->

<p>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js%2015-000000?logo=nextdotjs&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React%2019-20232a?logo=react&logoColor=61dafb">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white">
  <img alt="Neo4j" src="https://img.shields.io/badge/Neo4j%205.26-4581C3?logo=neo4j&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker%20Compose-2496ED?logo=docker&logoColor=white">
</p>

---

## Highlights

- **Graph-native data model** — airports and routes are stored as nodes and relationships in **Neo4j**, not flattened into tables, so neighbour lookups and path queries run as graph traversals.
- **Real graph analysis** — a **BFS shortest-path** endpoint finds the minimum-hop route between any two airports, plus dataset statistics and top-hub ranking.
- **Interactive, performant frontend** — a **Canvas 2D** rendering layer (with D3) handles thousands of edges with smooth pan, zoom, and live filtering.
- **One-command, fully containerized setup** — `docker compose up` brings up Neo4j, the API, and the web app together; the backend waits for the database to be healthy and auto-imports the dataset on first run.

## Tech Stack

| Layer    | Technology                                  |
|----------|---------------------------------------------|
| Database | Neo4j 5.26 (graph database, Cypher)         |
| Backend  | FastAPI (Python 3.12)                        |
| Frontend | Next.js 15, React 19, TypeScript, D3, Canvas 2D |
| Infra    | Docker Compose (3 services)                 |

## Quick Start

```bash
# 1. Build & start all services (Neo4j + API + web app)
docker compose up --build

# 2. Open the app
#    → http://localhost:3000
```

| Service          | URL                          |
|------------------|------------------------------|
| Web app          | http://localhost:3000        |
| API (Swagger UI) | http://localhost:8080/docs   |
| Neo4j Browser    | http://localhost:7474        |

On first start the backend waits for Neo4j to become healthy, then loads
`nodes.csv` and `edges.csv` into the graph automatically. You can re-import
manually at any time via `GET http://localhost:8080/load-data`.

> Neo4j dev credentials (local only): `neo4j` / `ava25-DB!!`

## API

| Method | Path                          | Description                                |
|--------|-------------------------------|--------------------------------------------|
| GET    | `/`                           | API root / HTML index                      |
| GET    | `/docs`                       | Interactive Swagger UI                     |
| GET    | `/load-data`                  | (Re-)import the CSV dataset into Neo4j      |
| GET    | `/graph`                      | Returns the graph; supports filter params  |
| GET    | `/node/{iata}`                | Airport details + full neighbour list      |
| GET    | `/shortest-path?from=X&to=Y`  | BFS shortest hop-path between two airports  |
| GET    | `/stats`                      | Dataset statistics & top hubs              |

**`/graph` filter parameters**

| Param        | Description                                         |
|--------------|-----------------------------------------------------|
| `continent`  | `EU` / `NA` / `AS` / `OC`                            |
| `country`    | Two-letter code (e.g. `FR`, `DE`, `US`)              |
| `min_degree` | Hide airports with fewer than N connections          |
| `max_dist`   | Hide flight edges longer than N km                   |

## Frontend Features

- **Pan & zoom** — drag to pan, scroll to zoom, plus a *Reset View* button
- **Continent / country filters** — color-coded by continent, narrow to one country
- **Connection & distance sliders** — hide low-degree airports or long-haul edges
- **Node inspector** — click an airport for details, runway info, and its neighbours
- **Shortest-path finder** — enter two IATA codes; the route is highlighted on the graph
- **Search** — jump to any airport by IATA code or city name
- **Importance-aware sizing** — node radius scales logarithmically with degree (bigger = bigger hub)

## Dataset

- **347 airports** across Europe, North America, Asia, and Oceania
- **10,084 directed flight routes** with distances in km
- Node attributes: IATA, ICAO, city, country, continent, latitude/longitude, runways, altitude

## Architecture

```
┌────────────┐      HTTP/JSON      ┌────────────┐      Bolt       ┌────────────┐
│  Next.js   │  ───────────────▶   │  FastAPI   │  ───────────▶   │   Neo4j    │
│  (web app) │  ◀───────────────   │   (API)    │  ◀───────────   │  (graph)   │
└────────────┘                     └────────────┘                 └────────────┘
   :3000                               :8080                       :7474 / :7687
```

## Local Development (without Docker)

```bash
# Backend (needs a Neo4j instance running separately)
cd backend/app
pip install -r ../requirements.txt
python main.py --dev --port 8080

# Frontend
cd frontend
npm install
npm run dev
```