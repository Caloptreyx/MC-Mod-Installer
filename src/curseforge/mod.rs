//! CurseForge Core API client for Minecraft mods (https://docs.curseforge.com/rest-api/). The
//! API key never leaves the backend; the frontend only sees normalized results. Every call is
//! cached: listings 5 minutes, categories 6 hours, fingerprint matches 24 hours per fingerprint.

pub mod model;

use axum::http::StatusCode;
use model::{
    Category, Envelope, FileIndex, FingerprintMatches, MODS_CLASS_ID, Mod, ModProject, ModSummary,
    ModVersion, Paged,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use shared::{State, models::Pagination, response::DisplayError};
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
    time::Duration,
};
use utoipa::ToSchema;

const API: &str = "https://api.curseforge.com";
const MINECRAFT_GAME_ID: &str = "432";
/// CurseForge rejects searches where `index + pageSize` exceeds this.
const MAX_SEARCH_WINDOW: i64 = 10_000;
const FILES_PAGE_SIZE: i64 = 50;
/// Upper bound of files loaded for one mod.
const MAX_FILES: i64 = 1_000;
/// Seconds listings (search, projects, files) are cached for.
const CACHE_TTL: u64 = 300;
/// Seconds categories are cached for.
const LONG_CACHE_TTL: u64 = 6 * 60 * 60;
/// Seconds a fingerprint match (or the absence of one) is cached for.
const FINGERPRINT_TTL: u64 = 24 * 60 * 60;
/// CurseForge `relationType` of a required dependency.
const REQUIRED: i64 = 3;

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!(
            "Caloptreyx/MC-Mod-Installer/",
            env!("CARGO_PKG_VERSION"),
            " (Calagopus extension dev.caloptreyx.modinstaller)"
        ))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("failed to build CurseForge http client")
});

pub fn user_error(message: impl Into<String>, status: StatusCode) -> anyhow::Error {
    DisplayError::new(message.into()).with_status(status).into()
}

/// Sends a request; failures are logged in full but reported without request details.
async fn fetch_json<T: DeserializeOwned>(
    request: reqwest::RequestBuilder,
) -> Result<T, anyhow::Error> {
    let response = request.send().await.map_err(|err| {
        tracing::warn!("CurseForge request failed: {err}");
        user_error("CurseForge is unreachable", StatusCode::BAD_GATEWAY)
    })?;

    match response.status() {
        status if status.is_success() => response.json::<T>().await.map_err(|err| {
            tracing::warn!("unexpected CurseForge response: {err}");
            user_error(
                "unexpected response from CurseForge",
                StatusCode::BAD_GATEWAY,
            )
        }),
        reqwest::StatusCode::NOT_FOUND => {
            Err(user_error("not found on CurseForge", StatusCode::NOT_FOUND))
        }
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => Err(user_error(
            "CurseForge rejected the request, check the configured API key",
            StatusCode::BAD_GATEWAY,
        )),
        reqwest::StatusCode::TOO_MANY_REQUESTS => Err(user_error(
            "CurseForge is rate limiting this panel, try again later",
            StatusCode::SERVICE_UNAVAILABLE,
        )),
        status => Err(user_error(
            format!("CurseForge returned HTTP {}", status.as_u16()),
            StatusCode::BAD_GATEWAY,
        )),
    }
}

fn get(key: &str, path: &str) -> reqwest::RequestBuilder {
    CLIENT
        .get(format!("{API}{path}"))
        .header("x-api-key", key)
        .header("Accept", "application/json")
}

fn post(key: &str, path: &str, body: &impl Serialize) -> reqwest::RequestBuilder {
    CLIENT
        .post(format!("{API}{path}"))
        .header("x-api-key", key)
        .header("Accept", "application/json")
        .json(body)
}

/// CurseForge ids are positive numbers; reject anything else before building URLs.
pub fn parse_id(id: &str) -> Result<i64, anyhow::Error> {
    id.trim()
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(|| user_error("invalid CurseForge id", StatusCode::NOT_FOUND))
}

