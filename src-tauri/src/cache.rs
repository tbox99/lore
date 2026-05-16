//! Simple file-based cache with TTL support (port of Python DiskCache).

use regex::Regex;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

// ---------------------------------------------------------------------------
// Cache TTLs (seconds)
// ---------------------------------------------------------------------------

pub const TTL_PRODUCT: u64 = 3600; // 1 hour
pub const TTL_DRIVERS: u64 = 3600 * 6; // 6 hours
pub const TTL_WARRANTY: u64 = 3600 * 24; // 24 hours
pub const TTL_SESSION: u64 = 1800; // 30 minutes
pub const TTL_README: u64 = 3600 * 24; // 24 hours

// ---------------------------------------------------------------------------
// Cache error type
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum CacheError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

// ---------------------------------------------------------------------------
// DiskCache
// ---------------------------------------------------------------------------

pub struct DiskCache {
    cache_dir: PathBuf,
}

impl DiskCache {
    pub fn new(cache_dir: Option<&Path>) -> Self {
        let cache_dir = cache_dir
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| {
                dirs::cache_dir()
                    .unwrap_or_else(|| PathBuf::from("/tmp"))
                    .join("lore")
            });
        let _ = fs::create_dir_all(&cache_dir);
        Self { cache_dir }
    }

    fn path_for_key(&self, key: &str) -> PathBuf {
        let re = Regex::new(r"[^a-zA-Z0-9_-]").unwrap();
        let safe = re.replace_all(key, "_");
        self.cache_dir.join(format!("{}.json", safe))
    }

    pub fn get(&self, key: &str, ttl: u64) -> Option<Value> {
        let p = self.path_for_key(key);
        let metadata = fs::metadata(&p).ok()?;
        let modified = metadata.modified().ok()?;
        let now = SystemTime::now();
        let age = now.duration_since(modified).ok()?.as_secs();
        if age > ttl {
            let _ = fs::remove_file(&p);
            return None;
        }
        let content = fs::read_to_string(&p).ok()?;
        serde_json::from_str(&content).ok()
    }

    pub fn set(&self, key: &str, value: &Value) -> Result<(), CacheError> {
        let p = self.path_for_key(key);
        let content = serde_json::to_string(value)?;
        fs::write(&p, content)?;
        Ok(())
    }

    pub fn clear(&self) -> Result<(), CacheError> {
        let entries = fs::read_dir(&self.cache_dir)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                let _ = fs::remove_file(&path);
            }
        }
        Ok(())
    }
}
