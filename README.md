# ✈ Airport Graph – Visual Analytics Tool

Interactive graph visualization and analysis tool for an airport/flight-route dataset.

## Stack

| Layer    | Technology                      |
|----------|---------------------------------|
| Database | Neo4j 5.26 (graph database)     |
| Backend  | FastAPI (Python 3.12)           |
| Frontend | Next.js 15, React 19, Canvas 2D |

## Quick Start

```bash
# 1. Build & start all services
docker compose up --build

# 2. Open the app
open http://localhost:3000

# 3. (Optional) Neo4j Browser
open http://localhost:7474   # user: neo4j  /  password: ava25-DB!!
```

The backend auto-loads `nodes.csv` and `edges.csv` into Neo4j on first start.
You can also trigger it manually: `GET http://localhost:8080/load-data`

## API Endpoints

| Method | Path                          | Description                              |
|--------|-------------------------------|------------------------------------------|
| GET    | `/`                           | API root / HTML index                    |
| GET    | `/docs`                       | Swagger UI                               |
| GET    | `/load-data`                  | (Re-)load CSV data into Neo4j            |
| GET    | `/graph`                      | Full graph; supports filter params       |
| GET    | `/node/{iata}`                | Single airport details + neighbours      |
| GET    | `/shortest-path?from=X&to=Y`  | BFS shortest hop path between airports   |
| GET    | `/stats`                      | Dataset statistics & top hubs            |

### Graph filter params
- `continent` – `EU` / `NA` / `AS` / `OC`
- `country` – two-letter code (e.g. `FR`, `DE`, `US`)
- `min_degree` – hide airports with fewer connections
- `max_dist` – hide flight edges longer than N km

## Frontend Features

- **Pan & Zoom** – drag to pan, scroll-wheel to zoom, "Reset View" button
- **Continent filter** – color-coded by continent (Europe, N. America, Asia, Oceania)
- **Country filter** – narrows down to a single country
- **Min connections slider** – hide low-degree airports
- **Max route distance** – filter out long-haul edges
- **Node click** – shows airport details, runway info, and full neighbour list
- **Shortest path finder** – enter two IATA codes, highlights the route on the graph
- **Search bar** – jump to any airport by IATA code or city name
- **Node sizing** – radius scales logarithmically with degree (hub size = importance)

## Dataset

- **347 airports** across Europe, North America, Asia, and Oceania
- **10 084 directed flight routes** with distances in km
- Node attributes: IATA, ICAO, city, country, continent, lat/lon, runways, altitude

## Development

```bash
# Backend only (needs Neo4j running separately)
cd backend/app
pip install -r ../requirements.txt
python main.py --dev --port 8080

# Frontend only
cd frontend
npm install
npm run dev
```
