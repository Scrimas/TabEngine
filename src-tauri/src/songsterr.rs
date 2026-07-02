// songsterr.rs — Tauri IPC commands for Songsterr API integration
//
// Design rationale:
//   All HTTP requests to Songsterr are performed here in Rust rather than
//   from the webview frontend to bypass CORS policies and secure network I/O.
//
//   This module converts and maps the 2026 endpoints (/api/search and
//   /api/meta -> /api/revision) back into the original schemas to keep the
//   Svelte frontend completely stable.

use serde::{Deserialize, Serialize};

// ── Original Data types returned to Frontend ────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SongsterrArtist {
    pub id: u64,
    pub name: String,
    #[serde(rename = "nameWithoutThePrefix")]
    pub name_without_the_prefix: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SongsterrTrack {
    #[serde(rename = "instrumentId")]
    pub instrument_id: u32,
    #[serde(default)]
    pub instrument: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub tuning: Vec<u8>,
    pub difficulty: Option<u8>,
    pub views: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SongsterrSong {
    pub id: u64,
    pub title: String,
    pub artist: SongsterrArtist,
    #[serde(rename = "chordsPresent")]
    pub chords_present: Option<bool>,
    pub tracks: Vec<SongsterrTrack>,
    #[serde(rename = "hasPlayer")]
    pub has_player: Option<bool>,
    #[serde(rename = "defaultTrack")]
    pub default_track: Option<u32>,
    #[serde(rename = "revisionId")]
    pub revision_id: Option<u64>,
}

// ── New API Schemas for deserializing 2026 endpoints ──────────────────────────

#[derive(Deserialize, Debug)]
struct SearchResponse {
    records: Vec<SearchRecord>,
}

#[derive(Deserialize, Debug)]
struct SearchRecord {
    #[serde(rename = "songId")]
    song_id: u64,
    #[serde(rename = "artistId")]
    artist_id: u64,
    artist: String,
    title: String,
    #[serde(rename = "hasChords")]
    has_chords: bool,
    #[serde(rename = "hasPlayer")]
    has_player: bool,
    tracks: Vec<SongsterrTrack>,
    #[serde(rename = "defaultTrack")]
    default_track: Option<u32>,
}

#[derive(Deserialize, Debug)]
struct MetaResponse {
    #[serde(rename = "revisionId")]
    revision_id: u64,
}

#[derive(Deserialize, Debug)]
struct RevisionResponse {
    source: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
                           (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Search Songsterr's song database (Updated for 2026 API).
///
/// Hits `https://www.songsterr.com/api/search?pattern={query}`.
#[tauri::command]
pub async fn songsterr_search(
    query: String,
    instrument: Option<String>,
    size: Option<u32>,
    from: Option<u32>,
) -> Result<Vec<SongsterrSong>, String> {
    let client = build_client()?;

    let mut url = reqwest::Url::parse("https://www.songsterr.com/api/search")
        .map_err(|e| format!("Failed to parse URL: {}", e))?;

    {
        let mut params = url.query_pairs_mut();
        params.append_pair("pattern", &query);
        params.append_pair("size", &size.unwrap_or(20).to_string());
        params.append_pair("from", &from.unwrap_or(0).to_string());
        if let Some(ref inst) = instrument {
            params.append_pair("inst", inst);
        }
    }

    let response = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Songsterr search returned HTTP {}",
            response.status()
        ));
    }

    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body text: {}", e))?;

    let search_res = serde_json::from_str::<SearchResponse>(&body_text)
        .map_err(|e| {
            let sample = if body_text.len() > 300 {
                &body_text[0..300]
            } else {
                &body_text
            };
            format!("JSON parse error: {}. Body sample: {}", e, sample)
        })?;

    // Map new records schema back to the original interface expected by Svelte
    let mapped_songs: Vec<SongsterrSong> = search_res
        .records
        .into_iter()
        .map(|r| SongsterrSong {
            id: r.song_id,
            title: r.title,
            artist: SongsterrArtist {
                id: r.artist_id,
                name: r.artist,
                name_without_the_prefix: None,
            },
            chords_present: Some(r.has_chords),
            tracks: r.tracks,
            has_player: Some(r.has_player),
            default_track: r.default_track,
            revision_id: None,
        })
        .collect();

    Ok(mapped_songs)
}

