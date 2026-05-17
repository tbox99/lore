//! Lenovo Support API client (port of Python SupportClient).
//!
//! Uses reqwest for HTTP and a simple DiskCache for caching.
//! Methods are async and designed to run within Tauri's tokio runtime.

use crate::cache::{
    CacheError, DiskCache, TTL_DRIVERS, TTL_PRODUCT, TTL_README, TTL_SESSION, TTL_WARRANTY,
};
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE, COOKIE, REFERER, USER_AGENT};
use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL: &str = "https://pcsupport.lenovo.com/us/en/api/v4";
const MAX_RETRIES: u32 = 3;
const RETRY_BACKOFF_SECS: u64 = 1;

fn user_agent_str() -> &'static str {
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Cache error: {0}")]
    Cache(#[from] CacheError),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("No products found for identifier: {0}")]
    NoProducts(String),
    #[error("Warranty lookup failed after session cookie refresh")]
    WarrantyAuthFailed,
    #[error("Could not obtain Lenovo_SessionID cookie")]
    NoSessionCookie,
    #[error("Max retries exceeded")]
    MaxRetries,
    #[error("{0}")]
    Other(String),
}

// ---------------------------------------------------------------------------
// SupportClient
// ---------------------------------------------------------------------------

pub struct SupportClient {
    client: reqwest::Client,
    cache: DiskCache,
    no_cache: bool,
    session_cookie: Mutex<Option<String>>,
    session_cookie_ts: Mutex<Option<std::time::Instant>>,
}

