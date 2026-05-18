//! LORE — Tauri library entry point.

pub mod cache;
pub mod client;

use client::SupportClient;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

// ---------------------------------------------------------------------------
// Shared application state
// ---------------------------------------------------------------------------

struct AppState {
    client: SupportClient,
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

    // 1. Lookup product
    let products = state
        .client
        .lookup_product(&serial)
        .await
        .map_err(|e| e.to_string())?;

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
        name: product
            .get("Name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .into(),
        product_type,
        mtm: product
            .get("Mtm")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .into(),
        id: product
            .get("Id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .into(),
        serial: product
            .get("Serial")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .into(),
    };

    // 2. Fetch drivers
    let driver_data = if !product_info.id.is_empty() {
        state.client.get_drivers(&product_info.id).await.ok()
    } else {
        None
    };

    // 3. Fetch warranty
    let machine_type = SupportClient::extract_machine_type(product);
    let warranty_data = if !machine_type.is_empty() {
        state.client.get_warranty(&serial, &machine_type).await.ok()
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
async fn search_products(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProductMatch>, String> {
    let query = query.trim().to_uppercase();
    if query.is_empty() {
        return Ok(vec![]);
    }

    let products = state
        .client
        .lookup_product(&query)
        .await
        .map_err(|e| e.to_string())?;

    let matches: Vec<ProductMatch> = products
        .iter()
        .map(|p| ProductMatch {
            name: p
                .get("Name")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string(),
            mtm: p
                .get("Mtm")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            id: p
                .get("Id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .collect();

    Ok(matches)
}

#[tauri::command]
async fn browse_products(
    product_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<BrowseItem>, String> {
    let products = state
        .client
        .lookup_product(&product_id)
        .await
        .map_err(|e| e.to_string())?;

    let items: Vec<BrowseItem> = products
        .iter()
        .filter(|p| {
            let t = p.get("Type").and_then(|v| v.as_str()).unwrap_or("");
            let has_identity = !p
                .get("Id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .is_empty()
                && !p
                    .get("Name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .is_empty();
            has_identity
                && (t.is_empty()
                    || t == "Product.Series"
                    || t == "Product.SubSeries"
                    || t == "Product.MachineType"
                    || t == "Product.Model")
        })
        .map(|p| BrowseItem {
            id: p
                .get("Id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            name: p
                .get("Name")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string(),
            product_type: p
                .get("Type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            image: p
                .get("Image")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .collect();

    Ok(items)
}

#[tauri::command]
async fn fetch_readme(url: String, state: State<'_, AppState>) -> Result<ReadmeResponse, String> {
    if !is_allowed_readme_url(&url) {
        return Ok(ReadmeResponse {
            success: false,
            content: String::new(),
            error: Some("Readme URL host is not allowed".into()),
        });
    }

    let changes = state
        .client
        .fetch_readme_changes(&url)
        .await
        .unwrap_or_default();
    Ok(ReadmeResponse {
        success: true,
        content: changes,
        error: None,
    })
}

#[tauri::command]
async fn clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    state.client.clear_cache().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Data preparation (port of Python _prepare_webview_data)
// ---------------------------------------------------------------------------

fn prepare_drivers_data(
    driver_data: &serde_json::Value,
    product_name: &str,
    serial: &str,
) -> DriversData {
    let body = driver_data.get("body").unwrap_or(driver_data);
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

        let title = item
            .get("Title")
            .and_then(|v| v.as_str())
            .unwrap_or("N/A")
            .to_string();
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
            doc_id: item
                .get("DocId")
                .and_then(|v| v.as_str())
                .unwrap_or("N/A")
                .into(),
            summary: item
                .get("Summary")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
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
            require_login: item
                .get("RequireLogin")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            os_keys: extract_os_keys(item, files),
            readme_url: first_file
                .and_then(|f| f.get("URL"))
                .and_then(|v| v.as_str())
                .map(build_readme_url)
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
            return result.trim_end_matches([' ', '-']).to_string();
        }
    }
    if let Ok(re) = regex::Regex::new(r"\s+-\s+") {
        if let Some(m) = re.find(title) {
            let result = &title[..m.start()];
            return result.trim_end_matches([' ', '-']).to_string();
        }
    }
    title.trim_end_matches([' ', '-']).to_string()
}

fn extract_priority(item: &Value, first_file: Option<&Value>) -> String {
    let priority = item
        .get("Priority")
        .and_then(|v| v.as_str())
        .or_else(|| {
            first_file
                .and_then(|f| f.get("Priority"))
                .and_then(|v| v.as_str())
        })
        .map(normalize_priority);

    if let Some(p) = priority {
        return p;
    }

    let weight = item
        .get("PriorityWeight")
        .and_then(|v| v.as_i64())
        .or_else(|| {
            first_file
                .and_then(|f| f.get("PriorityWeight"))
                .and_then(|v| v.as_i64())
        });

    match weight {
        Some(w) if w >= 3 => "Critical".to_string(),
        Some(w) if w >= 2 => "Recommended".to_string(),
        _ => "Optional".to_string(),
    }
}

fn extract_os_keys(item: &Value, files: Option<&Vec<Value>>) -> Vec<String> {
    let mut keys = std::collections::BTreeSet::new();

    collect_string_array_field(item, "OperatingSystemKeys", &mut keys);

    if let Some(files) = files {
        for file in files {
            collect_string_array_field(file, "OperatingSystemKeys", &mut keys);
            collect_string_array_field(file, "OperatingSystems", &mut keys);
        }
    }

    keys.into_iter().collect()
}

fn collect_string_array_field(
    value: &Value,
    field: &str,
    target: &mut std::collections::BTreeSet<String>,
) {
    if let Some(values) = value.get(field).and_then(|v| v.as_array()) {
        for value in values {
            if let Some(text) = value.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    target.insert(trimmed.to_string());
                }
            }
        }
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
        Some(ms) => chrono::DateTime::from_timestamp_millis(ms)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "N/A".into()),
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

fn is_allowed_readme_url(readme_url: &str) -> bool {
    let Ok(url) = Url::parse(readme_url) else {
        return false;
    };

    if url.scheme() != "https" {
        return false;
    }

    matches!(
        url.host_str(),
        Some("download.lenovo.com" | "pcsupport.lenovo.com")
    )
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            client: SupportClient::new(),
        })
        .invoke_handler(tauri::generate_handler![
            search,
            search_products,
            browse_products,
            fetch_readme,
            clear_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // -----------------------------------------------------------------------
    // R1: is_allowed_readme_url
    // -----------------------------------------------------------------------

    #[test]
    fn allowed_readme_url_accepts_download_lenovo() {
        assert!(is_allowed_readme_url(
            "https://download.lenovo.com/pccbbs/mobiles/n1mgx13.txt"
        ));
    }

    #[test]
    fn allowed_readme_url_accepts_pcsupport_lenovo() {
        assert!(is_allowed_readme_url(
            "https://pcsupport.lenovo.com/us/en/docs/HT518988"
        ));
    }

    #[test]
    fn allowed_readme_url_blocks_http() {
        assert!(!is_allowed_readme_url(
            "http://download.lenovo.com/pccbbs/mobiles/n1mgx13.txt"
        ));
    }

    #[test]
    fn allowed_readme_url_blocks_other_hosts() {
        assert!(!is_allowed_readme_url("https://example.com/readme.txt"));
    }

    #[test]
    fn allowed_readme_url_blocks_empty_string() {
        assert!(!is_allowed_readme_url(""));
    }

    #[test]
    fn allowed_readme_url_blocks_invalid_url() {
        assert!(!is_allowed_readme_url("not a url at all"));
    }

    #[test]
    fn allowed_readme_url_blocks_javascript_uri() {
        assert!(!is_allowed_readme_url("javascript:alert(1)"));
    }

    #[test]
    fn allowed_readme_url_blocks_evil_subdomain() {
        assert!(!is_allowed_readme_url(
            "https://evil.lenovo.com/pccbbs/mobiles/n1mgx13.txt"
        ));
    }

    // -----------------------------------------------------------------------
    // R2: normalize_priority
    // -----------------------------------------------------------------------

    #[test]
    fn normalize_priority_exact_cases() {
        assert_eq!(normalize_priority("Critical"), "Critical");
        assert_eq!(normalize_priority("critical"), "Critical");
        assert_eq!(normalize_priority("CRITICAL"), "Critical");
        assert_eq!(normalize_priority("Recommended"), "Recommended");
        assert_eq!(normalize_priority("RECOMMENDED"), "Recommended");
        assert_eq!(normalize_priority("Optional"), "Optional");
        assert_eq!(normalize_priority("optional"), "Optional");
    }

    #[test]
    fn normalize_priority_na_variants() {
        assert_eq!(normalize_priority("n/a"), "Optional");
        assert_eq!(normalize_priority("na"), "Optional");
        assert_eq!(normalize_priority(""), "Optional");
    }

    #[test]
    fn normalize_priority_partial_matches() {
        assert_eq!(normalize_priority("Something-Critical"), "Critical");
        assert_eq!(normalize_priority("Recommended Update"), "Recommended");
    }

    #[test]
    fn normalize_priority_unknown() {
        assert_eq!(normalize_priority("unknown"), "Optional");
        assert_eq!(normalize_priority("urgent"), "Optional");
    }

    // -----------------------------------------------------------------------
    // R3: extract_priority
    // -----------------------------------------------------------------------

    #[test]
    fn extract_priority_from_item() {
        let item = json!({ "Priority": "Critical" });
        assert_eq!(extract_priority(&item, None), "Critical");
    }

    #[test]
    fn extract_priority_from_file_fallback() {
        let item = json!({});
        let file = json!({ "Priority": "recommended" });
        assert_eq!(extract_priority(&item, Some(&file)), "Recommended");
    }

    #[test]
    fn extract_priority_weight_critical() {
        let item = json!({ "PriorityWeight": 3 });
        assert_eq!(extract_priority(&item, None), "Critical");
    }

    #[test]
    fn extract_priority_weight_recommended() {
        let item = json!({ "PriorityWeight": 2 });
        assert_eq!(extract_priority(&item, None), "Recommended");
    }

    #[test]
    fn extract_priority_weight_optional() {
        let item = json!({ "PriorityWeight": 1 });
        assert_eq!(extract_priority(&item, None), "Optional");
    }

    #[test]
    fn extract_priority_no_field_defaults_to_optional() {
        let item = json!({});
        assert_eq!(extract_priority(&item, None), "Optional");
    }

    // -----------------------------------------------------------------------
    // R4: epoch_ms_to_date
    // -----------------------------------------------------------------------

    #[test]
    fn epoch_ms_to_date_valid() {
        let result = epoch_ms_to_date(Some(1_700_000_000_000));
        // 2023-11-14 UTC (depending on exact timestamp)
        assert!(result.contains('-'), "expected YYYY-MM-DD, got: {}", result);
        assert_ne!(result, "N/A");
    }

    #[test]
    fn epoch_ms_to_date_none() {
        assert_eq!(epoch_ms_to_date(None), "N/A");
    }

    // -----------------------------------------------------------------------
    // R5: short_title
    // -----------------------------------------------------------------------

    #[test]
    fn short_title_trims_for_windows() {
        assert_eq!(
            short_title("Lenovo Audio Driver for Windows"),
            "Lenovo Audio Driver"
        );
    }

    #[test]
    fn short_title_trims_after_dash() {
        assert_eq!(
            short_title("NVIDIA Graphics - Version 1.0"),
            "NVIDIA Graphics"
        );
    }

    #[test]
    fn short_title_no_match_returns_original() {
        assert_eq!(short_title("Simple Driver"), "Simple Driver");
    }

    #[test]
    fn short_title_empty_string() {
        assert_eq!(short_title(""), "");
    }

    #[test]
    fn short_title_trims_trailing_spaces_and_dashes() {
        assert_eq!(short_title("Driver Name "), "Driver Name");
        assert_eq!(short_title("Driver Name-"), "Driver Name");
    }

    // -----------------------------------------------------------------------
    // R6: extract_os_keys
    // -----------------------------------------------------------------------

    #[test]
    fn extract_os_keys_empty_files() {
        let item = json!({
            "OperatingSystemKeys": ["Win10"],
            "Files": []
        });
        let files = item.get("Files").and_then(|v| v.as_array());
        assert_eq!(extract_os_keys(&item, files), vec!["Win10".to_string()]);
    }

    #[test]
    fn extract_os_keys_dedup() {
        let item = json!({
            "OperatingSystemKeys": ["Win10"],
            "Files": [
                { "OperatingSystemKeys": ["Win10"] }
            ]
        });
        let files = item.get("Files").and_then(|v| v.as_array());
        assert_eq!(extract_os_keys(&item, files), vec!["Win10".to_string()]);
    }

    #[test]
    fn extract_os_keys_combines_item_and_file_keys() {
        let item = json!({
            "OperatingSystemKeys": ["Win11"],
            "Files": [
                { "OperatingSystemKeys": ["Win10"], "OperatingSystems": [] }
            ]
        });
        let files = item.get("Files").and_then(|v| v.as_array());
        assert_eq!(
            extract_os_keys(&item, files),
            vec!["Win10".to_string(), "Win11".to_string()]
        );
    }

    #[test]
    fn extract_os_keys_includes_operating_systems() {
        let item = json!({
            "OperatingSystemKeys": [],
            "Files": [
                { "OperatingSystemKeys": [], "OperatingSystems": ["Windows 11"] }
            ]
        });
        let files = item.get("Files").and_then(|v| v.as_array());
        assert_eq!(
            extract_os_keys(&item, files),
            vec!["Windows 11".to_string()]
        );
    }

    #[test]
    fn extracts_os_keys_from_driver_files() {
        let item = json!({
            "OperatingSystemKeys": [],
            "Files": [
                {
                    "OperatingSystemKeys": ["Windows 11 (64-bit)"],
                    "OperatingSystems": ["Windows 10 (64-bit)"]
                }
            ]
        });

        let files = item.get("Files").and_then(|v| v.as_array());

        assert_eq!(
            extract_os_keys(&item, files),
            vec![
                "Windows 10 (64-bit)".to_string(),
                "Windows 11 (64-bit)".to_string()
            ]
        );
    }

    // -----------------------------------------------------------------------
    // R7: collect_string_array_field
    // -----------------------------------------------------------------------

    #[test]
    fn collect_string_array_normal() {
        let val = json!({ "Tags": ["a", "b"] });
        let mut set = std::collections::BTreeSet::new();
        collect_string_array_field(&val, "Tags", &mut set);
        let expected: std::collections::BTreeSet<String> =
            ["a", "b"].into_iter().map(String::from).collect();
        assert_eq!(set, expected);
    }

    #[test]
    fn collect_string_array_empty_array() {
        let val = json!({ "Tags": [] });
        let mut set = std::collections::BTreeSet::new();
        collect_string_array_field(&val, "Tags", &mut set);
        assert!(set.is_empty());
    }

    #[test]
    fn collect_string_array_missing_field() {
        let val = json!({});
        let mut set = std::collections::BTreeSet::new();
        collect_string_array_field(&val, "Tags", &mut set);
        assert!(set.is_empty());
    }

    #[test]
    fn collect_string_array_ignores_non_strings() {
        let val = json!({ "Tags": [1, true, null, "ok"] });
        let mut set = std::collections::BTreeSet::new();
        collect_string_array_field(&val, "Tags", &mut set);
        assert!(set.contains("ok"));
        assert_eq!(set.len(), 1);
    }

    #[test]
    fn collect_string_array_ignores_whitespace_only() {
        let val = json!({ "Tags": ["  ", "ok", ""] });
        let mut set = std::collections::BTreeSet::new();
        collect_string_array_field(&val, "Tags", &mut set);
        assert!(set.contains("ok"));
        assert_eq!(set.len(), 1);
    }

    // -----------------------------------------------------------------------
    // R8: Serde roundtrip tests
    // -----------------------------------------------------------------------

    #[test]
    fn serde_roundtrip_search_response_success() {
        let resp = SearchResponse {
            success: true,
            error: None,
            serial: Some("PF123ABC".into()),
            product: None,
            drivers: None,
            warranty: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        let back: SearchResponse = serde_json::from_str(&json).unwrap();
        assert!(back.success);
        assert_eq!(back.serial.as_deref(), Some("PF123ABC"));
        assert!(back.error.is_none());
    }

    #[test]
    fn serde_roundtrip_search_response_error() {
        let resp = SearchResponse {
            success: false,
            error: Some("No products found".into()),
            serial: None,
            product: None,
            drivers: None,
            warranty: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        let back: SearchResponse = serde_json::from_str(&json).unwrap();
        assert!(!back.success);
        assert_eq!(back.error.as_deref(), Some("No products found"));
    }

    #[test]
    fn serde_roundtrip_driver_entry() {
        let entry = DriverEntry {
            title: "Lenovo Audio Driver".into(),
            short_title: "Lenovo Audio Driver".into(),
            doc_id: "DOC123".into(),
            summary: "Fixes audio".into(),
            category: "Audio".into(),
            version: "1.0".into(),
            priority: "Critical".into(),
            url: "https://example.com".into(),
            size: "10 MB".into(),
            sha256: "abc123".into(),
            released: "2024-01-01".into(),
            updated: "2024-06-01".into(),
            require_login: false,
            os_keys: vec!["Win11".into()],
            readme_url: "https://download.lenovo.com/readme.html".into(),
            release_notes: String::new(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        let back: DriverEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.title, "Lenovo Audio Driver");
        assert_eq!(back.priority, "Critical");
        assert_eq!(back.os_keys, vec!["Win11".to_string()]);
        assert!(!back.require_login);
    }

    #[test]
    fn serde_roundtrip_drivers_data() {
        let data = DriversData {
            serial: "PF123ABC".into(),
            product_name: "ThinkPad X1".into(),
            drivers: vec![],
            categories: vec!["Audio".into(), "BIOS".into()],
            generated_at: "2024-01-01 00:00 UTC".into(),
        };
        let json = serde_json::to_string(&data).unwrap();
        let back: DriversData = serde_json::from_str(&json).unwrap();
        assert_eq!(back.serial, "PF123ABC");
        assert_eq!(back.categories.len(), 2);
        assert!(back.drivers.is_empty());
    }
}
