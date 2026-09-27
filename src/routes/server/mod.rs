use super::State;
use utoipa_axum::router::OpenApiRouter;

mod environment;
mod mods;

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .nest("/environment", environment::router(state))
        .nest("/mods", mods::router(state))
        .with_state(state.clone())
}
