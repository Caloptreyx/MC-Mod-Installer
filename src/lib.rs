use shared::{
    State,
    extensions::{Extension, ExtensionRouteBuilder},
};

mod detect;
mod routes;
mod wings;

#[derive(Default)]
pub struct ExtensionStruct;

#[async_trait::async_trait]
impl Extension for ExtensionStruct {
    async fn initialize(&mut self, _state: State) {}

    async fn initialize_router(
        &mut self,
        state: State,
        builder: ExtensionRouteBuilder,
    ) -> ExtensionRouteBuilder {
        builder.add_client_server_api_router(|router| {
            router.nest("/mod-installer", routes::server::router(&state))
        })
    }
}
