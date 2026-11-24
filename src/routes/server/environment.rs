use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod get {
    use crate::{
        detect::{self, DirEntry, Inputs},
        wings::{list_directory, newest_entries, read_file},
    };
    use serde::Serialize;
    use shared::{
        ApiError, GetState,
        models::{server::GetServer, server_variable::ServerVariable, user::GetPermissionManager},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    const LOG_LINES: u64 = 400;
    const ROOT_MAX_PAGES: u64 = 10;
    const SMALL_MAX_PAGES: u64 = 2;
    const LIBRARY_MAX_PAGES: u64 = 5;
    const MAX_ARGS_SIZE: u64 = 256 * 1024;
    const MAX_SMALL_FILE: u64 = 64 * 1024;
    const MAX_OVERRIDE_SIZE: u64 = 16 * 1024;
    /// The modpack marker may carry a list of every pack file.
    const MAX_MODPACK_MARKER: u64 = 2 * 1024 * 1024;

    const CONFIG: &str = "config";
    const LOGS: &str = "logs";
    const FABRIC_INTERMEDIARY: &str = "libraries/net/fabricmc/intermediary";
    const FABRIC_LOADER: &str = "libraries/net/fabricmc/fabric-loader";
    const QUILT_LOADER: &str = "libraries/org/quiltmc/quilt-loader";
    const FORGE: &str = "libraries/net/minecraftforge/forge";
    const NEOFORGE: &str = "libraries/net/neoforged/neoforge";
    const NEOFORGED_FORGE: &str = "libraries/net/neoforged/forge";
    const VERSIONS: &str = "versions";

    #[derive(ToSchema, Serialize)]
    struct Response {
        environment: detect::Detection,
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

        // File contents (log, launch scripts, markers, the override) need read-content, like the
        // panel's own file routes; listings only need read.
        let read_content = permissions
            .has_server_permission("files.read-content")
            .is_ok();
        let mut readable =
            |path: &'static str| (read_content && !server.is_ignored(path, false)).then_some(path);
        let files = [
            readable(detect::LATEST_LOG),
            readable(detect::VERSION_HISTORY),
            readable(detect::UNIX_ARGS),
            readable(detect::RUN_SH),
            readable(detect::MCVC_MARKER),
            readable(detect::MODPACK_MARKER),
            readable(detect::OVERRIDE_FILE),
        ];
        let mut listable =
            |directory: &'static str| (!server.is_ignored(directory, true)).then_some(directory);
        let directories = [
            listable(CONFIG),
            listable(LOGS),
            listable(FABRIC_INTERMEDIARY),
            listable(FABRIC_LOADER),
            listable(QUILT_LOADER),
            listable(FORGE),
            listable(NEOFORGE),
            listable(NEOFORGED_FORGE),
            listable(VERSIONS),
        ];

        let client = server
            .node
            .fetch_cached(&state.database)
            .await?
            .api_client(&state.database)
            .await?;
        let (server_uuid, egg_uuid) = (server.uuid, server.egg.uuid);
        let ignored = server.0.subuser_ignored_files.clone();

        let max_view_size = state
            .settings
            .get_as(|s| s.server.max_file_manager_view_size)
            .await?;

        let latest_log = async {
            let file = files[0]?;
            match client
                .get_servers_server_files_lines(
                    server_uuid,
                    &wings_api::servers_server_files_lines::get::Query {
                        file: Some(file.into()),
                        start_line: Some(1),
                        end_line: Some(LOG_LINES),
                        max_size: Some(max_view_size),
                        ignored: ignored.clone(),
                        ..Default::default()
                    },
                )
                .await
            {
                Ok(lines) => Some(String::from(lines.content)),
                Err(err) => {
                    tracing::debug!(server = %server_uuid, "failed to read {file}: {err:?}");
                    None
                }
            }
        };
        let read = |file: Option<&'static str>, max_size: u64| {
            let (client, ignored) = (&client, ignored.clone());
            async move { read_file(client, server_uuid, file?, ignored, max_size).await }
        };
        let list = |directory: Option<&'static str>, max_pages: u64| {
            let (client, ignored) = (&client, ignored.clone());
            async move {
                let directory = directory?;
                match list_directory(client, server_uuid, directory, ignored, max_pages).await {
                    Ok(entries) => entries.map(dir_entries),
                    Err(err) => {
                        tracing::debug!(server = %server_uuid, directory, "failed to list: {err:?}");
                        None
                    }
                }
            }
        };
        let logs = async {
            let directory = directories[1]?;
            match newest_entries(&client, server_uuid, directory, ignored.clone()).await {
                Ok(entries) => entries.map(dir_entries),
                Err(err) => {
                    tracing::debug!(server = %server_uuid, "failed to list {directory}: {err:?}");
                    None
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
                // Only what the panel would show the user on the Startup page, and never secrets.
                Ok(variables) => variables
                    .into_iter()
                    .filter(|variable| variable.variable.user_viewable && !variable.variable.secret)
                    .map(|variable| (variable.variable.env_variable.into(), variable.value))
                    .collect(),
                Err(err) => {
                    tracing::warn!(server = %server_uuid, "failed to load server variables: {err:?}");
                    Vec::new()
                }
            }
        };

        let (
            (latest_log, version_history, unix_args, run_sh, mcvc_marker, modpack_marker),
            override_file,
            root,
            variables,
            (config, logs),
            (fabric_intermediary, fabric_loader, quilt_loader, forge),
            (neoforge, neoforged_forge, versions),
        ) = tokio::join!(
            async {
                tokio::join!(
                    latest_log,
                    read(files[1], MAX_SMALL_FILE),
                    read(files[2], MAX_ARGS_SIZE),
                    read(files[3], MAX_ARGS_SIZE),
                    read(files[4], MAX_SMALL_FILE),
                    read(files[5], MAX_MODPACK_MARKER),
                )
            },
            read(files[6], MAX_OVERRIDE_SIZE),
            list_directory(&client, server_uuid, "/", ignored.clone(), ROOT_MAX_PAGES),
            variables,
            async { tokio::join!(list(directories[0], SMALL_MAX_PAGES), logs) },
            async {
                tokio::join!(
                    list(directories[2], LIBRARY_MAX_PAGES),
                    list(directories[3], LIBRARY_MAX_PAGES),
                    list(directories[4], LIBRARY_MAX_PAGES),
                    list(directories[5], LIBRARY_MAX_PAGES),
                )
            },
            async {
                tokio::join!(
                    list(directories[6], LIBRARY_MAX_PAGES),
                    list(directories[7], LIBRARY_MAX_PAGES),
                    list(directories[8], LIBRARY_MAX_PAGES),
                )
            },
        );

        // Second round: the argument file `run.sh` starts, and the newest `versions/<v>/` folder.
        let argfile_path = run_sh
            .as_deref()
            .and_then(detect::referenced_args_file)
            .filter(|path| read_content && !server.is_ignored(path, false));
        let newest_version = versions.as_ref().and_then(|versions| {
            versions
                .iter()
                .filter(|entry| entry.directory && detect::is_valid_version(&entry.name))
                .max_by_key(|entry| entry.modified)
                .map(|entry| entry.name.clone())
        });
        let version_directory = newest_version
            .map(|version| format!("{VERSIONS}/{version}"))
            .filter(|directory| !server.is_ignored(directory, true));
        let ignored = server.0.subuser_ignored_files.clone();

        let (argfile, version_jars) = tokio::join!(
            async {
                let path = argfile_path?;
                let content =
                    read_file(&client, server_uuid, &path, ignored.clone(), MAX_ARGS_SIZE).await?;
                Some((path, content))
            },
            async {
                let directory = version_directory?;
                let entries = list_directory(
                    &client,
                    server_uuid,
                    &directory,
                    ignored.clone(),
                    SMALL_MAX_PAGES,
                )
                .await
                .ok()??;
                let name = directory.trim_start_matches("versions/").to_string();
                Some((name, dir_entries(entries)))
            },
        );

        let inputs = Inputs {
            root: root?.map(dir_entries).unwrap_or_default(),
            config,
            logs,
            latest_log,
            version_history,
            unix_args,
            run_sh,
            argfile,
            mcvc_marker,
            modpack_marker,
            override_file,
            fabric_intermediary,
            fabric_loader,
            quilt_loader,
            forge,
            neoforge,
            neoforged_forge,
            versions,
            version_jars,
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
