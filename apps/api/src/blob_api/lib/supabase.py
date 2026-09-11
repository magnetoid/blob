"""Supabase client for hybrid integration (Phase 2).

Provides access to Supabase Edge Functions and Storage for high-latency agent tasks.
"""

from __future__ import annotations

import logging
from typing import Any

from ..config import settings

log = logging.getLogger("blob.supabase")

_supabase_client = None

def get_supabase_client() -> Any:
    """Return a configured Supabase client if enabled."""
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        return None

    try:
        from supabase import create_client  # type: ignore[import-not-found]
        _supabase_client = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY
        )
        return _supabase_client
    except ImportError:
        log.warning(
            "Supabase SDK not installed. "
            "Run `uv add supabase` to enable hybrid integration."
        )
        return None

async def invoke_edge_function(function_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Invoke a Supabase Edge Function for high-latency tasks."""
    client = get_supabase_client()
    if not client:
        raise RuntimeError("Supabase is not configured or SDK is missing.")

    import asyncio
    
    def _invoke() -> dict[str, Any]:
        response = client.functions().invoke(function_name, invoke_options={"body": payload})
        # Note: The Python SDK's invoke() might return a FunctionResponse object or dict
        if hasattr(response, 'get'):
            return response
        return {"data": response}

    return await asyncio.to_thread(_invoke)