impl SupportClient {
    pub fn new() -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(user_agent_str()));
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/json, text/plain, */*"),
        );
        headers.insert(
            "Accept-Language",
            HeaderValue::from_static("en-US,en;q=0.9"),
        );
        headers.insert(
            REFERER,
            HeaderValue::from_static("https://pcsupport.lenovo.com/"),
        );

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .default_headers(headers)
            .cookie_store(true)
            .gzip(true)
            .brotli(true)
            .deflate(true)
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("Failed to create HTTP client");

        let cache = DiskCache::new(None);

        Self {
            client,
            cache,
            no_cache: false,
            session_cookie: Mutex::new(None),
            session_cookie_ts: Mutex::new(None),
        }
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    async fn request_with_retry(
        &self,
        method: reqwest::Method,
        url: &str,
    ) -> Result<reqwest::Response, ClientError> {
        self.request_with_retry_and_body(method, url, None, None)
            .await
    }

    async fn request_with_retry_and_body(
        &self,
        method: reqwest::Method,
        url: &str,
        extra_headers: Option<HeaderMap>,
        body: Option<&Value>,
    ) -> Result<reqwest::Response, ClientError> {
        let mut last_err = None;

        for attempt in 0..MAX_RETRIES {
            let mut req = self.client.request(method.clone(), url);

            if let Some(ref h) = extra_headers {
                for (k, v) in h.iter() {
                    req = req.header(k, v);
                }
            }

            if let Some(b) = body {
                req = req.json(b);
            }

            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.as_u16() == 429 {
                        let retry_after = resp
                            .headers()
                            .get("retry-after")
                            .and_then(|v| v.to_str().ok())
                            .and_then(|s| s.parse::<u64>().ok())
                            .unwrap_or(0);
                        let wait = if retry_after > 0 {
                            retry_after
                        } else {
                            RETRY_BACKOFF_SECS * 2u64.pow(attempt)
                        };
                        log::warn!(
                            "429 rate-limited, retrying in {}s (attempt {})",
                            wait,
                            attempt + 1
                        );
                        tokio::time::sleep(Duration::from_secs(wait)).await;
                        continue;
                    }
                    if status.as_u16() >= 500 {
                        let wait = RETRY_BACKOFF_SECS * 2u64.pow(attempt);
                        log::warn!(
                            "5xx error {}, retrying in {}s (attempt {})",
                            status,
                            wait,
                            attempt + 1
                        );
                        tokio::time::sleep(Duration::from_secs(wait)).await;
                        continue;
                    }
                    return Ok(resp);
                }
                Err(e) => {
                    let wait = RETRY_BACKOFF_SECS * 2u64.pow(attempt);
                    log::warn!(
                        "Network error, retrying in {}s (attempt {}): {}",
                        wait,
                        attempt + 1,
                        e
                    );
                    last_err = Some(e);
                    tokio::time::sleep(Duration::from_secs(wait)).await;
                }
            }
        }

        Err(last_err
            .map(ClientError::Http)
            .unwrap_or(ClientError::MaxRetries))
    }

    async fn cached_get(
        &self,
        cache_key: &str,
        url: &str,
        ttl: u64,
        params: &[(&str, &str)],
    ) -> Result<Value, ClientError> {
        if !self.no_cache {
            if let Some(cached) = self.cache.get(cache_key, ttl) {
                log::debug!("Cache hit: {}", cache_key);
                return Ok(cached);
            }
        }

        let mut full_url = reqwest::Url::parse(url)
            .map_err(|e| ClientError::Other(format!("Invalid URL {}: {}", url, e)))?;
        full_url
            .query_pairs_mut()
            .extend_pairs(params.iter().copied());

        let resp = self
            .request_with_retry(reqwest::Method::GET, full_url.as_str())
            .await?;

        let status = resp.status();
        if !status.is_success() {
            return Err(ClientError::Other(format!("HTTP {} for {}", status, url)));
        }

        let data: Value = resp.json().await?;

        if !self.no_cache {
            let _ = self.cache.set(cache_key, &data);
        }

        Ok(data)
    }

    // ------------------------------------------------------------------
    // Session cookie management
    // ------------------------------------------------------------------

    async fn fetch_session_cookie(&self) -> Result<String, ClientError> {
        // Check in-memory cache
        {
            let cookie = self.session_cookie.lock().unwrap();
            let ts = self.session_cookie_ts.lock().unwrap();
            if let (Some(c), Some(t)) = (cookie.as_ref(), ts.as_ref()) {
                if t.elapsed().as_secs() < TTL_SESSION {
                    return Ok(c.clone());
                }
            }
        }

        let resp = self
            .request_with_retry(
                reqwest::Method::GET,
                "https://pcsupport.lenovo.com/us/en/warrantylookup",
            )
            .await?;

        // Extract Lenovo_SessionID from set-cookie header
        for (key, value) in resp.headers() {
            if key == "set-cookie" {
                if let Ok(v) = value.to_str() {
                    if let Some(start) = v.find("Lenovo_SessionID=") {
                        let rest = &v[start + 17..];
                        let end = rest.find(';').unwrap_or(rest.len());
                        let cookie_val = rest[..end].to_string();
                        {
                            let mut c = self.session_cookie.lock().unwrap();
                            *c = Some(cookie_val.clone());
                        }
                        {
                            let mut t = self.session_cookie_ts.lock().unwrap();
                            *t = Some(std::time::Instant::now());
                        }
                        log::debug!("Obtained session cookie (len={})", cookie_val.len());
                        return Ok(cookie_val);
                    }
                }
            }
        }

        Err(ClientError::NoSessionCookie)
    }

    fn invalidate_session_cookie(&self) {
        *self.session_cookie.lock().unwrap() = None;
        *self.session_cookie_ts.lock().unwrap() = None;
    }

    // ------------------------------------------------------------------
    // Public API methods
    // ------------------------------------------------------------------

    /// Look up products by serial number or MTM prefix.
    pub async fn lookup_product(&self, identifier: &str) -> Result<Vec<Value>, ClientError> {
        let cache_key = format!("product:{}", identifier);
        let url = format!("{}/mse/getproducts", BASE_URL);
        let result = self
            .cached_get(&cache_key, &url, TTL_PRODUCT, &[("productId", identifier)])
            .await?;

        if result.is_array() {
            Ok(result.as_array().unwrap().clone())
        } else if result.is_object() {
            Ok(vec![result])
        } else {
            Ok(vec![])
        }
    }

    /// Retrieve driver listing for a product.
    pub async fn get_drivers(&self, product_path: &str) -> Result<Value, ClientError> {
        let cache_key = format!("drivers:{}", product_path);
        let url = format!("{}/downloads/drivers", BASE_URL);
        self.cached_get(
            &cache_key,
            &url,
            TTL_DRIVERS,
            &[("productId", product_path)],
        )
        .await
    }

    /// Retrieve warranty info for a device.
    pub async fn get_warranty(
        &self,
        serial: &str,
        machine_type: &str,
    ) -> Result<Value, ClientError> {
        let cache_key = format!("warranty:{}:{}:us:en", serial, machine_type);

        if !self.no_cache {
            if let Some(cached) = self.cache.get(&cache_key, TTL_WARRANTY) {
                return Ok(cached);
            }
        }

        let body = serde_json::json!({
            "serialNumber": serial,
            "machineType": machine_type,
            "country": "us",
            "language": "en",
        });

        for _ in 0..2 {
            let session_id = self.fetch_session_cookie().await?;

            let mut extra_headers = HeaderMap::new();
            extra_headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            extra_headers.insert(
                ACCEPT,
                HeaderValue::from_static("application/json, text/plain, */*"),
            );
            extra_headers.insert(
                "Origin",
                HeaderValue::from_static("https://pcsupport.lenovo.com"),
            );
            extra_headers.insert(
                REFERER,
                HeaderValue::from_static("https://pcsupport.lenovo.com/us/en/warrantylookup"),
            );
            extra_headers.insert(
                COOKIE,
                HeaderValue::from_str(&format!("Lenovo_SessionID={}", session_id))
                    .unwrap_or_else(|_| HeaderValue::from_static("")),
            );

            let url = format!("{}/upsell/redport/getIbaseInfo", BASE_URL);
            let resp = self
                .request_with_retry_and_body(
                    reqwest::Method::POST,
                    &url,
                    Some(extra_headers),
                    Some(&body),
                )
                .await?;

            let status = resp.status();
            if !status.is_success() {
                return Err(ClientError::Other(format!("HTTP {} for warranty", status)));
            }

            let result: Value = resp.json().await?;

            // Check for auth failure (code 100)
            if result.get("code").and_then(|c| c.as_i64()) == Some(100) {
                log::warn!("Warranty auth failure (code 100), re-fetching session cookie");
                self.invalidate_session_cookie();
                continue;
            }

            let data = result.get("data").cloned().unwrap_or(result);

            if !self.no_cache {
                let _ = self.cache.set(&cache_key, &data);
            }

            return Ok(data);
        }

        Err(ClientError::WarrantyAuthFailed)
    }

    /// Fetch readme HTML page and extract "Changes in this release" section.
    pub async fn fetch_readme_changes(&self, readme_url: &str) -> Result<String, ClientError> {
        if readme_url.is_empty() {
            return Ok(String::new());
        }

        // Check cache first
        let cache_key = format!("readme:{}", readme_url);
        if let Some(cached) = self.cache.get(&cache_key, TTL_README) {
            if let Some(s) = cached.as_str() {
                return Ok(s.to_string());
            }
            return Ok(String::new());
        }

        let resp = match self.client.get(readme_url).send().await {
            Ok(r) => r,
            Err(_) => {
                let _ = self.cache.set(&cache_key, &Value::String(String::new()));
                return Ok(String::new());
            }
        };

        if resp.status().as_u16() != 200 {
            let _ = self.cache.set(&cache_key, &Value::String(String::new()));
            return Ok(String::new());
        }

        let text = resp.text().await.unwrap_or_default();
        let html = extract_changes_section(&text);

        let _ = self.cache.set(&cache_key, &Value::String(html.clone()));
        Ok(html)
    }

    /// Clear the disk cache.
    pub fn clear_cache(&self) -> Result<(), ClientError> {
        self.cache.clear().map_err(ClientError::from)
    }

    // ------------------------------------------------------------------
    // Utility
    // ------------------------------------------------------------------

    /// Extract machine type from a product dict.
    pub fn extract_machine_type(product: &Value) -> String {
        // Strategy: find the *most specific* machine type.
        // Product names like "T14s Gen 4 (Type 21F8, 21F9) - Type 21F9"
        // contain multiple MTMs. The LAST "- Type XXXX" suffix is the specific variant.

        if let Some(name) = product.get("Name").and_then(|v| v.as_str()) {
            // Check for "- Type XXXX" suffix first (most specific)
            let suffix_re = Regex::new(r"-\s*Type\s+(\w{4})\s*$").unwrap();
            if let Some(caps) = suffix_re.captures(name) {
                if let Some(m) = caps.get(1) {
                    return m.as_str().to_string();
                }
            }

            // Fallback: last "Type XXXX" occurrence in the name
            let all_types_re = Regex::new(r"Type\s+(\w{4})").unwrap();
            let mut last_match = None;
            for cap in all_types_re.captures_iter(name) {
                if let Some(m) = cap.get(1) {
                    last_match = Some(m.as_str().to_string());
                }
            }
            if let Some(m) = last_match {
                return m;
            }
        }

        // Fallback: extract 4-char MTM from Id path segments
        if let Some(id) = product.get("Id").and_then(|v| v.as_str()) {
            let parts: Vec<&str> = id.trim_end_matches('/').split('/').collect();
            let re = Regex::new(r"^\w{4}$").unwrap();
            for part in parts.iter().rev() {
                if re.is_match(part) {
                    return part.to_string();
                }
            }
        }

        String::new()
    }
}

