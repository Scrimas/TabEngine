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
use std::sync::OnceLock;
use std::time::Duration;

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

/// Upper bound for any HTTP body we buffer. Real GP files are well under
/// 10 MB; anything larger is a misbehaving endpoint, and buffering it whole
/// (then JSON-serializing it over IPC) would freeze the app.
const MAX_DOWNLOAD_BYTES: u64 = 50 * 1024 * 1024;

/// Hosts the generic `songsterr_fetch_url` proxy may talk to. The command
/// exists to bypass CORS for the restricted-tab downloader, not to be an
/// open relay for arbitrary requests from the webview.
const FETCH_URL_ALLOWED_HOSTS: &[&str] = &[
    "songsterr.com",
    "www.songsterr.com",
    "dqsljvtekg760.cloudfront.net",
    "d3d3l6a6rcgkaf.cloudfront.net",
];

/// Shared client: connection pooling plus hard timeouts so a stalled
/// Songsterr request can never hang the UI forever (the frontend keeps
/// `isFetching` until the command resolves).
fn client() -> Result<reqwest::Client, String> {
    static HTTP: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = HTTP.get() {
        return Ok(c.clone());
    }
    let built = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    Ok(HTTP.get_or_init(|| built).clone())
}

/// Truncate on a char boundary. Byte-slicing (`&s[0..300]`) panics mid-UTF-8
/// sequence, and with `panic = "abort"` that kills the whole process.
fn truncate_chars(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Buffer a response body with a size cap (checked against Content-Length
/// up front and enforced while streaming, since the header can lie).
async fn read_body_capped(mut resp: reqwest::Response, what: &str) -> Result<Vec<u8>, String> {
    if let Some(len) = resp.content_length() {
        if len > MAX_DOWNLOAD_BYTES {
            return Err(format!("{} is too large ({} bytes).", what, len));
        }
    }
    let mut out: Vec<u8> = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Failed to read {}: {}", what, e))?
    {
        if (out.len() + chunk.len()) as u64 > MAX_DOWNLOAD_BYTES {
            return Err(format!(
                "{} exceeded the {} MB download limit.",
                what,
                MAX_DOWNLOAD_BYTES / (1024 * 1024)
            ));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// What the meta -> revision resolution found for a song.
enum ResolvedSource {
    /// Downloadable: the CDN URL of the source GP file.
    Available(String),
    /// Published but copyright-restricted (no source URL).
    Restricted,
    /// Meta endpoint returned 403 — unpublished/private tab.
    Unpublished,
}

/// Shared meta -> revision resolution used by both `songsterr_fetch_tab` and
/// `songsterr_check_restriction` (previously duplicated in both commands).
async fn resolve_source(song_id: u64) -> Result<ResolvedSource, String> {
    let client = client()?;

    let meta_url = format!("https://www.songsterr.com/api/meta/{}", song_id);
    let meta_resp = client
        .get(&meta_url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to request metadata: {}", e))?;

    if meta_resp.status().as_u16() == 403 {
        return Ok(ResolvedSource::Unpublished);
    }
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

    match revision.source {
        Some(url) if !url.trim().is_empty() => Ok(ResolvedSource::Available(url)),
        _ => Ok(ResolvedSource::Restricted),
    }
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
    let client = client()?;

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

    let search_res = serde_json::from_str::<SearchResponse>(&body_text).map_err(|e| {
        format!(
            "JSON parse error: {}. Body sample: {}",
            e,
            truncate_chars(&body_text, 300)
        )
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
/// Resolves meta -> revision -> CDN source URL (see `resolve_source`), then
/// downloads the raw GP binary. Returned as a raw-bytes IPC response so the
/// file doesn't get serialized into a JSON number array on its way to JS.
#[tauri::command]
pub async fn songsterr_fetch_tab(song_id: u64) -> Result<tauri::ipc::Response, String> {
    let source_url =
        match resolve_source(song_id).await? {
            ResolvedSource::Available(url) => url,
            ResolvedSource::Restricted => return Err(
                "This track is copyright-restricted by Songsterr and cannot be loaded directly."
                    .to_string(),
            ),
            ResolvedSource::Unpublished => {
                return Err("This tab is unpublished/private on Songsterr.".to_string())
            }
        };

    let client = client()?;
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

    let bytes = read_body_capped(gp_resp, "Tab file").await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Check if a song is unrestricted, restricted by copyright, or unpublished/private.
///
/// Returns one of: "unrestricted", "restricted", "unpublished", or "error".
#[tauri::command]
pub async fn songsterr_check_restriction(song_id: u64) -> Result<String, String> {
    match resolve_source(song_id).await {
        Ok(ResolvedSource::Available(_)) => Ok("unrestricted".to_string()),
        Ok(ResolvedSource::Restricted) => Ok("restricted".to_string()),
        Ok(ResolvedSource::Unpublished) => Ok("unpublished".to_string()),
        Err(detail) => {
            // The frontend treats "error" as a status, not a failure — keep
            // that contract but stop swallowing the diagnostic entirely.
            eprintln!(
                "[songsterr] restriction check failed for {}: {}",
                song_id, detail
            );
            Ok("error".to_string())
        }
    }
}

/// Fetch the raw body of a URL as a String to bypass CORS.
///
/// Restricted to Songsterr's own hosts and its tab CDNs — this exists for the
/// restricted-tab downloader, not as an open relay the webview could use to
/// reach arbitrary servers.
#[tauri::command]
pub async fn songsterr_fetch_url(url: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid URL '{}': {}", url, e))?;
    if parsed.scheme() != "https" {
        return Err("Only https:// URLs are allowed.".to_string());
    }
    let host = parsed.host_str().unwrap_or_default();
    if !FETCH_URL_ALLOWED_HOSTS.contains(&host) {
        return Err(format!("Host '{}' is not an allowed Songsterr host.", host));
    }

    let client = client()?;
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("Failed to request URL: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Request returned HTTP {}", response.status()));
    }

    let bytes = read_body_capped(response, "Response body").await?;
    String::from_utf8(bytes).map_err(|e| format!("Response body is not valid UTF-8: {}", e))
}
