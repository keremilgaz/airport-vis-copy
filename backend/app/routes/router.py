from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse, JSONResponse
from neo4j import GraphDatabase
import os
import pandas as pd
from typing import Optional

NEO4J_URI = "bolt://" + os.environ.get("DB_HOST", "localhost") + ":7687"
NEO4J_USER = "neo4j"
NEO4J_PASSWORD = os.environ.get("DB_PASSWORD", "ava25-DB!!")

router = APIRouter()

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


def get_driver():
    return GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))


def assign_continent(row):
    c = row.get("continent")
    if c and str(c) not in ("nan", "None", ""):
        return str(c)
    return "Unknown"



@router.get("/", response_class=HTMLResponse, tags=["ROOT"])
async def root():
    return HTMLResponse("""
        <html><head><title>Airport Graph API</title></head>
        <body>
        <h1>Airport Graph API</h1>
        <ul>
          <li><a href="/docs">/docs — Swagger UI</a></li>
          <li>GET /load-data — Load CSV data into Neo4j</li>
          <li>GET /graph — Full graph</li>
          <li>GET /node/{iata} — Airport details + neighbours</li>
          <li>GET /shortest-path?from=ATL&amp;to=LHR — Shortest hop path</li>
          <li>GET /stats — Dataset statistics</li>
        </ul></body></html>
    """)



@router.get("/load-data", response_class=JSONResponse, tags=["Setup"])
async def load_data():
    """One-time setup: read CSVs and populate Neo4j."""
    nodes_path = os.path.join(DATA_DIR, "nodes.csv")
    edges_path = os.path.join(DATA_DIR, "edges.csv")

    if not os.path.exists(nodes_path) or not os.path.exists(edges_path):
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": f"CSV files not found in {DATA_DIR}"},
        )

    try:
        nodes_df = pd.read_csv(nodes_path)
        edges_df = pd.read_csv(edges_path)
        nodes_df["continent"] = nodes_df.apply(assign_continent, axis=1)

        driver = get_driver()
        with driver.session() as session:
            session.run("MATCH (n) DETACH DELETE n")
            session.run(
                "CREATE INDEX airport_iata IF NOT EXISTS FOR (a:Airport) ON (a.iata)"
            )

            for row in nodes_df.to_dict("records"):
                props = {
                    k: (None if (str(v) in ("nan", "None", "")) else v)
                    for k, v in row.items()
                }
                session.run(
                    """
                    CREATE (a:Airport {
                        id: $id, iata: $iata, icao: $icao, city: $city,
                        descr: $descr, region: $region,
                        runways: $runways, longest: $longest, altitude: $altitude,
                        country: $country, continent: $continent,
                        lat: $lat, lon: $lon
                    })
                    """,
                    **props,
                )

            for row in edges_df.to_dict("records"):
                session.run(
                    """
                    MATCH (a:Airport {iata: $src}), (b:Airport {iata: $dest})
                    CREATE (a)-[:FLIGHT {dist: $dist}]->(b)
                    """,
                    src=row["src"],
                    dest=row["dest"],
                    dist=int(row["dist"]),
                )

        return {
            "success": True,
            "nodes_loaded": len(nodes_df),
            "edges_loaded": len(edges_df),
        }

    except Exception as exc:
        return JSONResponse(
            status_code=500, content={"success": False, "error": str(exc)}
        )



@router.get("/graph", response_class=JSONResponse, tags=["Graph"])
async def get_graph(
    continent: Optional[str] = None,
    country: Optional[str] = None,
    min_degree: int = Query(default=0, ge=0),
    max_dist: Optional[int] = None,
):
    """
    Return nodes and edges with optional filters.

    - continent: EU | NA | AS | OC | Unknown
    - country:   two-letter code
    - min_degree: hide airports with fewer connections
    - max_dist:   hide flight edges longer than this (km)
    """
    driver = get_driver()
    with driver.session() as session:
        conditions = []
        params: dict = {"min_degree": min_degree}
        if continent:
            conditions.append("a.continent = $continent")
            params["continent"] = continent
        if country:
            conditions.append("a.country = $country")
            params["country"] = country

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        node_rows = session.run(
            f"""
            MATCH (a:Airport)
            {where}
            WITH a, size([(a)-[:FLIGHT]-() | 1]) AS degree
            WHERE degree >= $min_degree
            RETURN
                a.iata AS iata, a.icao AS icao,
                a.city AS city, a.descr AS descr,
                a.region AS region, a.country AS country,
                a.continent AS continent,
                a.lat AS lat, a.lon AS lon,
                a.runways AS runways, a.longest AS longest, a.altitude AS altitude,
                degree
            ORDER BY degree DESC
            """,
            **params,
        )

        nodes = [dict(r) for r in node_rows]
        if not nodes:
            return {"nodes": [], "edges": []}

        iata_list = [n["iata"] for n in nodes]

        edge_conditions = ["a.iata IN $iatas", "b.iata IN $iatas"]
        edge_params: dict = {"iatas": iata_list}
        if max_dist is not None:
            edge_conditions.append("r.dist <= $max_dist")
            edge_params["max_dist"] = max_dist

        edge_where = "WHERE " + " AND ".join(edge_conditions)

        edge_rows = session.run(
            f"""
            MATCH (a:Airport)-[r:FLIGHT]->(b:Airport)
            {edge_where}
            RETURN a.iata AS src, b.iata AS dest, r.dist AS dist
            """,
            **edge_params,
        )

        edges = [dict(r) for r in edge_rows]

    return {"nodes": nodes, "edges": edges}


