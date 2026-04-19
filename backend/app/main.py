import argparse
import sys
import time
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from routes.router import router, get_driver, load_data


async def ensure_data_loaded():
    """Auto-load CSV data if the database is empty."""
    for attempt in range(20):
        try:
            driver = get_driver()
            with driver.session() as session:
                result = session.run("MATCH (a:Airport) RETURN count(a) AS n").single()
                count = result["n"] if result else 0
            if count == 0:
                print("Database is empty: loading airport data from CSV files...")
                outcome = await load_data()
                if outcome.get("success"):
                    print(
                        f"Loaded {outcome['nodes_loaded']} airports "
                        f"and {outcome['edges_loaded']} flight edges."
                    )
                else:
                    print(f"Data load failed: {outcome.get('error')}")
            else:
                print(f"Database already contains {count} airports — skipping load.")
            return
        except Exception as exc:
            print(f"Neo4j not ready yet (attempt {attempt + 1}/20): {exc}")
            time.sleep(3)

    print("Warning: could not connect to Neo4j after 20 attempts.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting Airport Graph backend...")
    await ensure_data_loaded()
    yield
    print("Shutting down backend.")


api_app = FastAPI(
    title="Airport Graph API",
    description="Visual analytics backend for airport and flight graph data.",
    version="1.0.0",
    lifespan=lifespan,
)

api_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_app.include_router(router)


def main(args):
    parser = argparse.ArgumentParser(description="Airport Graph Python Backend")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--dev", action="store_true")
    args = parser.parse_args(args)

    if args.dev:
        uvicorn.run(
            "main:api_app", host="0.0.0.0", port=args.port,
            reload=True, access_log=False, workers=1,
        )
    else:
        uvicorn.run(
            "main:api_app", host="0.0.0.0", port=args.port,
            access_log=False, workers=4,
        )


if __name__ == "__main__":
    main(sys.argv[1:])
