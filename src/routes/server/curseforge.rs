//! `/api/client/servers/{server}/mod-installer/curseforge/...`: CurseForge lookups for the Mods
//! pages. Every route checks the permission first, then the user's own rate limit, then the
//! input, and only then spends CurseForge quota (through the cache).

use super::State;
use shared::{
    models::user::{PermissionManager, User},
    response::ApiResponse,
};
use utoipa_axum::{router::OpenApiRouter, routes};

/// Browsing needs what the Mods page needs.
const BROWSE_PERMISSION: &str = "files.read";
/// Identifying installed jars works on their hashes, which need read-content.
const IDENTIFY_PERMISSION: &str = "files.read-content";
const BROWSE_LIMIT: u64 = 120;
const IDENTIFY_LIMIT: u64 = 20;

/// Checks access and the rate limit, and returns the CurseForge key.
async fn authorize(
    state: &State,
    permissions: &PermissionManager,
    user: &User,
    permission: &str,
    limit: u64,
) -> Result<String, ApiResponse> {
    super::authorize(state, permissions, user, permission, "curseforge", limit).await?;
    crate::settings::curseforge_key(state)
        .await?
        .ok_or_else(|| {
            ApiResponse::error("CurseForge is not configured on this panel")
                .with_status(axum::http::StatusCode::SERVICE_UNAVAILABLE)
        })
}

fn bad_request(errors: Vec<String>) -> ApiResponse {
    ApiResponse::new_serialized(shared::ApiError::new_strings_value(errors))
        .with_status(axum::http::StatusCode::BAD_REQUEST)
}

fn filled(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// `modLoaderType`s of a comma separated loader list; unknown names are an error.
fn loader_types(loaders: Option<&str>) -> Result<Vec<i64>, ApiResponse> {
    loaders
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|loader| !loader.is_empty())
        .map(|loader| {
            crate::curseforge::model::loader_type(loader)
                .ok_or_else(|| bad_request(vec![format!("unknown mod loader {loader}")]))
        })
        .collect()
}

mod status {
    use serde::Serialize;
    use shared::{
        ApiError, GetState,
        models::user::{GetPermissionManager, GetUser},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    #[derive(ToSchema, Serialize)]
    struct Response {
        /// Whether CurseForge can be used as a mod source.
        curseforge: bool,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
        (status = UNAUTHORIZED, body = ApiError),
    ), params(("server" = uuid::Uuid, description = "The server ID")))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        user: GetUser,
    ) -> ApiResponseResult {
        super::super::authorize(
            &state,
            &permissions,
            &user,
            super::BROWSE_PERMISSION,
            "curseforge",
            super::BROWSE_LIMIT,
        )
        .await?;

        ApiResponse::new_serialized(Response {
            curseforge: crate::settings::curseforge_key(&state).await?.is_some(),
        })
        .ok()
    }
}