@router.get("/node/{iata}", response_class=JSONResponse, tags=["Graph"])
async def get_node(iata: str):
    """Full details for one airport plus its direct connections."""
    driver = get_driver()
    try:
        with driver.session() as session:
            node_row = session.run(
                """
                MATCH (a:Airport {iata: $iata})
                WITH a, size([(a)-[:FLIGHT]-() | 1]) AS degree
                RETURN
                    a.iata AS iata, a.icao AS icao,
                    a.city AS city, a.descr AS descr,
                    a.region AS region, a.country AS country,
                    a.continent AS continent,
                    a.lat AS lat, a.lon AS lon,
                    a.runways AS runways, a.longest AS longest, a.altitude AS altitude,
                    degree
                """,
                iata=iata,
            ).single()

            if not node_row:
                return JSONResponse(
                    status_code=404,
                    content={"success": False, "error": "Airport not found"},
                )

            node_data = {k: (int(v) if hasattr(v, '__int__') and not isinstance(v, (bool, float, str)) else v)
                         for k, v in node_row.items()}

            neighbour_rows = session.run(
                """
                MATCH (a:Airport {iata: $iata})-[r:FLIGHT]-(b:Airport)
                RETURN b.iata AS iata, b.city AS city, b.country AS country, r.dist AS dist
                ORDER BY r.dist
                """,
                iata=iata,
            )
            neighbours = []
            for r in neighbour_rows:
                neighbours.append({
                    "iata": r["iata"],
                    "city": r["city"],
                    "country": r["country"],
                    "dist": int(r["dist"]) if r["dist"] is not None else None,
                })

        return {"success": True, "node": node_data, "neighbours": neighbours}

    except Exception as exc:
        return JSONResponse(status_code=500, content={"success": False, "error": str(exc)})
    finally:
        driver.close()


@router.get("/shortest-path", response_class=JSONResponse, tags=["Analysis"])
async def shortest_path(
    from_iata: str = Query(alias="from"),
    to_iata: str = Query(alias="to"),
):
    """BFS shortest-hop path between two airports (undirected)."""
    driver = get_driver()
    with driver.session() as session:
        result = session.run(
            """
            MATCH path = shortestPath(
                (a:Airport {iata: $from_iata})-[:FLIGHT*]-(b:Airport {iata: $to_iata})
            )
            RETURN
                [n IN nodes(path) | n.iata]  AS path_iatas,
                [n IN nodes(path) | n.city]  AS path_cities,
                [r IN relationships(path) | r.dist] AS distances
            """,
            from_iata=from_iata,
            to_iata=to_iata,
        ).single()

    if not result:
        return {"success": False, "error": "No path found between these airports"}

    return {
        "success": True,
        "path": result["path_iatas"],
        "cities": result["path_cities"],
        "distances": result["distances"],
        "total_dist": sum(result["distances"]),
        "hops": len(result["distances"]),
    }



@router.get("/stats", response_class=JSONResponse, tags=["Analysis"])
async def stats():
    """Overall graph statistics."""
    driver = get_driver()
    with driver.session() as session:
        basic = dict(
            session.run(
                """
                MATCH (a:Airport)
                WITH count(a) AS total_nodes
                MATCH ()-[r:FLIGHT]->()
                RETURN total_nodes, count(r) AS total_edges
                """
            ).single()
        )

        continents = [
            dict(r)
            for r in session.run(
                """
                MATCH (a:Airport)
                RETURN a.continent AS continent, count(a) AS count
                ORDER BY count DESC
                """
            )
        ]

        countries = [
            dict(r)
            for r in session.run(
                """
                MATCH (a:Airport)
                RETURN a.country AS country, count(a) AS count
                ORDER BY count DESC
                """
            )
        ]

        top_hubs = [
            dict(r)
            for r in session.run(
                """
                MATCH (a:Airport)
                WITH a, size([(a)-[:FLIGHT]-() | 1]) AS degree
                ORDER BY degree DESC LIMIT 10
                RETURN a.iata AS iata, a.city AS city, a.country AS country, degree
                """
            )
        ]

    return {**basic, "continents": continents, "countries": countries, "top_hubs": top_hubs}
