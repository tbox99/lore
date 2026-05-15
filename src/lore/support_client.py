"""Core API client for Lenovo Support endpoints."""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from typing import Any

import httpx
from platformdirs import user_cache_dir

logger = logging.getLogger("lore")

# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

class DiskCache:
    """Simple file-based cache with TTL support."""

    def __init__(self, cache_dir: Path | None = None) -> None:
        self.cache_dir = cache_dir or Path(user_cache_dir("lore", "lenovo"))
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        safe = re.sub(r"[^a-zA-Z0-9_-]", "_", key)
        return self.cache_dir / f"{safe}.json"

    def get(self, key: str, ttl: float) -> Any | None:
        p = self._path(key)
        if not p.exists():
            return None
        if time.time() - p.stat().st_mtime > ttl:
            p.unlink(missing_ok=True)
            return None
        try:
            return json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def set(self, key: str, value: Any) -> None:
        p = self._path(key)
        p.write_text(json.dumps(value, default=str))

    def clear(self) -> None:
        for p in self.cache_dir.glob("*.json"):
            p.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Cache TTLs (seconds)
# ---------------------------------------------------------------------------

TTL_PRODUCT = 3600          # 1 hour
TTL_DRIVERS = 3600 * 6      # 6 hours
TTL_WARRANTY = 3600 * 24    # 24 hours
TTL_SESSION = 1800          # 30 minutes

# ---------------------------------------------------------------------------
# Retry defaults
# ---------------------------------------------------------------------------

MAX_RETRIES = 3
RETRY_BACKOFF_FACTOR = 1  # 1s, 2s, 4s

# ---------------------------------------------------------------------------
# User-Agent
# ---------------------------------------------------------------------------

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"

# ---------------------------------------------------------------------------
# API base
# ---------------------------------------------------------------------------

BASE_URL = "https://pcsupport.lenovo.com/us/en/api/v4"