#[derive(ToSchema, Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "lowercase")]
pub enum SortMode {
    #[default]
    Relevance,
    Downloads,
    Follows,
    Newest,
    Updated,
}

pub struct SearchQuery {
    pub query: Option<String>,
    pub loader: Option<i64>,
    pub game_version: Option<String>,
    pub category: Option<i64>,
    pub sort: SortMode,
    pub page: i64,
    pub per_page: i64,
}

pub async fn search(
    state: &State,
    key: &str,
    query: SearchQuery,
) -> Result<Pagination<ModSummary>, anyhow::Error> {
    let index = (query.page - 1) * query.per_page;
    if index + query.per_page > MAX_SEARCH_WINDOW {
        return Ok(Pagination {
            total: MAX_SEARCH_WINDOW,
            per_page: query.per_page,
            page: query.page,
            data: Vec::new(),
        });
    }

    let mut params: Vec<(&str, String)> = vec![
        ("gameId", MINECRAFT_GAME_ID.to_string()),
        ("classId", MODS_CLASS_ID.to_string()),
        ("sortOrder", "desc".to_string()),
        ("index", index.to_string()),
        ("pageSize", query.per_page.to_string()),
        (
            "sortField",
            match query.sort {
                // CurseForge has no relevance order; popularity is what its website uses.
                SortMode::Relevance => "2",
                SortMode::Downloads => "6",
                SortMode::Follows => "12",
                SortMode::Newest => "11",
                SortMode::Updated => "3",
            }
            .to_string(),
        ),
    ];
    if let Some(text) = query.query {
        params.push(("searchFilter", text));
    }
    if let Some(game_version) = query.game_version {
        params.push(("gameVersion", game_version));
    }
    if let Some(loader) = query.loader {
        params.push(("modLoaderType", loader.to_string()));
    }
    if let Some(category) = query.category {
        params.push(("categoryId", category.to_string()));
    }

    let cache_key = format!(
        "modinstaller::curseforge::search::{}",
        params
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("&")
    );

    let (total, data): (i64, Vec<ModSummary>) = state
        .cache
        .cached(&cache_key, CACHE_TTL, || async {
            let response: Paged<Mod> =
                fetch_json(get(key, "/v1/mods/search").query(&params)).await?;
            Ok::<_, anyhow::Error>((
                response.pagination.total_count.min(MAX_SEARCH_WINDOW),
                response.data.into_iter().map(model::summarize).collect(),
            ))
        })
        .await?;

    Ok(Pagination {
        total,
        per_page: query.per_page,
        page: query.page,
        data,
    })
}

pub async fn categories(state: &State, key: &str) -> Result<Vec<Category>, anyhow::Error> {
    state
        .cache
        .cached(
            "modinstaller::curseforge::categories",
            LONG_CACHE_TTL,
            || async {
                let categories: Envelope<Vec<model::CfCategory>> =
                    fetch_json(get(key, "/v1/categories").query(&[
                        ("gameId", MINECRAFT_GAME_ID.to_string()),
                        ("classId", MODS_CLASS_ID.to_string()),
                    ]))
                    .await?;
                Ok::<_, anyhow::Error>(model::map_categories(categories.data))
            },
        )
        .await
}

pub async fn project(state: &State, key: &str, id: i64) -> Result<ModProject, anyhow::Error> {
    state
        .cache
        .cached(
            &format!("modinstaller::curseforge::project::{id}"),
            CACHE_TTL,
            || async {
                let (project, description): (Envelope<Mod>, Envelope<String>) = tokio::try_join!(
                    fetch_json(get(key, &format!("/v1/mods/{id}"))),
                    fetch_json(get(key, &format!("/v1/mods/{id}/description"))),
                )?;
                if project.data.class_id != Some(MODS_CLASS_ID) {
                    return Err(user_error(
                        "this project is not a Minecraft mod",
                        StatusCode::NOT_FOUND,
                    ));
                }
                Ok(model::project_details(project.data, description.data))
            },
        )
        .await
}

