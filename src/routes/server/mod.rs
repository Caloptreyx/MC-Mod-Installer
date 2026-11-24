use super::State;
use shared::{
    models::user::{PermissionManager, User},
    response::ApiResponse,
};
use utoipa_axum::router::OpenApiRouter;

mod curseforge;
mod environment;
mod mods;
mod verify;

/// Counts a request against the user's own limit for `bucket` (per minute).
async fn ratelimit(
    state: &State,
    user: &User,
    bucket: &str,
    limit: u64,
) -> Result<(), ApiResponse> {
    state
        .cache
        .ratelimit(
            format!("modinstaller/{bucket}"),
            limit,
            60,
            user.uuid.to_string(),
        )
        .await
}

/// Checks `permission`, then the user's rate limit for `bucket`.
async fn authorize(
    state: &State,
    permissions: &PermissionManager,
    user: &User,
    permission: &str,
    bucket: &str,
    limit: u64,
) -> Result<(), ApiResponse> {
    permissions.has_server_permission(permission)?;
    ratelimit(state, user, bucket, limit).await
}

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .nest("/environment", environment::router(state))
        .nest("/mods", mods::router(state))
        .nest("/verify", verify::router(state))
        .nest("/curseforge", curseforge::router(state))
        .with_state(state.clone())
}
