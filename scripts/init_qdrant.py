#!/usr/bin/env python3
"""
init_qdrant.py - Initialize Qdrant collections for legal RAG

Creates two collections:
- legal_chunks: 1024-dim vectors (Cohere embed-multilingual-v3), cosine similarity
- legal_chunks_parents: 1024-dim vectors for parent-level context
"""
import sys
sys.stdout.reconfigure(encoding="utf-8")

import os
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, SparseVectorParams, OnDisk

QDRANT_HOST = os.environ.get("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.environ.get("QDRANT_PORT", "6333"))

VECTOR_DIM = 1024  # Cohere embed-multilingual-v3

COLLECTIONS = [
    {
        "name": "legal_chunks",
        "description": "Child chunks for semantic retrieval (300-500 tokens per chunk)",
        "vector_size": VECTOR_DIM,
    },
    {
        "name": "legal_chunks_parents",
        "description": "Parent chunks for context expansion (full Article/Section)",
        "vector_size": VECTOR_DIM,
    },
]


def create_collection(client: QdrantClient, name: str, vector_size: int, description: str):
    """Create collection with named vectors and sparse matching."""
    from qdrant_client.models import SparseIndexParams

    try:
        client.delete_collection(collection_name=name)
        print(f"  Deleted existing collection: {name}")
    except Exception:
        pass

    client.create_collection(
        collection_name=name,
        vectors_config=VectorParams(
            size=vector_size,
            distance=Distance.Cosine,
            on_disk=OnDisk(True),
        ),
        sparse_vectors_config={
            "text": SparseVectorParams(
                index=SparseIndexParams(
                    min_window_size=5,
                    max_window_size=32,
                )
            )
        },
    )
    print(f"  Created: {name} ({vector_size}d, cosine)")


def init_collections():
    """Initialize all Qdrant collections."""
    print("=" * 60)
    print("  Qdrant Collection Initialization")
    print("=" * 60)

    try:
        client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
        client.health()
        print(f"  Connected to Qdrant at {QDRANT_HOST}:{QDRANT_PORT}")
    except Exception as e:
        print(f"  ERROR: Cannot connect to Qdrant at {QDRANT_HOST}:{QDRANT_PORT}")
        print(f"  Detail: {e}")
        print()
        print("  Make sure Qdrant is running:")
        print("    docker run -d --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant")
        return

    for coll in COLLECTIONS:
        print(f"\n  Creating: {coll['name']}")
        print(f"    {coll['description']}")
        create_collection(client, coll["name"], coll["vector_size"], coll["description"])

    # List collections
    print("\n  Current collections:")
    collections = client.get_collections().collections
    for c in collections:
        info = client.get_collection(c.name)
        points = info.points_count
        print(f"    - {c.name}: {points} points")


if __name__ == "__main__":
    init_collections()