/// What the fingerprint match needs of a project, cached together.
#[derive(Serialize, Deserialize, Clone)]
struct ProjectInfo {
    summary: ModSummary,
    class_id: Option<i64>,
    latest: Vec<FileIndex>,
}

/// Several projects at once (unknown ids are left out).
async fn project_infos(
    state: &State,
    key: &str,
    ids: &[i64],
) -> Result<HashMap<i64, ProjectInfo>, anyhow::Error> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    let cache_key = format!(
        "modinstaller::curseforge::projects::{}",
        ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",")
    );
    let infos: Vec<(i64, ProjectInfo)> = state
        .cache
        .cached(&cache_key, CACHE_TTL, || async {
            let projects: Envelope<Vec<Mod>> =
                fetch_json(post(key, "/v1/mods", &serde_json::json!({ "modIds": ids }))).await?;
            Ok::<_, anyhow::Error>(
                projects
                    .data
                    .into_iter()
                    .map(|project| {
                        let (id, class_id, latest) = (
                            project.id,
                            project.class_id,
                            project.latest_files_indexes.clone(),
                        );
                        (
                            id,
                            ProjectInfo {
                                summary: model::summarize(project),
                                class_id,
                                latest,
                            },
                        )
                    })
                    .collect(),
            )
        })
        .await?;

    Ok(infos.into_iter().collect())
}

/// Summaries of Minecraft mods by id, in the order asked for.
pub async fn projects(
    state: &State,
    key: &str,
    ids: &[i64],
) -> Result<Vec<ModSummary>, anyhow::Error> {
    let mut sorted = ids.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let mut infos = project_infos(state, key, &sorted).await?;

    Ok(ids
        .iter()
        .filter_map(|id| infos.remove(id))
        .filter(|info| info.class_id == Some(MODS_CLASS_ID))
        .map(|info| info.summary)
        .collect())
}

/// Every file of a mod, newest first.
pub async fn versions(state: &State, key: &str, id: i64) -> Result<Vec<ModVersion>, anyhow::Error> {
    state
        .cache
        .cached(
            &format!("modinstaller::curseforge::versions::{id}"),
            CACHE_TTL,
            || async {
                let mut files = Vec::new();
                let mut index = 0;
                loop {
                    let page: Paged<model::File> =
                        fetch_json(get(key, &format!("/v1/mods/{id}/files")).query(&[
                            ("index", index.to_string()),
                            ("pageSize", FILES_PAGE_SIZE.to_string()),
                        ]))
                        .await?;
                    let received = page.data.len() as i64;
                    files.extend(page.data);
                    index += FILES_PAGE_SIZE;
                    if received < FILES_PAGE_SIZE
                        || index >= page.pagination.total_count
                        || index >= MAX_FILES
                    {
                        break;
                    }
                }

                let mut versions: Vec<ModVersion> = files
                    .into_iter()
                    .filter(|file| file.is_server_pack != Some(true))
                    .map(model::map_file)
                    .collect();
                versions.sort_by(|a, b| b.published.cmp(&a.published));
                Ok::<_, anyhow::Error>(versions)
            },
        )
        .await
}

/// One file of a mod.
pub async fn version(
    state: &State,
    key: &str,
    project_id: i64,
    file_id: i64,
) -> Result<ModVersion, anyhow::Error> {
    state
        .cache
        .cached(
            &format!("modinstaller::curseforge::version::{project_id}::{file_id}"),
            CACHE_TTL,
            || async {
                let file: Envelope<model::File> =
                    fetch_json(get(key, &format!("/v1/mods/{project_id}/files/{file_id}"))).await?;
                if file.data.mod_id != project_id || file.data.is_server_pack == Some(true) {
                    return Err(user_error(
                        "this file does not belong to the mod",
                        StatusCode::NOT_FOUND,
                    ));
                }
                Ok(model::map_file(file.data))
            },
        )
        .await
}

