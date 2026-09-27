use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod get {
    use crate::{
        detect::{self, DirEntry, Environment, Inputs},
        wings::list_directory,
    };
    use serde::Serialize;
    use shared::{
        ApiError, GetState,
        models::{server::GetServer, server_variable::ServerVariable, user::GetPermissionManager},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    const LATEST_LOG: &str = "logs/latest.log";
    const LOG_LINES: u64 = 400;
    const ROOT_MAX_PAGES: u64 = 10;
    const LIBRARY_MAX_PAGES: u64 = 5;

    const FABRIC_INTERMEDIARY: &str = "libraries/net/fabricmc/intermediary";
    const FABRIC_LOADER: &str = "libraries/net/fabricmc/fabric-loader";
    const QUILT_LOADER: &str = "libraries/org/quiltmc/quilt-loader";
    const FORGE: &str = "libraries/net/minecraftforge/forge";
    const NEOFORGE: &str = "libraries/net/neoforged/neoforge";
    const NEOFORGED_FORGE: &str = "libraries/net/neoforged/forge";
    const VERSIONS: &str = "versions";

    #[derive(ToSchema, Serialize)]
    struct Response {
        environment: Environment,
    }

    fn dir_entries(entries: Vec<wings_api::DirectoryEntry>) -> Vec<DirEntry> {
        entries
            .into_iter()
            .map(|entry| DirEntry {
                name: entry.name.into(),
                directory: entry.directory,
                modified: entry.modified.to_utc(),
            })
            .collect()
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

        let read_log = permissions
            .has_server_permission("files.read-content")
            .is_ok()
            && !server.is_ignored(LATEST_LOG, false);
        let mut allowed =
            |directory: &'static str| (!server.is_ignored(directory, true)).then_some(directory);
        let libraries = [
            allowed(FABRIC_INTERMEDIARY),
            allowed(FABRIC_LOADER),
            allowed(QUILT_LOADER),
            allowed(FORGE),
            allowed(NEOFORGE),
            allowed(NEOFORGED_FORGE),
            allowed(VERSIONS),
        ];

        let client = server
            .node
            .fetch_cached(&state.database)
            .await?
            .api_client(&state.database)
            .await?;
        let (server_uuid, egg_uuid) = (server.uuid, server.egg.uuid);
        let ignored = &server.0.subuser_ignored_files;

        let latest_log = async {
            if !read_log {
                return None;
            }

            let max_size = match state
                .settings
                .get_as(|s| s.server.max_file_manager_view_size)
                .await
            {
                Ok(max_size) => max_size,
                Err(err) => {
                    tracing::warn!(server = %server_uuid, "failed to read settings: {err:?}");
                    return None;
                }
            };

            match client
                .get_servers_server_files_lines(
                    server_uuid,
                    &wings_api::servers_server_files_lines::get::Query {
                        file: Some(LATEST_LOG.into()),
                        start_line: Some(1),
                        end_line: Some(LOG_LINES),
                        max_size: Some(max_size),
                        ignored: ignored.clone(),
                        ..Default::default()
                    },
                )
                .await
            {
                Ok(lines) => Some(String::from(lines.content)),
                Err(err) => {
                    tracing::debug!(server = %server_uuid, "failed to read {LATEST_LOG}: {err:?}");
                    None
                }
            }
        };

        let list_library = |directory: Option<&'static str>| {
            let client = &client;
            async move {
                let directory = directory?;
                match list_directory(
                    client,
                    server_uuid,
                    directory,
                    ignored.clone(),
                    LIBRARY_MAX_PAGES,
                )
                .await
                {
                    Ok(entries) => entries.map(dir_entries),
                    Err(err) => {
                        tracing::debug!(server = %server_uuid, directory, "failed to list: {err:?}");
                        None
                    }
                }
            }
        };

        let variables = async {
            match ServerVariable::all_by_server_uuid_egg_uuid(
                &state.database,
                server_uuid,
                egg_uuid,
            )
            .await
            {
                Ok(variables) => variables
                    .into_iter()
                    .filter(|variable| !variable.variable.secret)
                    .map(|variable| (variable.variable.env_variable.into(), variable.value))
                    .collect(),
                Err(err) => {
                    tracing::warn!(server = %server_uuid, "failed to load server variables: {err:?}");
                    Vec::new()
                }
            }
        };

        let [
            fabric_intermediary,
            fabric_loader,
            quilt_loader,
            forge,
            neoforge,
            neoforged_forge,
            versions,
        ] = libraries;

        let (
            latest_log,
            root,
            variables,
            fabric_intermediary,
            fabric_loader,
            quilt_loader,
            forge,
            neoforge,
            neoforged_forge,
            versions,
        ) = tokio::join!(
            latest_log,
            list_directory(&client, server_uuid, "/", ignored.clone(), ROOT_MAX_PAGES),
            variables,
            list_library(fabric_intermediary),
            list_library(fabric_loader),
            list_library(quilt_loader),
            list_library(forge),
            list_library(neoforge),
            list_library(neoforged_forge),
            list_library(versions),
        );

        let inputs = Inputs {
            latest_log,
            root: root?.map(dir_entries).unwrap_or_default(),
            fabric_intermediary,
            fabric_loader,
            quilt_loader,
            forge,
            neoforge,
            neoforged_forge,
            versions,
            variables,
            egg_name: server.egg.name.to_string(),
            nest_name: server.nest.name.to_string(),
            startup: server.startup.to_string(),
            image: server.image.to_string(),
        };

        ApiResponse::new_serialized(Response {
            environment: detect::detect(&inputs),
        })
        .ok()
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(get::route))
        .with_state(state.clone())
}
