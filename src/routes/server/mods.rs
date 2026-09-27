use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod get {
    use crate::wings::list_directory;
    use serde::Serialize;
    use shared::{
        ApiError, GetState,
        models::{server::GetServer, user::GetPermissionManager},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    const MODS_DIRECTORY: &str = "mods";
    const MAX_PAGES: u64 = 50;
    const FINGERPRINT_CHUNK: usize = 50;
    const DISABLED_SUFFIX: &str = ".disabled";

    #[derive(ToSchema, Serialize)]
    struct Mod {
        file_name: compact_str::CompactString,
        enabled: bool,
        size: u64,
        modified: chrono::DateTime<chrono::Utc>,
        sha1: Option<compact_str::CompactString>,
    }

    #[derive(ToSchema, Serialize)]
    struct Response {
        mods: Vec<Mod>,
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

        if server.is_ignored(MODS_DIRECTORY, true) {
            return ApiResponse::new_serialized(Response { mods: Vec::new() }).ok();
        }

        let client = server
            .node
            .fetch_cached(&state.database)
            .await?
            .api_client(&state.database)
            .await?;

        let entries = list_directory(
            &client,
            server.uuid,
            MODS_DIRECTORY,
            server.0.subuser_ignored_files.clone(),
            MAX_PAGES,
        )
        .await?
        .unwrap_or_default();

        let mut mods = entries
            .into_iter()
            .filter(|entry| entry.file && !entry.directory && is_mod_file(&entry.name))
            .map(|entry| Mod {
                enabled: !is_disabled(&entry.name),
                file_name: entry.name,
                size: entry.size,
                modified: entry.modified.to_utc(),
                sha1: None,
            })
            .collect::<Vec<_>>();

        mods.sort_by_cached_key(|m| (sort_key(&m.file_name), m.file_name.clone()));

        if permissions
            .has_server_permission("files.read-content")
            .is_ok()
        {
            let ignored = &server.0.subuser_ignored_files;
            let (client, server_uuid) = (&client, server.uuid);
            let chunks = mods.chunks(FINGERPRINT_CHUNK).map(|chunk| {
                let query = wings_api::servers_server_files_fingerprints::get::Query {
                    algorithm: Some(wings_api::Algorithm::Sha1),
                    files: Some(chunk.iter().map(|m| mod_path(&m.file_name)).collect()),
                    ignored: ignored.clone(),
                    ..Default::default()
                };

                async move {
                    client
                        .get_servers_server_files_fingerprints(server_uuid, &query)
                        .await
                }
            });
            let results = futures_util::future::join_all(chunks).await;

            for (chunk, result) in mods.chunks_mut(FINGERPRINT_CHUNK).zip(results) {
                let fingerprints = match result {
                    Ok(response) => response.fingerprints,
                    Err(err) => {
                        tracing::warn!(
                            server = %server.uuid,
                            "failed to fingerprint mods: {err:?}"
                        );
                        continue;
                    }
                };

                for m in chunk {
                    let path = mod_path(&m.file_name);
                    m.sha1 = fingerprints.get(&path).cloned().or_else(|| {
                        fingerprints
                            .iter()
                            .find(|(key, _)| key.rsplit('/').next() == Some(m.file_name.as_str()))
                            .map(|(_, hash)| hash.clone())
                    });
                }
            }
        }

        ApiResponse::new_serialized(Response { mods }).ok()
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(get::route))
        .with_state(state.clone())
}