/// Several files by id (unknown ids are left out).
async fn files_by_id(
    state: &State,
    key: &str,
    ids: &[i64],
) -> Result<Vec<model::File>, anyhow::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let cache_key = format!(
        "modinstaller::curseforge::files::{}",
        ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",")
    );
    state
        .cache
        .cached(&cache_key, CACHE_TTL, || async {
            let files: Envelope<Vec<model::File>> = fetch_json(post(
                key,
                "/v1/mods/files",
                &serde_json::json!({ "fileIds": ids }),
            ))
            .await?;
            Ok::<_, anyhow::Error>(files.data)
        })
        .await
}

#[derive(ToSchema, Serialize)]
pub struct IdentifiedFile {
    pub fingerprint: u64,
    #[schema(inline)]
    pub project: ModSummary,
    #[schema(inline)]
    pub file: ModVersion,
    /// The newest release for the requested loaders and Minecraft version, when newer.
    #[schema(inline)]
    pub update: Option<ModVersion>,
}

#[derive(ToSchema, Serialize, Default)]
pub struct FingerprintResult {
    #[schema(inline)]
    pub matches: Vec<IdentifiedFile>,
    /// Projects the matched files require, to tell whether they are installed.
    #[schema(inline)]
    pub dependencies: Vec<ModSummary>,
}

fn fingerprint_key(fingerprint: u64) -> String {
    format!("modinstaller::curseforge::fingerprint::{fingerprint}")
}

/// Matches fingerprints to files, through a 24 hour cache per fingerprint.
async fn files_by_fingerprint(
    state: &State,
    key: &str,
    fingerprints: &[u64],
) -> Result<HashMap<u64, model::File>, anyhow::Error> {
    let mut unique = fingerprints.to_vec();
    unique.sort_unstable();
    unique.dedup();

    let cached = futures_util::future::join_all(unique.iter().map(|fingerprint| async move {
        let cached = state.cache.get_raw(&fingerprint_key(*fingerprint)).await;
        (*fingerprint, cached)
    }))
    .await;

    let mut files = HashMap::new();
    let mut missing = Vec::new();
    for (fingerprint, cached) in cached {
        match cached
            .ok()
            .flatten()
            .and_then(|bytes| serde_json::from_slice::<Option<model::File>>(&bytes).ok())
        {
            Some(Some(file)) => {
                files.insert(fingerprint, file);
            }
            Some(None) => {}
            None => missing.push(fingerprint),
        }
    }
    if missing.is_empty() {
        return Ok(files);
    }

    let matches: Envelope<FingerprintMatches> = fetch_json(post(
        key,
        &format!("/v1/fingerprints/{MINECRAFT_GAME_ID}"),
        &serde_json::json!({ "fingerprints": missing }),
    ))
    .await?;
    let wanted: HashSet<u64> = missing.iter().copied().collect();
    let mut found: HashMap<u64, model::File> = matches
        .data
        .exact_matches
        .into_iter()
        .filter_map(|found| {
            let fingerprint = found.file.file_fingerprint?;
            wanted
                .contains(&fingerprint)
                .then_some((fingerprint, found.file))
        })
        .collect();

    let stored = missing.into_iter().map(|fingerprint| {
        let file = found.remove(&fingerprint);
        let bytes = serde_json::to_vec(&file).unwrap_or_default();
        (fingerprint, file, bytes)
    });
    let mut writes = Vec::new();
    for (fingerprint, file, bytes) in stored {
        writes.push(async move {
            if let Err(err) = state
                .cache
                .set_raw(&fingerprint_key(fingerprint), FINGERPRINT_TTL, bytes)
                .await
            {
                tracing::warn!("failed to cache a CurseForge fingerprint match: {err:#}");
            }
        });
        if let Some(file) = file {
            files.insert(fingerprint, file);
        }
    }
    futures_util::future::join_all(writes).await;

    Ok(files)
}