class SupportClient:
    """Client for Lenovo Support API endpoints."""

    def __init__(
        self,
        cache_dir: Path | None = None,
        timeout: float = 30,
        max_retries: int = MAX_RETRIES,
        retry_backoff_factor: float = RETRY_BACKOFF_FACTOR,
        no_cache: bool = False,
    ) -> None:
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_backoff_factor = retry_backoff_factor
        self.no_cache = no_cache
        self._cache = DiskCache(cache_dir)
        self._client = httpx.Client(
            timeout=timeout,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://pcsupport.lenovo.com/",
            },
            follow_redirects=True,
        )
        self._session_cookie: str | None = None
        self._session_cookie_ts: float = 0.0

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _request_with_retry(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        """Execute HTTP request with retry logic for 429/5xx/network errors."""
        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                resp = self._client.request(method, url, **kwargs)
                if resp.status_code == 429:
                    retry_after = float(resp.headers.get("Retry-After", 0))
                    wait = retry_after if retry_after > 0 else self.retry_backoff_factor * (2 ** attempt)
                    logger.warning("429 rate-limited, retrying in %.1fs (attempt %d)", wait, attempt + 1)
                    time.sleep(wait)
                    continue
                if resp.status_code >= 500:
                    wait = self.retry_backoff_factor * (2 ** attempt)
                    logger.warning("5xx error %d, retrying in %.1fs (attempt %d)", resp.status_code, wait, attempt + 1)
                    time.sleep(wait)
                    continue
                return resp
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_exc = exc
                wait = self.retry_backoff_factor * (2 ** attempt)
                logger.warning("Network error, retrying in %.1fs (attempt %d): %s", wait, attempt + 1, exc)
                time.sleep(wait)
        raise last_exc or httpx.TransportError("Max retries exceeded")

    def _cached_get(self, cache_key: str, url: str, ttl: float, params: dict | None = None) -> Any:
        """GET with disk cache."""
        if not self.no_cache:
            cached = self._cache.get(cache_key, ttl)
            if cached is not None:
                logger.debug("Cache hit: %s", cache_key)
                return cached
        resp = self._request_with_retry("GET", url, params=params)
        resp.raise_for_status()
        data = resp.json()
        if not self.no_cache:
            self._cache.set(cache_key, data)
        return data

    # ------------------------------------------------------------------
    # Session cookie management
    # ------------------------------------------------------------------

    def _fetch_session_cookie(self) -> str:
        """Obtain Lenovo_SessionID cookie from pcsupport.lenovo.com."""
        # Check in-memory cache first
        if (
            self._session_cookie
            and (time.time() - self._session_cookie_ts) < TTL_SESSION
        ):
            return self._session_cookie

        resp = self._request_with_retry(
            "GET", "https://pcsupport.lenovo.com/us/en/warrantylookup"
        )
        cookie_header = resp.headers.get("set-cookie", "")
        match = re.search(r"Lenovo_SessionID=([^;]+)", cookie_header)
        if not match:
            # Also check response cookies
            for cookie in self._client.cookies.jar:
                if cookie.name == "Lenovo_SessionID":
                    self._session_cookie = cookie.value
                    self._session_cookie_ts = time.time()
                    return self._session_cookie
            raise RuntimeError("Could not obtain Lenovo_SessionID cookie")

        self._session_cookie = match.group(1)
        self._session_cookie_ts = time.time()
        logger.debug("Obtained session cookie (len=%d)", len(self._session_cookie))
        return self._session_cookie

    # ------------------------------------------------------------------
    # Public API methods
    # ------------------------------------------------------------------

    def lookup_product(self, identifier: str) -> list[dict]:
        """Look up products by serial number or MTM prefix.

        GET /us/en/api/v4/mse/getproducts?productId={identifier}
        """
        cache_key = f"product:{identifier}"
        url = f"{BASE_URL}/mse/getproducts"
        return self._cached_get(cache_key, url, TTL_PRODUCT, params={"productId": identifier})

    def get_drivers(self, product_path: str) -> dict:
        """Retrieve driver listing for a product.

        GET /us/en/api/v4/downloads/drivers?productId={product_path}

        product_path is the Id field from lookup_product, e.g.
        LAPTOPS-AND-NETBOOKS/THINKPAD-T-SERIES-LAPTOPS/.../PF4SQLH9
        """
        cache_key = f"drivers:{product_path}"
        url = f"{BASE_URL}/downloads/drivers"
        return self._cached_get(cache_key, url, TTL_DRIVERS, params={"productId": product_path})

    def get_warranty(
        self,
        serial: str,
        machine_type: str,
        country: str = "us",
        language: str = "en",
    ) -> dict:
        """Retrieve warranty info for a device.

        POST /us/en/api/v4/upsell/redport/getIbaseInfo

        Requires Lenovo_SessionID cookie. If auth fails (code 100),
        re-fetch cookie and retry once.
        """
        cache_key = f"warranty:{serial}:{machine_type}:{country}:{language}"
        if not self.no_cache:
            cached = self._cache.get(cache_key, TTL_WARRANTY)
            if cached is not None:
                return cached

        body = {
            "serialNumber": serial,
            "machineType": machine_type,
            "country": country,
            "language": language,
        }

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://pcsupport.lenovo.com",
            "Referer": "https://pcsupport.lenovo.com/us/en/warrantylookup",
        }

        for attempt in range(2):
            session_id = self._fetch_session_cookie()
            headers["Cookie"] = f"Lenovo_SessionID={session_id}"

            resp = self._request_with_retry(
                "POST",
                f"{BASE_URL}/upsell/redport/getIbaseInfo",
                json=body,
                headers=headers,
            )
            resp.raise_for_status()
            result = resp.json()

            if result.get("code") == 100:
                # Auth failure — invalidate cookie and retry
                logger.warning("Warranty auth failure (code 100), re-fetching session cookie")
                self._session_cookie = None
                self._session_cookie_ts = 0.0
                continue

            data = result.get("data", result)
            if not self.no_cache:
                self._cache.set(cache_key, data)
            return data

        raise RuntimeError("Warranty lookup failed after session cookie refresh")

    # ------------------------------------------------------------------
    # Utility methods
    # ------------------------------------------------------------------

    @staticmethod
    def extract_machine_type(product: dict) -> str:
        """Extract machine type from a product dict.

        Tries Name field first (e.g. "Type 21F9" → "21F9"),
        then falls back to extracting from the Id path.
        """
        name = product.get("Name", "")
        matches = re.findall(r"Type\s+(\w{4})", name)
        if matches:
            return matches[-1]

        # Fallback: extract from Id path
        product_id = product.get("Id", "")
        parts = product_id.rstrip("/").split("/")
        if parts:
            last = parts[-1]
            # If the last segment is a serial, try the segment before it
            if len(last) <= 10 and last.isalnum():
                # Try second-to-last for MTM-like pattern
                for part in reversed(parts):
                    if re.match(r"^\w{4}$", part):
                        return part

        return ""

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> SupportClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
