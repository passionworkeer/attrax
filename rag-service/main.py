"""FastAPI application entry point with lifespan management."""
from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup and shutdown events."""
    yield


app = FastAPI(title="Attrax RAG Service", lifespan=lifespan)
