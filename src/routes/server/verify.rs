//! `POST /api/client/servers/{server}/mod-installer/verify`: compares the hash of one file in
//! `mods/` with what the mod's source published, after the browser pulled or uploaded it.

use super::State;
use utoipa_axum::{router::OpenApiRouter, routes};

mod post {
    use axum::http::StatusCode;
    use garde::Validate;
    use serde::{Deserialize, Serialize};
    use shared::{
        ApiError, GetState,
        models::{
            server::GetServer,
            user::{GetPermissionManager, GetUser},
        },
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    const MODS_DIRECTORY: &str = "mods";
    const LIMIT: u64 = 30;

    #[derive(ToSchema, Deserialize, Clone, Copy)]
    #[serde(rename_all = "lowercase")]
    pub enum Algorithm {
        Sha1,
        Sha256,
        Sha512,
        /// CurseForge's murmur2 fingerprint, as a decimal number.
        Curseforge,
    }

    #[derive(ToSchema, Validate, Deserialize)]
    pub struct Payload {
        /// A file directly inside `mods/`.
        #[garde(length(chars, min = 1, max = 255))]
        file: String,
        #[garde(skip)]
        algorithm: Algorithm,
        /// The expected hash (hex) or CurseForge fingerprint (decimal).
        #[garde(length(chars, min = 1, max = 128))]
        expected: String,
    }

    #[derive(ToSchema, Serialize)]
    struct Response {
        matches: bool,
    }

    /// A single path segment without traversal, separators or control characters.
    pub fn single_segment(name: &str) -> bool {
        !name.is_empty()
            && name != "."
            && name != ".."
            && !name.contains(['/', '\\'])
            && !name.chars().any(char::is_control)
    }

    fn same(algorithm: Algorithm, actual: &str, expected: &str) -> bool {
        match algorithm {
            Algorithm::Curseforge => matches!(
                (actual.trim().parse::<u64>(), expected.trim().parse::<u64>()),
                (Ok(actual), Ok(expected)) if actual == expected
            ),
            _ => actual.trim().eq_ignore_ascii_case(expected.trim()),
        }
    }

    #[utoipa::path(post, path = "/", responses(
        (status = OK, body = inline(Response)),
        (status = BAD_REQUEST, body = ApiError),
        (status = UNAUTHORIZED, body = ApiError),
        (status = NOT_FOUND, body = ApiError),
        (status = TOO_MANY_REQUESTS, body = ApiError),
    ), params(
        (
            "server" = uuid::Uuid,
            description = "The server ID",
            example = "123e4567-e89b-12d3-a456-426614174000",
        ),
    ), request_body = inline(Payload))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        user: GetUser,
        mut server: GetServer,
        shared::Payload(data): shared::Payload<Payload>,
    ) -> ApiResponseResult {
        // Only someone who can place files in mods/ needs to check one.
        super::super::authorize(&state, &permissions, &user, "files.create", "verify", LIMIT)
            .await?;

        if let Err(errors) = shared::utils::validate_data(&data) {
            return ApiResponse::new_serialized(ApiError::new_strings_value(errors))
                .with_status(StatusCode::BAD_REQUEST)
                .ok();
        }
        if !single_segment(&data.file) {
            return ApiResponse::error("the file must be directly inside mods/")
                .with_status(StatusCode::BAD_REQUEST)
                .ok();
        }

        let path = format!("{MODS_DIRECTORY}/{}", data.file);
        if server.is_ignored(&path, false) {
            return ApiResponse::error("file not found")
                .with_status(StatusCode::NOT_FOUND)
                .ok();
        }

        let algorithm = match data.algorithm {
            Algorithm::Sha1 => wings_api::Algorithm::Sha1,
            Algorithm::Sha256 => wings_api::Algorithm::Sha256,
            Algorithm::Sha512 => wings_api::Algorithm::Sha512,
            Algorithm::Curseforge => wings_api::Algorithm::Curseforge,
        };
        let fingerprints = match server
            .node
            .fetch_cached(&state.database)
            .await?
            .api_client(&state.database)
            .await?
            .get_servers_server_files_fingerprints(
                server.uuid,
                &wings_api::servers_server_files_fingerprints::get::Query {
                    algorithm: Some(algorithm),
                    files: Some(vec![path.as_str().into()]),
                    ignored: server.0.subuser_ignored_files.clone(),
                    ..Default::default()
                },
            )
            .await
        {
            Ok(response) => response.fingerprints,
            Err(wings_api::client::ApiHttpError::Http(StatusCode::NOT_FOUND, _)) => {
                return ApiResponse::error("file not found")
                    .with_status(StatusCode::NOT_FOUND)
                    .ok();
            }
            Err(err) => return Err(err.into()),
        };

        let Some(actual) = fingerprints
            .get(path.as_str())
            .or_else(|| fingerprints.values().next())
        else {
            return ApiResponse::error("file not found")
                .with_status(StatusCode::NOT_FOUND)
                .ok();
        };

        ApiResponse::new_serialized(Response {
            matches: same(data.algorithm, actual, &data.expected),
        })
        .ok()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn names_and_hashes() {
            assert!(single_segment("sodium-fabric-0.6.13+mc1.21.1.jar"));
            assert!(single_segment(".mcmi-upload-abc.tmp"));
            for bad in [
                "",
                ".",
                "..",
                "../server.jar",
                "sub/a.jar",
                "a\\b.jar",
                "a\nb.jar",
            ] {
                assert!(!single_segment(bad), "{bad:?}");
            }

            assert!(same(Algorithm::Sha1, "ABCDEF", " abcdef"));
            assert!(!same(Algorithm::Sha512, "abc", "abd"));
            assert!(same(Algorithm::Curseforge, "3000000000", "3000000000"));
            assert!(!same(Algorithm::Curseforge, "3000000000", "x"));
        }
    }
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(post::route))
        .with_state(state.clone())
}