/// Identifies jars by their CurseForge fingerprint. Files that are not Minecraft mods are left
/// out. With `loaders` (CurseForge `modLoaderType`s) and `game_version` given, each match also
/// carries the newest release for them when it is newer than the installed file.
pub async fn match_fingerprints(
    state: &State,
    key: &str,
    fingerprints: &[u64],
    loaders: &[i64],
    game_version: Option<&str>,
) -> Result<FingerprintResult, anyhow::Error> {
    let files = files_by_fingerprint(state, key, fingerprints).await?;
    if files.is_empty() {
        return Ok(FingerprintResult::default());
    }

    let required: Vec<i64> = files
        .values()
        .flat_map(|file| {
            file.dependencies
                .iter()
                .filter(|dependency| dependency.relation_type == REQUIRED)
                .map(|dependency| dependency.mod_id)
        })
        .collect();
    let mut mod_ids: Vec<i64> = files
        .values()
        .map(|file| file.mod_id)
        .chain(required.iter().copied())
        .collect();
    mod_ids.sort_unstable();
    mod_ids.dedup();
    let projects = project_infos(state, key, &mod_ids).await?;

    let wants_updates = !loaders.is_empty() && game_version.is_some();
    let mut update_ids: Vec<i64> = if wants_updates {
        files
            .values()
            .filter_map(|file| {
                let latest = model::newest_release(
                    &projects.get(&file.mod_id)?.latest,
                    loaders,
                    game_version,
                )?;
                (latest > file.id).then_some(latest)
            })
            .collect()
    } else {
        Vec::new()
    };
    update_ids.sort_unstable();
    update_ids.dedup();
    let updates: HashMap<i64, ModVersion> = files_by_id(state, key, &update_ids)
        .await?
        .into_iter()
        .filter(|file| file.is_server_pack != Some(true))
        .map(|file| (file.id, model::map_file(file)))
        .collect();

    let mut matches: Vec<IdentifiedFile> = files
        .into_iter()
        .filter_map(|(fingerprint, file)| {
            let info = projects.get(&file.mod_id)?;
            if info.class_id != Some(MODS_CLASS_ID) {
                return None;
            }
            let update = if wants_updates {
                model::newest_release(&info.latest, loaders, game_version)
                    .filter(|latest| *latest > file.id)
                    .and_then(|latest| updates.get(&latest).cloned())
            } else {
                None
            };
            Some(IdentifiedFile {
                fingerprint,
                project: info.summary.clone(),
                file: model::map_file(file),
                update,
            })
        })
        .collect();
    matches.sort_by_key(|identified| identified.fingerprint);

    let mut required = required;
    required.sort_unstable();
    required.dedup();
    let dependencies = required
        .iter()
        .filter_map(|id| projects.get(id))
        .map(|info| info.summary.clone())
        .collect();

    Ok(FingerprintResult {
        matches,
        dependencies,
    })
}

/// Checks an API key against CurseForge without touching the stored settings.
pub async fn verify_key(key: &str) -> Result<(), anyhow::Error> {
    let response = get(key, &format!("/v1/games/{MINECRAFT_GAME_ID}"))
        .send()
        .await
        .map_err(|err| {
            tracing::warn!("CurseForge key check failed: {err}");
            user_error("CurseForge is unreachable", StatusCode::BAD_GATEWAY)
        })?;

    match response.status() {
        status if status.is_success() => Ok(()),
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => Err(user_error(
            "CurseForge rejected the API key",
            StatusCode::BAD_REQUEST,
        )),
        status => Err(user_error(
            format!("CurseForge returned HTTP {}", status.as_u16()),
            StatusCode::BAD_GATEWAY,
        )),
    }
}
