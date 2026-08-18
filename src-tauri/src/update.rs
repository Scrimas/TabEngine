// update.rs — manual "check for updates" against GitHub releases.
//
// Only ever called explicitly from the Settings dialog (no automatic
// network calls on startup — this is a deliberate privacy choice).

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    pub latest: String,
    pub is_newer: bool,
    pub url: String,
}

/// Parse "v1.2.3"-style tags into comparable numeric parts. Non-numeric
/// suffixes (`-beta`, build metadata) are ignored.
fn parse_version(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches(['v', 'V'])
        .split(['.', '-', '+'])
        .take(3)
        .map(|part| {
            part.chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(0)
        })
        .collect()
}

#[tauri::command]
pub async fn check_latest_release() -> Result<UpdateCheck, String> {
    let client = crate::songsterr::client()?;

    let response = client
        .get("https://api.github.com/repos/Scrimas/TabEngine/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Update check failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub returned HTTP {}.",
            response.status().as_u16()
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Unexpected release response: {}", e))?;

    let latest = body
        .get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or("Release response is missing tag_name.")?
        .to_string();
    let url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://github.com/Scrimas/TabEngine/releases")
        .to_string();

    let current = env!("CARGO_PKG_VERSION").to_string();
    let is_newer = parse_version(&latest) > parse_version(&current);

    Ok(UpdateCheck {
        current,
        latest,
        is_newer,
        url,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn parses_tags_and_orders_them() {
        assert_eq!(parse_version("v0.2.1"), vec![0, 2, 1]);
        assert_eq!(parse_version("1.10.0-beta"), vec![1, 10, 0]);
        assert!(parse_version("v0.3.0") > parse_version("0.2.1"));
        assert!(parse_version("0.2.1") == parse_version("v0.2.1"));
    }
}
