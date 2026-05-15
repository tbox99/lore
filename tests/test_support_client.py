"""Tests for SupportClient."""

from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from lore.support_client import (
    DiskCache,
    SupportClient,
    TTL_PRODUCT,
    TTL_DRIVERS,
    TTL_WARRANTY,
    BASE_URL,
)

# ---------------------------------------------------------------------------
# Fixtures from conftest
# ---------------------------------------------------------------------------

from conftest import (
    SAMPLE_PRODUCT_RESPONSE,
    SAMPLE_DRIVER_RESPONSE,
    SAMPLE_WARRANTY_SUCCESS,
    SAMPLE_WARRANTY_AUTH_FAIL,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_response(status_code: int = 200, json_data=None, headers=None):
    """Create a mock httpx.Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.headers = httpx.Headers(headers or {})
    if json_data is not None:
        resp.json.return_value = json_data
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            message=f"HTTP {status_code}",
            request=MagicMock(),
            response=resp,
        )
    return resp


# ---------------------------------------------------------------------------
# Product lookup tests
# ---------------------------------------------------------------------------

class TestLookupProduct:
    def test_returns_product_list(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)
        mock_resp = _mock_response(json_data=SAMPLE_PRODUCT_RESPONSE)

        with patch.object(client, "_request_with_retry", return_value=mock_resp):
            result = client.lookup_product("PF4SQLH9")

        assert len(result) == 1
        assert result[0]["Serial"] == "PF4SQLH9"
        assert result[0]["Brand"] == "TPG"
        assert result[0]["IsSupported"] is True
        client.close()

    def test_caches_result(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path)
        mock_resp = _mock_response(json_data=SAMPLE_PRODUCT_RESPONSE)

        with patch.object(client, "_request_with_retry", return_value=mock_resp) as mock_req:
            # First call
            result1 = client.lookup_product("PF4SQLH9")
            assert mock_req.call_count == 1

            # Second call should hit cache
            result2 = client.lookup_product("PF4SQLH9")
            assert mock_req.call_count == 1  # No additional call

            assert result1 == result2

        client.close()

    def test_uses_correct_url(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)
        mock_resp = _mock_response(json_data=SAMPLE_PRODUCT_RESPONSE)

        with patch.object(client, "_request_with_retry", return_value=mock_resp) as mock_req:
            client.lookup_product("PF4SQLH9")
            mock_req.assert_called_once_with(
                "GET",
                f"{BASE_URL}/mse/getproducts",
                params={"productId": "PF4SQLH9"},
            )
        client.close()


# ---------------------------------------------------------------------------
# Driver listing tests
# ---------------------------------------------------------------------------

class TestGetDrivers:
    def test_returns_driver_data(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)
        mock_resp = _mock_response(json_data=SAMPLE_DRIVER_RESPONSE)

        product_path = SAMPLE_PRODUCT_RESPONSE[0]["Id"]
        with patch.object(client, "_request_with_retry", return_value=mock_resp):
            result = client.get_drivers(product_path)

        assert "body" in result
        body = result["body"]
        assert len(body["DownloadItems"]) == 3
        assert body["AllCategories"][0] == "Audio"
        client.close()

    def test_uses_product_path_as_param(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)
        mock_resp = _mock_response(json_data=SAMPLE_DRIVER_RESPONSE)

        product_path = "LAPTOPS-AND-NETBOOKS/THINKPAD/PF4SQLH9"
        with patch.object(client, "_request_with_retry", return_value=mock_resp) as mock_req:
            client.get_drivers(product_path)
            mock_req.assert_called_once_with(
                "GET",
                f"{BASE_URL}/downloads/drivers",
                params={"productId": product_path},
            )
        client.close()


# ---------------------------------------------------------------------------
# Warranty tests
# ---------------------------------------------------------------------------

class TestGetWarranty:
    def test_returns_warranty_data(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)

        # Mock session cookie
        client._session_cookie = "fake-session-id"
        client._session_cookie_ts = time.time()

        mock_resp = _mock_response(json_data=SAMPLE_WARRANTY_SUCCESS)

        with patch.object(client, "_request_with_retry", return_value=mock_resp):
            result = client.get_warranty("PF4SQLH9", "21F9")

        assert "machineInfo" in result
        assert result["machineInfo"]["serial"] == "PF4SQLH9"
        assert result["warrantyStatus"] == "In warranty"
        assert result["oow"] is False
        client.close()

    def test_retries_on_auth_failure(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)

        # First request: auth failure
        auth_fail_resp = _mock_response(json_data=SAMPLE_WARRANTY_AUTH_FAIL)
        # Second request: success (after cookie refresh)
        success_resp = _mock_response(json_data=SAMPLE_WARRANTY_SUCCESS)

        with patch.object(client, "_request_with_retry", side_effect=[auth_fail_resp, success_resp]):
            with patch.object(client, "_fetch_session_cookie", return_value="new-session-id") as mock_cookie:
                # Pre-set a stale cookie
                client._session_cookie = "stale-session-id"
                client._session_cookie_ts = time.time()

                result = client.get_warranty("PF4SQLH9", "21F9")

        assert "machineInfo" in result
        # Cookie should have been invalidated
        assert client._session_cookie is None  # Invalidated before retry
        client.close()

    def test_uses_post_with_body(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)
        client._session_cookie = "test-session"
        client._session_cookie_ts = time.time()

        mock_resp = _mock_response(json_data=SAMPLE_WARRANTY_SUCCESS)

        with patch.object(client, "_request_with_retry", return_value=mock_resp) as mock_req:
            client.get_warranty("PF4SQLH9", "21F9", country="de", language="de")

            call_kwargs = mock_req.call_args
            assert call_kwargs[0][0] == "POST"
            assert call_kwargs[0][1] == f"{BASE_URL}/upsell/redport/getIbaseInfo"
            body = call_kwargs[1]["json"]
            assert body["serialNumber"] == "PF4SQLH9"
            assert body["machineType"] == "21F9"
            assert body["country"] == "de"
            assert body["language"] == "de"
        client.close()


# ---------------------------------------------------------------------------
# Machine type extraction tests
# ---------------------------------------------------------------------------

class TestExtractMachineType:
    def test_extracts_from_name_field(self):
        product = {"Name": "T14s Gen 4 (Type 21F8, 21F9) Laptop (ThinkPad) - Type 21F9"}
        assert SupportClient.extract_machine_type(product) == "21F9"

    def test_extracts_first_type_from_name(self):
        # When multiple types listed, last "Type XX" wins (closest match)
        product = {"Name": "T14s Gen 4 (Type 21F8, 21F9) Laptop (ThinkPad) - Type 21F9"}
        result = SupportClient.extract_machine_type(product)
        # The regex finds the last match: "Type 21F9"
        assert result == "21F9"

    def test_fallback_to_id_path(self):
        product = {
            "Name": "Some Device",
            "Id": "LAPTOPS-AND-NETBOOKS/THINKPAD/21F9/PF4SQLH9",
        }
        result = SupportClient.extract_machine_type(product)
        assert result == "21F9"

    def test_empty_on_failure(self):
        product = {"Name": "Unknown Device", "Id": ""}
        assert SupportClient.extract_machine_type(product) == ""


# ---------------------------------------------------------------------------
# Retry logic tests
# ---------------------------------------------------------------------------

class TestRetryLogic:
    def test_retries_on_500(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)
        client.max_retries = 2

        fail_resp = _mock_response(status_code=500)
        success_resp = _mock_response(status_code=200, json_data={"ok": True})

        with patch.object(client._client, "request", side_effect=[fail_resp, success_resp]):
            with patch("lore.support_client.time.sleep"):
                result = client._request_with_retry("GET", "http://test")

        assert result.status_code == 200
        client.close()

    def test_retries_on_429(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)
        client.max_retries = 2

        rate_limit_resp = _mock_response(
            status_code=429,
            headers={"Retry-After": "1"},
        )
        success_resp = _mock_response(status_code=200, json_data={"ok": True})

        with patch.object(client._client, "request", side_effect=[rate_limit_resp, success_resp]):
            with patch("lore.support_client.time.sleep") as mock_sleep:
                result = client._request_with_retry("GET", "http://test")

        assert result.status_code == 200
        mock_sleep.assert_called()
        client.close()

    def test_raises_after_max_retries(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)
        client.max_retries = 1

        with patch.object(
            client._client,
            "request",
            side_effect=httpx.TransportError("connection failed"),
        ):
            with patch("lore.support_client.time.sleep"):
                with pytest.raises(httpx.TransportError):
                    client._request_with_retry("GET", "http://test")
        client.close()


# ---------------------------------------------------------------------------
# Caching behavior tests
# ---------------------------------------------------------------------------

class TestDiskCache:
    def test_set_and_get(self, tmp_path):
        cache = DiskCache(tmp_path / "cache")
        cache.set("test_key", {"data": 42})
        result = cache.get("test_key", ttl=3600)
        assert result == {"data": 42}

    def test_expired_returns_none(self, tmp_path):
        cache = DiskCache(tmp_path / "cache")
        cache.set("test_key", {"data": 42})
        # Set TTL to 0 to force expiry
        result = cache.get("test_key", ttl=0)
        assert result is None

    def test_missing_key_returns_none(self, tmp_path):
        cache = DiskCache(tmp_path / "cache")
        result = cache.get("nonexistent", ttl=3600)
        assert result is None

    def test_clear_removes_all(self, tmp_path):
        cache = DiskCache(tmp_path / "cache")
        cache.set("key1", "a")
        cache.set("key2", "b")
        cache.clear()
        assert cache.get("key1", ttl=3600) is None
        assert cache.get("key2", ttl=3600) is None

    def test_no_cache_bypasses(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)
        mock_resp = _mock_response(json_data=SAMPLE_PRODUCT_RESPONSE)

        with patch.object(client, "_request_with_retry", return_value=mock_resp) as mock_req:
            client.lookup_product("PF4SQLH9")
            client.lookup_product("PF4SQLH9")
            # Both calls should hit the network since no_cache=True
            assert mock_req.call_count == 2
        client.close()


# ---------------------------------------------------------------------------
# Session cookie tests
# ---------------------------------------------------------------------------

class TestSessionCookie:
    def test_fetches_session_cookie(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)

        cookie_resp = _mock_response(
            status_code=200,
            headers={"set-cookie": "Lenovo_SessionID=abc123def; Path=/; HttpOnly"},
        )

        with patch.object(client, "_request_with_retry", return_value=cookie_resp):
            cookie = client._fetch_session_cookie()

        assert cookie == "abc123def"
        client.close()

    def test_caches_session_cookie(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)

        cookie_resp = _mock_response(
            status_code=200,
            headers={"set-cookie": "Lenovo_SessionID=cached123; Path=/; HttpOnly"},
        )

        with patch.object(client, "_request_with_retry", return_value=cookie_resp) as mock_req:
            cookie1 = client._fetch_session_cookie()
            cookie2 = client._fetch_session_cookie()
            # Only one network call since cookie is cached in memory
            assert mock_req.call_count == 1
        assert cookie1 == cookie2
        client.close()

    def test_raises_when_no_cookie(self, tmp_path):
        client = SupportClient(cache_dir=tmp_path, no_cache=True)

        cookie_resp = _mock_response(status_code=200, headers={})

        with patch.object(client, "_request_with_retry", return_value=cookie_resp):
            with pytest.raises(RuntimeError, match="Could not obtain Lenovo_SessionID"):
                client._fetch_session_cookie()
        client.close()