/// Fetch a Guitar Pro tablature file from Songsterr (Updated for 2026 multi-hop flow).
///
/// Under the hood, this makes two meta calls to resolve the CDN source path:
///   1. GET `/api/meta/{song_id}` -> extracts latest `revisionId`.
///   2. GET `/api/revision/{revision_id}` -> extracts `source` file URL.
///   3. GET `{source_url}` -> returns raw binary bytes.
#[tauri::command]
pub async fn songsterr_fetch_tab(song_id: u64) -> Result<Vec<u8>, String> {
    let client = build_client()?;

    // Step 1: Fetch metadata to get the revisionId
    let meta_url = format!("https://www.songsterr.com/api/meta/{}", song_id);
    let meta_resp = client
        .get(&meta_url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to request metadata: {}", e))?;

    if !meta_resp.status().is_success() {
        return Err(format!(
            "Metadata endpoint returned HTTP {}",
            meta_resp.status()
        ));
    }

    let meta: MetaResponse = meta_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse metadata JSON: {}", e))?;

    // Step 2: Fetch the revision details using the resolved revisionId
    let revision_url = format!(
        "https://www.songsterr.com/api/revision/{}",
        meta.revision_id
    );
    let rev_resp = client
        .get(&revision_url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to request revision details: {}", e))?;

    if !rev_resp.status().is_success() {
        return Err(format!(
            "Revision endpoint returned HTTP {}",
            rev_resp.status()
        ));
    }

    let revision: RevisionResponse = rev_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse revision JSON: {}", e))?;

    // Step 3: Check if source URL exists (handle copyright blocks)
    let source_url = match revision.source {
        Some(url) if !url.trim().is_empty() => url,
        _ => return Err(
            "This track is copyright-restricted by Songsterr and cannot be loaded directly.".to_string()
        ),
    };

    // Step 4: Download the raw GP binary from the CDN source URL
    let gp_resp = client
        .get(&source_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download tab file: {}", e))?;

    if !gp_resp.status().is_success() {
        return Err(format!(
            "Tab file download returned HTTP {}",
            gp_resp.status()
        ));
    }

    gp_resp
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read tab bytes: {}", e))
}

/// Check if a song is unrestricted, restricted by copyright, or unpublished/private.
///
/// Returns one of: "unrestricted", "restricted", "unpublished", or "error".
#[tauri::command]
pub async fn songsterr_check_restriction(song_id: u64) -> Result<String, String> {
    let client = build_client()?;

    // Fetch meta
    let meta_url = format!("https://www.songsterr.com/api/meta/{}", song_id);
    let meta_resp = match client
        .get(&meta_url)
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(_) => return Ok("error".to_string()),
    };

    if meta_resp.status().as_u16() == 403 {
        return Ok("unpublished".to_string());
    }

    if !meta_resp.status().is_success() {
        return Ok("error".to_string());
    }

    let meta: MetaResponse = match meta_resp.json().await {
        Ok(m) => m,
        Err(_) => return Ok("error".to_string()),
    };

    // Fetch revision
    let revision_url = format!(
        "https://www.songsterr.com/api/revision/{}",
        meta.revision_id
    );
    let rev_resp = match client
        .get(&revision_url)
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(_) => return Ok("error".to_string()),
    };

    if !rev_resp.status().is_success() {
        return Ok("error".to_string());
    }

    let revision: RevisionResponse = match rev_resp.json().await {
        Ok(r) => r,
        Err(_) => return Ok("error".to_string()),
    };

    match revision.source {
        Some(url) if !url.trim().is_empty() => Ok("unrestricted".to_string()),
        _ => Ok("restricted".to_string()),
    }
}

/// Fetch raw body of a URL as a String to bypass CORS (generic helper).
#[tauri::command]
pub async fn songsterr_fetch_url(url: String) -> Result<String, String> {
    let client = build_client()?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to request URL: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Request returned HTTP {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))
}

