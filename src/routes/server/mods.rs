use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod get {
    use crate::wings::{list_directory, read_file};
    use serde::{Deserialize, Serialize};
    use serde_json::Value;
    use shared::{
        ApiError, GetState,
        models::{server::GetServer, user::GetPermissionManager},
        response::{ApiResponse, ApiResponseResult},
    };
    use std::collections::HashMap;
    use utoipa::ToSchema;

    const MODS_DIRECTORY: &str = "mods";
    const MODPACK_MARKER: &str = ".modpack-installer.json";
    const MAX_MARKER_SIZE: u64 = 2 * 1024 * 1024;
    const MAX_PAGES: u64 = 50;
    const FINGERPRINT_CHUNK: usize = 50;
    /// Wings calls in flight at once while hashing.
    const CONCURRENCY: usize = 4;
    /// Jars above this size are not hashed (no mod is this large; it protects the node).
    const MAX_HASH_SIZE: u64 = 256 * 1024 * 1024;
    /// Seconds hashes stay cached per server, keyed by name, size and modification time.
    const HASH_CACHE_TTL: u64 = 24 * 60 * 60;
    const DISABLED_SUFFIX: &str = ".disabled";

    #[derive(ToSchema, Serialize)]
    struct Mod {
        file_name: compact_str::CompactString,
        enabled: bool,
        size: u64,
        modified: chrono::DateTime<chrono::Utc>,
        sha1: Option<compact_str::CompactString>,
        /// CurseForge (murmur2) fingerprint.
        fingerprint: Option<u64>,
        /// Too large to hash.
        too_large: bool,
    }

    #[derive(ToSchema, Serialize)]
    struct PackFile {
        path: String,
        sha1: Option<String>,
        source: Option<String>,
        project_id: Option<String>,
        file_id: Option<String>,
    }

    /// The modpack marker another tool may leave in the server root (`/.modpack-installer.json`).
    #[derive(ToSchema, Serialize)]
    struct PackMarker {
        name: Option<String>,
        version_name: Option<String>,
        source: Option<String>,
        project_id: Option<String>,
        installed_at: Option<String>,
        /// Files the pack placed under `mods/`; absent in older markers.
        files: Option<Vec<PackFile>>,
    }

    #[derive(ToSchema, Serialize)]
    struct Response {
        mods: Vec<Mod>,
        pack: Option<PackMarker>,
    }

    #[derive(Serialize, Deserialize, Clone)]
    struct CachedHash {
        size: u64,
        modified: i64,
        sha1: Option<String>,
        fingerprint: Option<u64>,
    }

    fn is_mod_file(name: &str) -> bool {
        let name = name.to_ascii_lowercase();
        name.ends_with(".jar") || name.ends_with(".jar.disabled")
    }

    fn is_disabled(name: &str) -> bool {
        name.to_ascii_lowercase().ends_with(DISABLED_SUFFIX)
    }

    fn sort_key(name: &str) -> String {
        let mut key = name.to_lowercase();
        if key.ends_with(DISABLED_SUFFIX) {
            key.truncate(key.len() - DISABLED_SUFFIX.len());
        }
        key
    }

    fn mod_path(file_name: &str) -> compact_str::CompactString {
        compact_str::format_compact!("{MODS_DIRECTORY}/{file_name}")
    }

    /// A string, or a number written as one (ids are strings, but be lenient).
    fn text(value: &Value, key: &str) -> Option<String> {
        match value.get(key)? {
            Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        }
    }

    fn parse_marker(content: &str) -> Option<PackMarker> {
        let value: Value = serde_json::from_str(content).ok()?;
        if !value.is_object() {
            return None;
        }
        let files = value.get("files").and_then(Value::as_array).map(|files| {
            files
                .iter()
                .filter_map(|file| {
                    Some(PackFile {
                        path: text(file, "path")?,
                        sha1: text(file, "sha1").map(|sha1| sha1.to_ascii_lowercase()),
                        source: text(file, "source"),
                        project_id: text(file, "project_id"),
                        file_id: text(file, "file_id"),
                    })
                })
                .collect()
        });

        Some(PackMarker {
            name: text(&value, "name"),
            version_name: text(&value, "version_name"),
            source: text(&value, "source"),
            project_id: text(&value, "project_id"),
            installed_at: text(&value, "installed_at"),
            files,
        })
    }

    /// Hashes `paths` with one algorithm in chunks, a few Wings calls at a time.
    async fn fingerprints(
        client: &wings_api::client::WingsClient,
        server: uuid::Uuid,
        paths: &[compact_str::CompactString],
        ignored: &Option<Vec<compact_str::CompactString>>,
        algorithm: wings_api::Algorithm,
    ) -> HashMap<compact_str::CompactString, compact_str::CompactString> {
        let mut hashes = HashMap::new();
        let chunks: Vec<&[compact_str::CompactString]> = paths.chunks(FINGERPRINT_CHUNK).collect();
        for group in chunks.chunks(CONCURRENCY) {
            let mut calls = Vec::with_capacity(group.len());
            for chunk in group {
                let query = wings_api::servers_server_files_fingerprints::get::Query {
                    algorithm: Some(algorithm),
                    files: Some(chunk.to_vec()),
                    ignored: ignored.clone(),
                    ..Default::default()
                };
                calls.push(async move {
                    client
                        .get_servers_server_files_fingerprints(server, &query)
                        .await
                });
            }
            for result in futures_util::future::join_all(calls).await {
                match result {
                    Ok(response) => hashes.extend(response.fingerprints),
                    Err(err) => tracing::warn!(%server, "failed to fingerprint mods: {err:?}"),
                }
            }
        }
        hashes
    }

    /// The hash Wings reported for `path`, also accepting keys with a leading slash.
    fn lookup<'a>(
        hashes: &'a HashMap<compact_str::CompactString, compact_str::CompactString>,
        path: &str,
    ) -> Option<&'a compact_str::CompactString> {
        hashes.get(path).or_else(|| {
            hashes
                .iter()
                .find(|(key, _)| key.trim_start_matches('/') == path)
                .map(|(_, hash)| hash)
        })
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
        (status = UNAUTHORIZED, body = ApiError),
    ), params(
        (
            "server" = uuid::Uuid,
            description = "The server ID",
            example = "123e4567-e89b-12d3-a456-426614174000",
        ),
    ))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        mut server: GetServer,
    ) -> ApiResponseResult {
        permissions.has_server_permission("files.read")?;

        let read_content = permissions
            .has_server_permission("files.read-content")
            .is_ok();
        let read_marker = read_content && !server.is_ignored(MODPACK_MARKER, false);

        if server.is_ignored(MODS_DIRECTORY, true) {
            return ApiResponse::new_serialized(Response {
                mods: Vec::new(),
                pack: None,
            })
            .ok();
        }

        let client = server
            .node
            .fetch_cached(&state.database)
            .await?
            .api_client(&state.database)
            .await?;
        let ignored = server.0.subuser_ignored_files.clone();

        let (entries, marker) = tokio::join!(
            list_directory(
                &client,
                server.uuid,
                MODS_DIRECTORY,
                ignored.clone(),
                MAX_PAGES,
            ),
            async {
                if !read_marker {
                    return None;
                }
                read_file(
                    &client,
                    server.uuid,
                    MODPACK_MARKER,
                    ignored.clone(),
                    MAX_MARKER_SIZE,
                )
                .await
            },
        );

        let mut mods = entries?
            .unwrap_or_default()
            .into_iter()
            .filter(|entry| entry.file && !entry.directory && is_mod_file(&entry.name))
            .map(|entry| Mod {
                enabled: !is_disabled(&entry.name),
                too_large: entry.size > MAX_HASH_SIZE,
                file_name: entry.name,
                size: entry.size,
                modified: entry.modified.to_utc(),
                sha1: None,
                fingerprint: None,
            })
            .collect::<Vec<_>>();

        mods.sort_by_cached_key(|m| (sort_key(&m.file_name), m.file_name.clone()));

        if read_content {
            let cache_key = format!("modinstaller::hashes::{}", server.uuid);
            let mut cache: HashMap<String, CachedHash> = match state.cache.get_raw(&cache_key).await
            {
                Ok(Some(bytes)) => serde_json::from_slice(&bytes).unwrap_or_default(),
                Ok(None) => HashMap::new(),
                Err(err) => {
                    tracing::warn!(server = %server.uuid, "failed to read the hash cache: {err:#}");
                    HashMap::new()
                }
            };

            let current = |m: &Mod, cached: &CachedHash| {
                cached.size == m.size && cached.modified == m.modified.timestamp()
            };
            let missing: Vec<compact_str::CompactString> = mods
                .iter()
                .filter(|m| !m.too_large)
                .filter(|m| {
                    !cache
                        .get(m.file_name.as_str())
                        .is_some_and(|cached| current(m, cached))
                })
                .map(|m| mod_path(&m.file_name))
                .collect();

            if !missing.is_empty() {
                let (sha1_hashes, curseforge_hashes) = tokio::join!(
                    fingerprints(
                        &client,
                        server.uuid,
                        &missing,
                        &ignored,
                        wings_api::Algorithm::Sha1,
                    ),
                    fingerprints(
                        &client,
                        server.uuid,
                        &missing,
                        &ignored,
                        wings_api::Algorithm::Curseforge,
                    ),
                );
                for m in mods.iter().filter(|m| !m.too_large) {
                    let path = mod_path(&m.file_name);
                    if !missing.contains(&path) {
                        continue;
                    }
                    let sha1 = lookup(&sha1_hashes, &path)
                        .map(|hash| hash.as_str().to_ascii_lowercase())
                        .filter(|hash| hash.len() == 40);
                    let fingerprint: Option<u64> = lookup(&curseforge_hashes, &path)
                        .and_then(|value| value.trim().parse().ok());
                    // A failed call is not cached, so the next load tries again.
                    if sha1.is_some() || fingerprint.is_some() {
                        cache.insert(
                            m.file_name.to_string(),
                            CachedHash {
                                size: m.size,
                                modified: m.modified.timestamp(),
                                sha1,
                                fingerprint,
                            },
                        );
                    }
                }

                // Keep the cache to what the folder holds now.
                let listed: std::collections::HashSet<&str> =
                    mods.iter().map(|m| m.file_name.as_str()).collect();
                cache.retain(|name, _| listed.contains(name.as_str()));
                match serde_json::to_vec(&cache) {
                    Ok(bytes) => {
                        if let Err(err) =
                            state.cache.set_raw(&cache_key, HASH_CACHE_TTL, bytes).await
                        {
                            tracing::warn!(server = %server.uuid, "failed to store the hash cache: {err:#}");
                        }
                    }
                    Err(err) => tracing::warn!("failed to encode the hash cache: {err}"),
                }
            }

            for m in &mut mods {
                if let Some(cached) = cache.get(m.file_name.as_str())
                    && cached.size == m.size
                    && cached.modified == m.modified.timestamp()
                {
                    m.sha1 = cached.sha1.as_deref().map(compact_str::CompactString::from);
                    m.fingerprint = cached.fingerprint;
                }
            }
        }

        ApiResponse::new_serialized(Response {
            mods,
            pack: marker.as_deref().and_then(parse_marker),
        })
        .ok()
    }

    #[cfg(test)]
    mod tests {
        use super::parse_marker;

        #[test]
        fn markers_with_and_without_files() {
            let marker = parse_marker(
                r#"{"source":"modrinth","project_id":"1KVo5zza","name":"Fabulously Optimized",
                "version_name":"6.4.0","installed_at":"2026-11-01T10:00:00Z","files":[
                {"path":"mods/sodium.jar","sha1":"ABCDEF","source":"modrinth","project_id":"AANobbMI","file_id":"x1"},
                {"path":"mods/override.jar","sha1":"0123","source":"override","project_id":null,"file_id":null},
                {"sha1":"no path"}
                ]}"#,
            )
            .unwrap();
            assert_eq!(marker.name.as_deref(), Some("Fabulously Optimized"));
            let files = marker.files.unwrap();
            assert_eq!(files.len(), 2);
            assert_eq!(files[0].sha1.as_deref(), Some("abcdef"));
            assert_eq!(files[1].project_id, None);

            let old = parse_marker(r#"{"name":"Pack","project_id":394468}"#).unwrap();
            assert!(old.files.is_none());
            assert_eq!(old.project_id.as_deref(), Some("394468"));

            assert!(parse_marker("[]").is_none());
            assert!(parse_marker("nope").is_none());
        }
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(get::route))
        .with_state(state.clone())
}
