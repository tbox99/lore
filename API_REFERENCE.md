# LORE — API Reference

Internal documentation of discovered Lenovo Support API endpoints.

## Base URL

`https://pcsupport.lenovo.com/us/en/api/v4/`

Note: The locale path (`/us/en/`) is required. Other locales work (e.g., `/de/de/`).

---

## Product Lookup

**Endpoint:** `GET /us/en/api/v4/mse/getproducts?productId={identifier}`

**Parameters:**
- `productId` — Serial number (e.g., `PF4SQLH9`) or MTM prefix (e.g., `21F9`)

**Response:** JSON array of product objects:

```json
[{
  "Id": "LAPTOPS-AND-NETBOOKS/.../PF4SQLH9",
  "Guid": "",
  "Brand": "TPG",
  "Name": "T14s Gen 4 (Type 21F8, 21F9) Laptop (ThinkPad) - Type 21F9",
  "Serial": "PF4SQLH9",
  "Type": "Product.Serial",
  "ParentID": ["guid1", "guid2", ...],
  "Image": "https://download.lenovo.com/images/ProdImageLaptops/tp_t14s.jpg",
  "IsSupported": true
}]
```

**Notes:**
- `Type` is `"Product.Serial"` for serial lookups, `"Product.MachineType"` for MTM prefix
- `Id` is the full product path needed for driver listing
- `ParentID` contains GUIDs for the product hierarchy
- No authentication required

---

## Driver Listing

**Endpoint:** `GET /us/en/api/v4/downloads/drivers?productId={productPath}`

**Parameters:**
- `productId` — Full product path from product lookup `Id` field

**Response:** JSON object:

```json
{
  "message": "succeed",
  "body": {
    "AllCategories": ["Audio", "BIOS/UEFI", ...],
    "AllOperatingSystems": [],
    "AllPriorities": ["Recommended", "Critical"],
    "DownloadItems": [...],
    "ProductId": "guid",
    "RestrictCountryList": []
  }
}
```

**DownloadItem structure:**
```json
{
  "Title": "Realtek Audio Driver ...",
  "DocId": "DS5XXXXX",
  "OperatingSystemKeys": ["Windows 11 (64-bit)", "Windows 10 (64-bit)"],
  "Category": {"Name": "Audio", "Classify": "dl-category-audio", "ID": "guid"},
  "Files": [{
    "Name": "Realtek Audio Driver",
    "TypeString": "EXE",
    "Version": "6.0.9847.1",
    "URL": "https://download.lenovo.com/pccbbs/mobiles/xxx.exe",
    "Size": "X MB",
    "SHA1": "...",
    "SHA256": "...",
    "MD5": "...",
    "Priority": "Critical",
    "PriorityWeight": 3
  }],
  "Summary": "...",
  "InWarranty": false,
  "RequireLogin": false,
  "Countries": ["de", "us", ...],
  "RebootRequired": 0
}
```

**Notes:**
- Some items have `RequireLogin: true` (service provider only)
- `Countries` can be empty (global) or list ISO country codes
- `Priority` is "Recommended" (weight 2) or "Critical" (weight 3)
- No authentication required

---

## Warranty Info

**Endpoint:** `POST /us/en/api/v4/upsell/redport/getIbaseInfo`

**Headers:**
- `Content-Type: application/json`
- `Accept: application/json, text/plain, */*`
- `Origin: https://pcsupport.lenovo.com`
- `Referer: https://pcsupport.lenovo.com/us/en/warrantylookup`
- `Cookie: Lenovo_SessionID={session_id}`

**Request Body:**
```json
{
  "serialNumber": "PF4SQLH9",
  "machineType": "21F9",
  "country": "de",
  "language": "de"
}
```

**Response (success):**
```json
{
  "code": 0,
  "data": {
    "machineInfo": {
      "serial": "PF4SQLH9",
      "product": "21F9S05T00",
      "productName": "T14s Gen 4 ...",
      "type": "21F9",
      "buildDate": "2024-01-08",
      "shipDate": "2024-01-10",
      "popDate": "2024-04-05",
      "shipToCountry": "DE",
      "specification": "<table>...</table>",
      "eosDate": "2030-02-25",
      "baseStartDate": "2024-04-05"
    },
    "baseWarranties": [...],
    "upgradeWarranties": [...],
    "currentWarranty": {...},
    "warrantyStatus": "In warranty",
    "oow": false
  }
}
```

**Response (auth failure):**
```json
{
  "code": 100,
  "msg": {"desc": "Call sde api: No authorization to access Ibase."}
}
```

**Session Cookie Acquisition:**
1. `GET https://pcsupport.lenovo.com/us/en/warrantylookup`
2. Extract `Set-Cookie: Lenovo_SessionID={id}` from response headers
3. Use cookie in warranty POST request

**Notes:**
- GET requests to this endpoint return code 101 ("Request method 'GET' is not supported")
- Without session cookie, returns code 100 ("No authorization")
- Cookie appears to be issued freely (no login required)
- `machineType` can be extracted from the product lookup `Name` field (e.g., "Type 21F9")

---

## SCCM Recipe Cards (Enterprise)

**Endpoint:** `GET https://download.lenovo.com/cdrt/ddrc/recipecard.json`

Returns RecipeCards mapping modelId → osId → sccmPackId + BIOS URLs. Useful for enterprise deployment scenarios.