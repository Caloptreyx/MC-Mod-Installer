//! Modrinth is queried straight from the browser. CurseForge needs an API key, so its lookups go
//! through the routes here, which keep the key on the server. Detection, the `mods/` listing
//! with hashes and the post-download hash check run here too; installing, enabling, disabling
//! and deleting mods use the panel's own file endpoints.

use indexmap::IndexMap;
use shared::{
    State,
    extensions::{
        Extension, ExtensionPermissionsBuilder, ExtensionRouteBuilder,
        settings::ExtensionSettingsDeserializer,
    },
    permissions::PermissionGroup,
};
use std::sync::Arc;

mod curseforge;
mod detect;
mod routes;
mod settings;
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
        builder
            .add_admin_api_router(|router| {
                router.nest(
                    "/extensions/dev.caloptreyx.modinstaller",
                    routes::admin::router(&state),
                )
            })
            .add_client_server_api_router(|router| {
                router.nest("/mod-installer", routes::server::router(&state))
            })
    }

    async fn initialize_permissions(
        &mut self,
        _state: State,
        mut builder: ExtensionPermissionsBuilder,
    ) -> ExtensionPermissionsBuilder {
        builder.admin_permissions.insert(
            "modinstaller",
            PermissionGroup {
                description: "Permissions that control the ability to configure the mod installer extension.",
                permissions: IndexMap::from([
                    ("read", "Allows viewing the mod installer settings."),
                    (
                        "manage",
                        "Allows changing the mod installer settings, including the CurseForge API key.",
                    ),
                ]),
            },
        );

        builder
    }

    async fn settings_deserializer(&self, _state: State) -> ExtensionSettingsDeserializer {
        Arc::new(settings::ExtensionSettingsDataDeserializer)
    }
}