mod search {
    use crate::curseforge::{SearchQuery, SortMode, model::ModSummary};
    use axum::extract::Query;
    use garde::Validate;
    use serde::{Deserialize, Serialize};
    use shared::{
        ApiError, GetState,
        models::{
            Pagination,
            user::{GetPermissionManager, GetUser},
        },
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::{IntoParams, ToSchema};

    fn default_per_page() -> i64 {
        20
    }

    #[derive(ToSchema, IntoParams, Validate, Deserialize)]
    #[into_params(parameter_in = Query)]
    pub struct Params {
        #[garde(range(min = 1))]
        #[serde(default = "Pagination::default_page")]
        page: i64,
        #[garde(range(min = 1, max = 50))]
        #[serde(default = "default_per_page")]
        per_page: i64,
        #[garde(length(chars, max = 128))]
        query: Option<String>,
        /// `fabric`, `quilt`, `forge` or `neoforge`.
        #[garde(length(chars, max = 16))]
        loader: Option<String>,
        #[garde(length(chars, max = 32))]
        game_version: Option<String>,
        #[garde(length(chars, max = 32))]
        category: Option<String>,
        #[garde(skip)]
        #[serde(default)]
        sort: SortMode,
    }

    #[derive(ToSchema, Serialize)]
    struct Response {
        #[schema(inline)]
        mods: Pagination<ModSummary>,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
        (status = BAD_REQUEST, body = ApiError),
        (status = UNAUTHORIZED, body = ApiError),
        (status = TOO_MANY_REQUESTS, body = ApiError),
        (status = SERVICE_UNAVAILABLE, body = ApiError),
    ), params(("server" = uuid::Uuid, description = "The server ID"), Params))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        user: GetUser,
        Query(params): Query<Params>,
    ) -> ApiResponseResult {
        let key = super::authorize(
            &state,
            &permissions,
            &user,
            super::BROWSE_PERMISSION,
            super::BROWSE_LIMIT,
        )
        .await?;
        if let Err(errors) = shared::utils::validate_data(&params) {
            return ApiResponse::new_serialized(ApiError::new_strings_value(errors))
                .with_status(axum::http::StatusCode::BAD_REQUEST)
                .ok();
        }

        let loader = match super::loader_types(params.loader.as_deref())?.as_slice() {
            [] => None,
            [loader] => Some(*loader),
            _ => return Err(super::bad_request(vec!["only one mod loader".to_string()])),
        };
        let category = super::filled(params.category)
            .map(|category| crate::curseforge::parse_id(&category))
            .transpose()?;

        let mods = crate::curseforge::search(
            &state,
            &key,
            SearchQuery {
                query: super::filled(params.query),
                loader,
                game_version: super::filled(params.game_version),
                category,
                sort: params.sort,
                page: params.page,
                per_page: params.per_page,
            },
        )
        .await?;

        ApiResponse::new_serialized(Response { mods }).ok()
    }
}

mod categories {
    use crate::curseforge::model::Category;
    use serde::Serialize;
    use shared::{
        ApiError, GetState,
        models::user::{GetPermissionManager, GetUser},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    #[derive(ToSchema, Serialize)]
    struct Response {
        #[schema(inline)]
        categories: Vec<Category>,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
        (status = UNAUTHORIZED, body = ApiError),
        (status = TOO_MANY_REQUESTS, body = ApiError),
        (status = SERVICE_UNAVAILABLE, body = ApiError),
    ), params(("server" = uuid::Uuid, description = "The server ID")))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        user: GetUser,
    ) -> ApiResponseResult {
        let key = super::authorize(
            &state,
            &permissions,
            &user,
            super::BROWSE_PERMISSION,
            super::BROWSE_LIMIT,
        )
        .await?;
        let categories = crate::curseforge::categories(&state, &key).await?;

        ApiResponse::new_serialized(Response { categories }).ok()
    }
}

mod projects {
    use crate::curseforge::model::ModSummary;
    use axum::extract::Query;
    use serde::{Deserialize, Serialize};
    use shared::{
        ApiError, GetState,
        models::user::{GetPermissionManager, GetUser},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::{IntoParams, ToSchema};

    const MAX_IDS: usize = 50;

    #[derive(IntoParams, Deserialize)]
    #[into_params(parameter_in = Query)]
    pub struct Params {
        /// Comma separated CurseForge project ids (at most 50).
        ids: String,
    }

    #[derive(ToSchema, Serialize)]
    struct Response {
        #[schema(inline)]
        projects: Vec<ModSummary>,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
        (status = BAD_REQUEST, body = ApiError),
        (status = UNAUTHORIZED, body = ApiError),
        (status = TOO_MANY_REQUESTS, body = ApiError),
        (status = SERVICE_UNAVAILABLE, body = ApiError),
    ), params(("server" = uuid::Uuid, description = "The server ID"), Params))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        user: GetUser,
        Query(params): Query<Params>,
    ) -> ApiResponseResult {
        let key = super::authorize(
            &state,
            &permissions,
            &user,
            super::BROWSE_PERMISSION,
            super::BROWSE_LIMIT,
        )
        .await?;
        let ids = params
            .ids
            .split(',')
            .filter(|id| !id.trim().is_empty())
            .map(crate::curseforge::parse_id)
            .collect::<Result<Vec<_>, _>>()?;
        if ids.len() > MAX_IDS {
            return Err(super::bad_request(vec![format!(
                "at most {MAX_IDS} projects at once"
            )]));
        }

        let projects = crate::curseforge::projects(&state, &key, &ids).await?;

        ApiResponse::new_serialized(Response { projects }).ok()
    }
}