impl Default for SupportClient {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Readme parsing (port of Python _extract_changes_section)
// ---------------------------------------------------------------------------

fn extract_changes_section(html_text: &str) -> String {
    let changes_pattern = Regex::new(
        r#"(?i)<button[^>]*class="collapsible"[^>]*>\s*Changes\s+in\s+(?:This|the)\s*Release\s*<"#,
    )
    .unwrap();

    if let Some(changes_match) = changes_pattern.find(html_text) {
        let after_button = &html_text[changes_match.end()..];
        let card_pattern =
            Regex::new(r#"(?s)<div\s+class="card\s+card-body"[^>]*>(.*?)</div>\s*</div>"#).unwrap();

        if let Some(card_match) = card_pattern.captures(after_button) {
            let content_html = card_match.get(1).unwrap().as_str();
            let mut lines = html_to_lines(content_html);
            let re = Regex::new(r"(?i)^CHANGES\s+IN\s+THIS\s+RELEASE").unwrap();
            if !lines.is_empty() && re.is_match(&lines[0]) {
                lines.remove(0);
            }

            if !lines.is_empty() {
                return parse_changes_lines(&lines.iter().map(|s| s.as_str()).collect::<Vec<_>>());
            }
        }
    }

    let lines = html_to_lines(html_text);
    let start_idx = lines.iter().position(|line| {
        Regex::new(r"(?i)CHANGES\s+IN\s+THIS\s+RELEASE")
            .unwrap()
            .is_match(line)
    });

    if let Some(start) = start_idx {
        let stop_patterns = [
            Regex::new(
                r"(?i)^\s*(Determining|Installing|Installation|Manual Install|Unattended)\b",
            )
            .unwrap(),
            Regex::new(
                r"(?i)^\s*\d+\.\s+(Hold|Select|Press|Make|Open|Locate|Double|Type|Click|Follow)\b",
            )
            .unwrap(),
        ];

        let section_lines: Vec<String> = lines[start + 1..]
            .iter()
            .take_while(|line| {
                let trimmed = line.trim();
                for pat in &stop_patterns {
                    if pat.is_match(trimmed) {
                        return false;
                    }
                }
                true
            })
            .filter(|line| !line.trim().is_empty())
            .cloned()
            .collect();

        if !section_lines.is_empty() {
            return parse_changes_lines(
                &section_lines.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            );
        }
    }

    String::new()
}

fn html_to_lines(html_text: &str) -> Vec<String> {
    let mut text = html_text.to_string();
    text = Regex::new(r"</p>")
        .unwrap()
        .replace_all(&text, "\n")
        .to_string();
    text = Regex::new(r"(?i)<br\s*/?>")
        .unwrap()
        .replace_all(&text, "\n")
        .to_string();
    text = Regex::new(r"<[^>]+>")
        .unwrap()
        .replace_all(&text, "")
        .to_string();
    text = text.replace("&nbsp;", " ");
    text = text.replace("&amp;", "&");
    text = text.replace("&lt;", "<");
    text = text.replace("&gt;", ">");
    text.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

fn parse_changes_lines(lines: &[&str]) -> String {
    let mut sections: Vec<(Option<String>, Vec<String>)> = vec![];
    let mut current_title: Option<String> = None;
    let mut current_items: Vec<String> = Vec::new();

    let bracket_re = Regex::new(r"^\[([^\]]+)\]\s*$").unwrap();
    let bullet_re = Regex::new(r"^-\s+(.+)$").unwrap();

    for line in lines {
        if let Some(caps) = bracket_re.captures(line) {
            if !current_items.is_empty() {
                sections.push((current_title.clone(), current_items.clone()));
                current_items.clear();
            }
            current_title = Some(caps.get(1).unwrap().as_str().to_string());
            continue;
        }

        if let Some(caps) = bullet_re.captures(line) {
            current_items.push(caps.get(1).unwrap().as_str().trim().to_string());
            continue;
        }

        if !line.is_empty() && !line.starts_with('[') {
            current_items.push(line.to_string());
        }
    }

    if !current_items.is_empty() {
        sections.push((current_title, current_items));
    }

    if sections.is_empty() {
        return String::new();
    }

    let mut html_parts = Vec::new();
    for (title, items) in &sections {
        if let Some(t) = title {
            html_parts.push(format!("<strong>{}</strong>", esc_html(t)));
        }
        let lis: Vec<String> = items
            .iter()
            .map(|it| format!("<li>{}</li>", esc_html(it)))
            .collect();
        html_parts.push(format!("<ul>\n{}\n</ul>", lis.join("\n")));
    }

    html_parts.join("\n")
}

fn esc_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
