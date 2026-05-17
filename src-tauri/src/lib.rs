//! LORE — Tauri library entry point.

pub mod cache;
pub mod client;

use client::SupportClient;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Shared application state
// ---------------------------------------------------------------------------

struct AppState {
    client: Mutex<SupportClient>,
}

// ---------------------------------------------------------------------------
// Search result types (returned to frontend)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct ProductInfo {
    name: String,
    #[serde(rename = "type")]
    product_type: String,
    mtm: String,
    id: String,
    serial: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DriverEntry {
    title: String,
    #[serde(rename = "shortTitle")]
    short_title: String,
    #[serde(rename = "docId")]
    doc_id: String,
    summary: String,
    category: String,
    version: String,
    priority: String,
    url: String,
    size: String,
    sha256: String,
    released: String,
    updated: String,
    #[serde(rename = "requireLogin")]
    require_login: bool,
    #[serde(rename = "osKeys")]
    os_keys: Vec<String>,
    #[serde(rename = "readmeUrl")]
    readme_url: String,
    #[serde(rename = "releaseNotes")]
    release_notes: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DriversData {
    serial: String,
    product_name: String,
    drivers: Vec<DriverEntry>,
    categories: Vec<String>,
    #[serde(rename = "generatedAt")]
    generated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SearchResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    serial: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    product: Option<ProductInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    drivers: Option<DriversData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    warranty: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ReadmeResponse {
    success: bool,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn search(serial: String, state: State<'_, AppState>) -> Result<SearchResponse, String> {
    let serial = serial.trim().to_uppercase();
    if serial.is_empty() {
        return Ok(SearchResponse {
            success: false,
            error: Some("Please enter a serial number".into()),
            serial: None,
            product: None,
            drivers: None,
            warranty: None,
        });
    }

    let client = state.client.lock().await;

    // 1. Lookup product
    let products = client.lookup_product(&serial).await.map_err(|e| e.to_string())?;

    if products.is_empty() {
        return Ok(SearchResponse {
            success: false,
            error: Some(format!("No products found for serial: {}", serial)),
            serial: None,
            product: None,
            drivers: None,
            warranty: None,
        });
    }

    let product = &products[0];
    // Prefer the Mtm field (exact match for this specific device variant)
    // over extract_machine_type which may pick the first of multiple MTMs in the name.
    let mtm_val = product.get("Mtm").and_then(|v| v.as_str()).unwrap_or("");
    let product_type = if !mtm_val.is_empty() {
        mtm_val.to_string()
    } else {
        let raw_type = product.get("Type").and_then(|v| v.as_str()).unwrap_or("");
        if raw_type.is_empty()
            || raw_type == "Product.Serial"
            || raw_type == "Product"
            || raw_type == "Product.MachineType"
        {
            SupportClient::extract_machine_type(product)
        } else {
            raw_type.to_string()
        }
    };

    let product_info = ProductInfo {
        name: product.get("Name").and_then(|v| v.as_str()).unwrap_or("Unknown").into(),
        product_type,
        mtm: product.get("Mtm").and_then(|v| v.as_str()).unwrap_or("").into(),
        id: product.get("Id").and_then(|v| v.as_str()).unwrap_or("").into(),
        serial: product.get("Serial").and_then(|v| v.as_str()).unwrap_or("").into(),
    };

    // 2. Fetch drivers
    let driver_data = if !product_info.id.is_empty() {
        client.get_drivers(&product_info.id).await.ok()
    } else {
        None
    };

    // 3. Fetch warranty
    let machine_type = SupportClient::extract_machine_type(product);
    let warranty_data = if !machine_type.is_empty() {
        client.get_warranty(&serial, &machine_type).await.ok()
    } else {
        None
    };

    // 4. Prepare drivers data for frontend
    let drivers_data = if let Some(ref dd) = driver_data {
        prepare_drivers_data(dd, &product_info.name, &serial)
    } else {
        DriversData {
            serial: serial.clone(),
            product_name: product_info.name.clone(),
            drivers: vec![],
            categories: vec![],
            generated_at: chrono::Utc::now().format("%Y-%m-%d %H:%M UTC").to_string(),
        }
    };

    Ok(SearchResponse {
        success: true,
        error: None,
        serial: Some(serial),
        product: Some(product_info),
        drivers: Some(drivers_data),
        warranty: warranty_data,
    })
}

#[derive(Debug, Serialize, Deserialize)]
struct ProductMatch {
    name: String,
    mtm: String,
    id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BrowseItem {
    id: String,
    name: String,
    #[serde(rename = "type")]
    product_type: String,
    image: String,
}

#[tauri::command]
async fn search_products(query: String, state: State<'_, AppState>) -> Result<Vec<ProductMatch>, String> {
    let query = query.trim().to_uppercase();
    if query.is_empty() {
        return Ok(vec![]);
    }

    let client = state.client.lock().await;
    let products = client.lookup_product(&query).await.map_err(|e| e.to_string())?;

    let matches: Vec<ProductMatch> = products
        .iter()
        .map(|p| ProductMatch {
            name: p.get("Name").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
            mtm: p.get("Mtm").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            id: p.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        })
        .collect();

    Ok(matches)
}

#[tauri::command]
async fn browse_products(product_id: String, state: State<'_, AppState>) -> Result<Vec<BrowseItem>, String> {
    let client = state.client.lock().await;
    let products = client.lookup_product(&product_id).await.map_err(|e| e.to_string())?;

    let items: Vec<BrowseItem> = products
        .iter()
        .filter(|p| {
            let t = p.get("Type").and_then(|v| v.as_str()).unwrap_or("");
            t == "Product.Series"
                || t == "Product.SubSeries"
                || t == "Product.MachineType"
                || t == "Product.Model"
        })
        .map(|p| BrowseItem {
            id: p.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            name: p.get("Name").and_then(|v| v.as_str()).unwrap_or("Unknown").to_string(),
            product_type: p.get("Type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            image: p.get("Image").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        })
        .collect();

    Ok(items)
}

#[tauri::command]
async fn fetch_readme(url: String, state: State<'_, AppState>) -> Result<ReadmeResponse, String> {
    let client = state.client.lock().await;
    let changes = client.fetch_readme_changes(&url).await.unwrap_or_default();
    Ok(ReadmeResponse {
        success: true,
        content: changes,
        error: None,
    })
}

#[tauri::command]
async fn clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    let client = state.client.lock().await;
    client.clear_cache().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Data preparation (port of Python _prepare_webview_data)
// ---------------------------------------------------------------------------

fn prepare_drivers_data(
    driver_data: &serde_json::Value,
    product_name: &str,
    serial: &str,
) -> DriversData {
    let body = driver_data
        .get("body")
        .unwrap_or(driver_data);
    let items = body
        .get("DownloadItems")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut drivers = Vec::new();
    let mut categories_set = std::collections::BTreeSet::new();

    for item in &items {
        let files = item.get("Files").and_then(|v| v.as_array());
        let first_file = files.and_then(|f| f.first());

        let date_unix = item
            .get("Date")
            .and_then(|d| d.get("Unix"))
            .and_then(|v| v.as_i64());
        let updated_unix = item
            .get("Updated")
            .and_then(|d| d.get("Unix"))
            .and_then(|v| v.as_i64());

        let title = item.get("Title").and_then(|v| v.as_str()).unwrap_or("N/A").to_string();
        let category = item
            .get("Category")
            .and_then(|c| c.get("Name"))
            .and_then(|v| v.as_str())
            .unwrap_or("Uncategorized")
            .to_string();
        categories_set.insert(category.clone());

        let short_title = short_title(&title);

        drivers.push(DriverEntry {
            title: title.clone(),
            short_title,
            doc_id: item.get("DocId").and_then(|v| v.as_str()).unwrap_or("N/A").into(),
            summary: item.get("Summary").and_then(|v| v.as_str()).unwrap_or("").into(),
            category,
            version: first_file
                .and_then(|f| f.get("Version"))
                .and_then(|v| v.as_str())
                .unwrap_or("N/A")
                .into(),
            priority: extract_priority(item, first_file),
            url: first_file
                .and_then(|f| f.get("URL"))
                .and_then(|v| v.as_str())
                .unwrap_or("N/A")
                .into(),
            size: first_file
                .and_then(|f| f.get("Size"))
                .and_then(|v| v.as_str())
                .unwrap_or("N/A")
                .into(),
            sha256: first_file
                .and_then(|f| f.get("SHA256"))
                .and_then(|v| v.as_str())
                .unwrap_or("N/A")
                .into(),
            released: epoch_ms_to_date(date_unix),
            updated: epoch_ms_to_date(updated_unix),
            require_login: item.get("RequireLogin").and_then(|v| v.as_bool()).unwrap_or(false),
            os_keys: item
                .get("OperatingSystemKeys")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            readme_url: first_file
                .and_then(|f| f.get("URL"))
                .and_then(|v| v.as_str())
                .map(|url| build_readme_url(url))
                .unwrap_or_default(),
            release_notes: String::new(),
        });
    }

    let categories: Vec<String> = categories_set.into_iter().collect();

    DriversData {
        serial: serial.into(),
        product_name: product_name.into(),
        drivers,
        categories,
        generated_at: chrono::Utc::now().format("%Y-%m-%d %H:%M UTC").to_string(),
    }
}

/// Shorten a Lenovo driver title (port of Python _short_title)
fn short_title(title: &str) -> String {
    if let Ok(re) = regex::Regex::new(r"(?i)\s+for\s+Windows") {
        if let Some(m) = re.find(title) {
            let result = &title[..m.start()];
            return result.trim_end_matches(|c| c == ' ' || c == '-').to_string();
        }
    }
    if let Ok(re) = regex::Regex::new(r"\s+-\s+") {
        if let Some(m) = re.find(title) {
            let result = &title[..m.start()];
            return result.trim_end_matches(|c| c == ' ' || c == '-').to_string();
        }
    }
    title.trim_end_matches(|c| c == ' ' || c == '-').to_string()
}

fn extract_priority(item: &Value, first_file: Option<&Value>) -> String {
    let priority = item
        .get("Priority")
        .and_then(|v| v.as_str())
        .or_else(|| first_file.and_then(|f| f.get("Priority")).and_then(|v| v.as_str()))
        .map(normalize_priority);

    if let Some(p) = priority {
        return p;
    }

    let weight = item
        .get("PriorityWeight")
        .and_then(|v| v.as_i64())
        .or_else(|| first_file.and_then(|f| f.get("PriorityWeight")).and_then(|v| v.as_i64()));

    match weight {
        Some(w) if w >= 3 => "Critical".to_string(),
        Some(w) if w >= 2 => "Recommended".to_string(),
        _ => "Optional".to_string(),
    }
}

fn normalize_priority(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "critical" => "Critical".to_string(),
        "recommended" => "Recommended".to_string(),
        "optional" => "Optional".to_string(),
        "n/a" | "na" | "" => "Optional".to_string(),
        other if other.contains("critical") => "Critical".to_string(),
        other if other.contains("recommend") => "Recommended".to_string(),
        _ => "Optional".to_string(),
    }
}

/// Convert epoch milliseconds to YYYY-MM-DD string
fn epoch_ms_to_date(epoch_ms: Option<i64>) -> String {
    match epoch_ms {
        Some(ms) => {
            chrono::DateTime::from_timestamp_millis(ms)
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_else(|| "N/A".into())
        }
        None => "N/A".into(),
    }
}

/// Build readme HTML URL from download URL
fn build_readme_url(download_url: &str) -> String {
    if download_url.is_empty() || download_url == "N/A" {
        return String::new();
    }
    let base = download_url.split('?').next().unwrap_or(download_url);
    let last_slash = base.rfind('/').unwrap_or(0);
    let filename = &base[last_slash + 1..];
    if let Some(dot_pos) = filename.rfind('.') {
        let base_no_ext = &filename[..dot_pos];
        format!("{}/{}.html", &base[..=last_slash], base_no_ext)
    } else {
        format!("{}.html", base)
    }
}

// ---------------------------------------------------------------------------
// Main entry point (called by main.rs)
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Fix white screen / crash on Linux with NVIDIA EGL + WebKitGTK:
    // These MUST be set before GTK/WebKit init.
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    if std::env::var("GDK_BACKEND").is_err() {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    env_logger::init();
    let client = SupportClient::new();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            client: Mutex::new(client),
        })
        .invoke_handler(tauri::generate_handler![search, search_products, browse_products, fetch_readme, clear_cache])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