mod project {
    use crate::curseforge::model::ModProject;
    use axum::extract::Path;
    use serde::Serialize;
    use shared::{
        ApiError, GetState,
        models::user::{GetPermissionManager, GetUser},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    #[derive(ToSchema, Serialize)]
    struct Response {
        #[schema(inline)]
        project: ModProject,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
        (status = UNAUTHORIZED, body = ApiError),
        (status = NOT_FOUND, body = ApiError),
        (status = TOO_MANY_REQUESTS, body = ApiError),
        (status = SERVICE_UNAVAILABLE, body = ApiError),
    ), params(
        ("server" = uuid::Uuid, description = "The server ID"),
        ("project" = String, description = "The CurseForge project ID", example = "394468"),
    ))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        user: GetUser,
        Path((_server, project)): Path<(String, String)>,
    ) -> ApiResponseResult {
        let key = super::authorize(
            &state,
            &permissions,
            &user,
            super::BROWSE_PERMISSION,
            super::BROWSE_LIMIT,
        )
        .await?;
        let id = crate::curseforge::parse_id(&project)?;
        let project = crate::curseforge::project(&state, &key, id).await?;

        ApiResponse::new_serialized(Response { project }).ok()
    }
}

mod files {
    use crate::curseforge::model::ModVersion;
    use axum::extract::{Path, Query};
    use serde::{Deserialize, Serialize};
    use shared::{
        ApiError, GetState,
        models::user::{GetPermissionManager, GetUser},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::{IntoParams, ToSchema};

    #[derive(IntoParams, Deserialize)]
    #[into_params(parameter_in = Query)]
    pub struct Params {
        /// Comma separated loaders (`fabric,quilt`); files for any of them are returned.
        loaders: Option<String>,
        /// Only files for this Minecraft version.
        game_version: Option<String>,
    }

    #[derive(ToSchema, Serialize)]
    struct Response {
        #[schema(inline)]
        files: Vec<ModVersion>,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
        (status = BAD_REQUEST, body = ApiError),
        (status = UNAUTHORIZED, body = ApiError),
        (status = NOT_FOUND, body = ApiError),
        (status = TOO_MANY_REQUESTS, body = ApiError),
        (status = SERVICE_UNAVAILABLE, body = ApiError),
    ), params(
        ("server" = uuid::Uuid, description = "The server ID"),
        ("project" = String, description = "The CurseForge project ID", example = "394468"),
        Params,
    ))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        user: GetUser,
        Path((_server, project)): Path<(String, String)>,
        Query(params): Query<Params>,
    ) -> ApiResponseResult {
        let key = super::authorize(
            &state,
            &permissions,
            &user,
            super::BROWSE_PERMISSION,
            super::BROWSE_LIMIT,
        )
        .await?;
        let id = crate::curseforge::parse_id(&project)?;
        // Validates the loader names; files list them by name.
        super::loader_types(params.loaders.as_deref())?;
        let loaders: Vec<String> = params
            .loaders
            .unwrap_or_default()
            .split(',')
            .map(|loader| loader.trim().to_ascii_lowercase())
            .filter(|loader| !loader.is_empty())
            .collect();
        let game_version = super::filled(params.game_version);

        let files = crate::curseforge::versions(&state, &key, id)
            .await?
            .into_iter()
            .filter(|file| {
                loaders.is_empty() || file.loaders.iter().any(|loader| loaders.contains(loader))
            })
            .filter(|file| {
                game_version
                    .as_ref()
                    .is_none_or(|version| file.game_versions.contains(version))
            })
            .collect();

        ApiResponse::new_serialized(Response { files }).ok()
    }
}

