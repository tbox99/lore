"""Shared fixtures for LORE tests."""

from __future__ import annotations

import json
import pytest
import httpx

# ---------------------------------------------------------------------------
# Sample data based on real API responses
# ---------------------------------------------------------------------------

SAMPLE_PRODUCT_RESPONSE = [
    {
        "Id": "LAPTOPS-AND-NETBOOKS/THINKPAD-T-SERIES-LAPTOPS/THINKPAD-T14-SERIES-LAPTOPS/THINKPAD-T14S-GEN-4/21F9/PF4SQLH9",
        "Guid": "guid-abc123",
        "Brand": "TPG",
        "Name": "T14s Gen 4 (Type 21F8, 21F9) Laptop (ThinkPad) - Type 21F9",
        "Serial": "PF4SQLH9",
        "Type": "Product.Serial",
        "ParentID": ["guid-parent1", "guid-parent2"],
        "Image": "https://download.lenovo.com/images/ProdImageLaptops/tp_t14s.jpg",
        "IsSupported": True,
    }
]

SAMPLE_DRIVER_RESPONSE = {
    "message": "succeed",
    "body": {
        "AllCategories": ["Audio", "BIOS/UEFI", "Display and Video Graphics"],
        "AllOperatingSystems": [],
        "AllPriorities": ["Recommended", "Critical"],
        "DownloadItems": [
            {
                "Title": "Realtek Audio Driver for Windows 11 (64-bit), Windows 10 (64-bit) - ThinkPad",
                "DocId": "DS543210",
                "Date": {"Unix": 1704067200000, "Human": "2024-01-01"},
                "Updated": {"Unix": 1711929600000, "Human": "2024-04-01"},
                "OperatingSystemKeys": ["Windows 11 (64-bit)", "Windows 10 (64-bit)"],
                "Category": {
                    "Name": "Audio",
                    "Classify": "dl-category-audio",
                    "ID": "guid-cat-audio",
                },
                "Files": [
                    {
                        "Name": "Realtek Audio Driver",
                        "TypeString": "EXE",
                        "Version": "6.0.9847.1",
                        "URL": "https://download.lenovo.com/pccbbs/mobiles/rtaudio.exe",
                        "Size": "318 MB",
                        "SHA1": "abc123",
                        "SHA256": "def456",
                        "MD5": "789012",
                        "Priority": "Critical",
                        "PriorityWeight": 3,
                    }
                ],
                "Summary": "This package installs the Realtek Audio driver",
                "InWarranty": False,
                "RequireLogin": False,
                "Countries": [],
                "RebootRequired": 0,
            },
            {
                "Title": "NVIDIA GeForce Graphics Driver for Windows 11 (64-bit) - ThinkPad",
                "DocId": "DS543211",
                "Date": {"Unix": 1706745600000, "Human": "2024-02-01"},
                "Updated": {"Unix": 1709337600000, "Human": "2024-03-02"},
                "OperatingSystemKeys": ["Windows 11 (64-bit)"],
                "Category": {
                    "Name": "Display and Video Graphics",
                    "Classify": "dl-category-display",
                    "ID": "guid-cat-display",
                },
                "Files": [
                    {
                        "Name": "NVIDIA GeForce Graphics Driver",
                        "TypeString": "EXE",
                        "Version": "31.0.15.4601",
                        "URL": "https://download.lenovo.com/pccbbs/mobiles/nvidia.exe",
                        "Size": "590 MB",
                        "SHA1": "sha1nv",
                        "SHA256": "sha256nv",
                        "MD5": "md5nv",
                        "Priority": "Recommended",
                        "PriorityWeight": 2,
                    }
                ],
                "Summary": "This package installs the NVIDIA display driver",
                "InWarranty": False,
                "RequireLogin": False,
                "Countries": ["de", "us"],
                "RebootRequired": 1,
            },
            {
                "Title": "Service Provider Only - System Update",
                "DocId": "DS543299",
                "Date": {"Unix": 1693526400000, "Human": "2023-09-01"},
                "Updated": {"Unix": 1696118400000, "Human": "2023-10-01"},
                "OperatingSystemKeys": ["Windows 11 (64-bit)"],
                "Category": {
                    "Name": "Software and Utilities",
                    "Classify": "dl-category-software",
                    "ID": "guid-cat-sw",
                },
                "Files": [
                    {
                        "Name": "System Update",
                        "TypeString": "EXE",
                        "Version": "5.0.1",
                        "URL": "https://download.lenovo.com/pccbbs/mobiles/su.exe",
                        "Size": "10 MB",
                        "Priority": "Recommended",
                        "PriorityWeight": 2,
                    }
                ],
                "Summary": "Service provider only",
                "InWarranty": True,
                "RequireLogin": True,
                "Countries": [],
                "RebootRequired": 0,
            },
        ],
        "ProductId": "guid-abc123",
        "RestrictCountryList": [],
    },
}

SAMPLE_WARRANTY_SUCCESS = {
    "code": 0,
    "data": {
        "machineInfo": {
            "serial": "PF4SQLH9",
            "product": "21F9S05T00",
            "productName": "T14s Gen 4 (Type 21F8, 21F9) Laptop (ThinkPad) - Type 21F9",
            "type": "21F9",
            "buildDate": "2024-01-08",
            "shipDate": "2024-01-10",
            "popDate": "2024-04-05",
            "shipToCountry": "DE",
            "specification": "<table>...</table>",
            "eosDate": "2030-02-25",
            "baseStartDate": "2024-04-05",
        },
        "baseWarranties": [
            {
                "type": "Base",
                "name": "ThinkPad T14s Gen 4 Warranty",
                "startDate": "2024-04-05",
                "endDate": "2027-04-04",
                "status": "In warranty",
            }
        ],
        "upgradeWarranties": [],
        "currentWarranty": {
            "startDate": "2024-04-05",
            "endDate": "2027-04-04",
        },
        "warrantyStatus": "In warranty",
        "oow": False,
    },
}

SAMPLE_WARRANTY_AUTH_FAIL = {
    "code": 100,
    "msg": {"desc": "Call sde api: No authorization to access Ibase."},
}


@pytest.fixture
def sample_product():
    return SAMPLE_PRODUCT_RESPONSE


@pytest.fixture
def sample_driver():
    return SAMPLE_DRIVER_RESPONSE


@pytest.fixture
def sample_warranty():
    return SAMPLE_WARRANTY_SUCCESS


@pytest.fixture
def sample_warranty_auth_fail():
    return SAMPLE_WARRANTY_AUTH_FAIL