mod file {
    use crate::curseforge::model::ModVersion;
    use axum::extract::Path;
    use serde::Serialize;
    use shared::{
        ApiError, GetState,
        models::user::{GetPermissionManager, GetUser},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    #[derive(ToSchema, Serialize)]
    struct Response {
        #[schema(inline)]
        file: ModVersion,
    }

    #[utoipa::path(get, path = "/", responses(
        (status = OK, body = inline(Response)),
        (status = UNAUTHORIZED, body = ApiError),
        (status = NOT_FOUND, body = ApiError),
        (status = TOO_MANY_REQUESTS, body = ApiError),
        (status = SERVICE_UNAVAILABLE, body = ApiError),
    ), params(
        ("server" = uuid::Uuid, description = "The server ID"),
        ("project" = String, description = "The CurseForge project ID", example = "394468"),
        ("file" = String, description = "The CurseForge file ID", example = "5000001"),
    ))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        user: GetUser,
        Path((_server, project, file)): Path<(String, String, String)>,
    ) -> ApiResponseResult {
        let key = super::authorize(
            &state,
            &permissions,
            &user,
            super::BROWSE_PERMISSION,
            super::BROWSE_LIMIT,
        )
        .await?;
        let (project, file) = (
            crate::curseforge::parse_id(&project)?,
            crate::curseforge::parse_id(&file)?,
        );
        let file = crate::curseforge::version(&state, &key, project, file).await?;

        ApiResponse::new_serialized(Response { file }).ok()
    }
}

mod fingerprints {
    use crate::curseforge::FingerprintResult;
    use garde::Validate;
    use serde::Deserialize;
    use shared::{
        ApiError, GetState,
        models::user::{GetPermissionManager, GetUser},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    #[derive(ToSchema, Validate, Deserialize)]
    pub struct Payload {
        /// CurseForge (murmur2) fingerprints of mod jars, at most 500.
        #[garde(length(max = 500))]
        fingerprints: Vec<u64>,
        /// Loaders the server loads mods of; with `game_version`, matches carry their update.
        #[garde(length(max = 4), inner(length(chars, max = 16)))]
        #[serde(default)]
        loaders: Vec<String>,
        #[garde(length(chars, max = 32))]
        game_version: Option<String>,
    }

    #[utoipa::path(post, path = "/", responses(
        (status = OK, body = inline(FingerprintResult)),
        (status = BAD_REQUEST, body = ApiError),
        (status = UNAUTHORIZED, body = ApiError),
        (status = TOO_MANY_REQUESTS, body = ApiError),
        (status = SERVICE_UNAVAILABLE, body = ApiError),
    ), params(("server" = uuid::Uuid, description = "The server ID")), request_body = inline(Payload))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        user: GetUser,
        shared::Payload(data): shared::Payload<Payload>,
    ) -> ApiResponseResult {
        let key = super::authorize(
            &state,
            &permissions,
            &user,
            super::IDENTIFY_PERMISSION,
            super::IDENTIFY_LIMIT,
        )
        .await?;
        if let Err(errors) = shared::utils::validate_data(&data) {
            return ApiResponse::new_serialized(ApiError::new_strings_value(errors))
                .with_status(axum::http::StatusCode::BAD_REQUEST)
                .ok();
        }

        let loaders = super::loader_types(Some(data.loaders.join(",").as_str()))?;
        let game_version = super::filled(data.game_version);
        let result = crate::curseforge::match_fingerprints(
            &state,
            &key,
            &data.fingerprints,
            &loaders,
            game_version.as_deref(),
        )
        .await?;

        ApiResponse::new_serialized(result).ok()
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    let leaf = |router: OpenApiRouter<State>| router.with_state(state.clone());

    OpenApiRouter::new()
        .nest(
            "/status",
            leaf(OpenApiRouter::new().routes(routes!(status::route))),
        )
        .nest(
            "/search",
            leaf(OpenApiRouter::new().routes(routes!(search::route))),
        )
        .nest(
            "/categories",
            leaf(OpenApiRouter::new().routes(routes!(categories::route))),
        )
        .nest(
            "/fingerprints",
            leaf(OpenApiRouter::new().routes(routes!(fingerprints::route))),
        )
        .nest(
            "/summaries",
            leaf(OpenApiRouter::new().routes(routes!(projects::route))),
        )
        .nest(
            "/projects/{project}",
            leaf(OpenApiRouter::new().routes(routes!(project::route)).nest(
                "/files",
                leaf(OpenApiRouter::new().routes(routes!(files::route)).nest(
                    "/{file}",
                    leaf(OpenApiRouter::new().routes(routes!(file::route))),
                )),
            )),
        )
        .with_state(state.clone())
}
