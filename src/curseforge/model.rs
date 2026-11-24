//! CurseForge Core API payloads (class 6, Minecraft mods) and their mapping onto the shapes the
//! frontend uses. Kept free of panel types so the mapping can be tested on its own.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// CurseForge's "Mods" class of the Minecraft game.
pub const MODS_CLASS_ID: i64 = 6;
/// Only downloads served from CurseForge's own CDN are handed to the node.
const DOWNLOAD_HOSTS: &[&str] = &["edge.forgecdn.net", "mediafilez.forgecdn.net"];
/// Release type 1 = release, 2 = beta, 3 = alpha.
pub const RELEASE: i64 = 1;

#[derive(Deserialize)]
pub struct Envelope<T> {
    pub data: T,
}

#[derive(Deserialize)]
pub struct Paged<T> {
    pub data: Vec<T>,
    pub pagination: CfPagination,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfPagination {
    #[serde(default)]
    pub total_count: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub links: Links,
    #[serde(default)]
    pub download_count: f64,
    #[serde(default)]
    pub thumbs_up_count: i64,
    pub class_id: Option<i64>,
    #[serde(default)]
    pub categories: Vec<CfCategory>,
    #[serde(default)]
    pub authors: Vec<Author>,
    pub logo: Option<Asset>,
    pub date_modified: Option<String>,
    #[serde(default)]
    pub latest_files_indexes: Vec<FileIndex>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileIndex {
    pub game_version: String,
    pub file_id: i64,
    #[serde(default)]
    pub release_type: i64,
    pub mod_loader: Option<i64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Links {
    pub website_url: Option<String>,
    pub wiki_url: Option<String>,
    pub issues_url: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfCategory {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub is_class: Option<bool>,
    pub class_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct Author {
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub thumbnail_url: Option<String>,
    pub url: Option<String>,
}

/// A CurseForge file. Also cached as JSON (fingerprint matches), hence `Serialize`.
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub id: i64,
    pub mod_id: i64,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub file_name: String,
    pub release_type: i64,
    pub file_date: String,
    #[serde(default)]
    pub file_length: i64,
    #[serde(default)]
    pub download_count: f64,
    pub download_url: Option<String>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub is_server_pack: Option<bool>,
    #[serde(default)]
    pub file_fingerprint: Option<u64>,
    #[serde(default)]
    pub hashes: Vec<FileHash>,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct FileHash {
    pub value: String,
    pub algo: i64,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub mod_id: i64,
    pub relation_type: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintMatches {
    #[serde(default)]
    pub exact_matches: Vec<FingerprintMatch>,
}

#[derive(Deserialize)]
pub struct FingerprintMatch {
    pub file: File,
}

#[derive(ToSchema, Serialize, Deserialize, Clone)]
pub struct ModSummary {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub icon_url: Option<String>,
    pub downloads: i64,
    pub follows: i64,
    pub categories: Vec<String>,
    pub updated: Option<String>,
    pub url: String,
    /// Minecraft versions the latest files support, newest first.
    pub game_versions: Vec<String>,
    /// Mod loaders the latest files support (`fabric`, `quilt`, `forge`, `neoforge`).
    pub loaders: Vec<String>,
}

#[derive(ToSchema, Serialize, Deserialize, Clone)]
pub struct ProjectLink {
    /// `website`, `source`, `issues` or `wiki`.
    pub kind: String,
    pub url: String,
}

#[derive(ToSchema, Serialize, Deserialize, Clone)]
pub struct ModProject {
    #[schema(inline)]
    pub summary: ModSummary,
    /// HTML description.
    pub body: String,
    #[schema(inline)]
    pub links: Vec<ProjectLink>,
}

#[derive(ToSchema, Serialize, Deserialize, Clone)]
pub struct VersionFile {
    /// `None` when the author does not allow third-party downloads of this file.
    pub url: Option<String>,
    pub filename: String,
    pub size: i64,
    pub sha1: Option<String>,
    /// CurseForge (murmur2) fingerprint.
    pub fingerprint: Option<u64>,
}

#[derive(ToSchema, Serialize, Deserialize, Clone)]
pub struct VersionDependency {
    pub project_id: String,
    /// `required`, `optional` or `incompatible`.
    pub relation: String,
}

#[derive(ToSchema, Serialize, Deserialize, Clone)]
pub struct ModVersion {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    /// `release`, `beta` or `alpha`.
    pub channel: String,
    pub loaders: Vec<String>,
    pub game_versions: Vec<String>,
    /// The file is marked for clients only (`Client` without `Server`).
    pub client_only: bool,
    pub downloads: i64,
    pub published: String,
    /// False when CurseForge gives no download for third-party apps.
    pub downloadable: bool,
    #[schema(inline)]
    pub file: VersionFile,
    #[schema(inline)]
    pub dependencies: Vec<VersionDependency>,
}

#[derive(ToSchema, Serialize, Deserialize, Clone)]
pub struct Category {
    pub id: String,
    pub name: String,
}

/// `modLoaderType` of a loader name, as CurseForge numbers them.
pub fn loader_type(loader: &str) -> Option<i64> {
    match loader.to_ascii_lowercase().as_str() {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

fn loader_name(mod_loader: i64) -> Option<&'static str> {
    match mod_loader {
        1 => Some("forge"),
        4 => Some("fabric"),
        5 => Some("quilt"),
        6 => Some("neoforge"),
        _ => None,
    }
}

/// CurseForge lists loaders as game versions (`Forge`, `NeoForge`, …).
fn loader_label(value: &str) -> Option<&'static str> {
    match value.to_ascii_lowercase().as_str() {
        "forge" => Some("forge"),
        "fabric" => Some("fabric"),
        "quilt" => Some("quilt"),
        "neoforge" => Some("neoforge"),
        _ => None,
    }
}

fn version_key(version: &str) -> Vec<u32> {
    version
        .split(['.', '-'])
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

/// Minecraft versions from `versions`, deduplicated and newest first (`1.21.10` > `1.21.4`).
pub fn newest_first(versions: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut versions: Vec<String> = versions
        .into_iter()
        .filter(|version| crate::detect::is_valid_version(version))
        .collect();
    versions.sort_by_key(|version| std::cmp::Reverse(version_key(version)));
    versions.dedup();
    versions
}

fn sorted_loaders(loaders: impl IntoIterator<Item = &'static str>) -> Vec<String> {
    let mut loaders: Vec<String> = loaders.into_iter().map(str::to_string).collect();
    loaders.sort();
    loaders.dedup();
    loaders
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

pub fn is_https_url_on(url: &str, hosts: &[&str]) -> bool {
    url::Url::parse(url).is_ok_and(|url| {
        url.scheme() == "https" && url.host_str().is_some_and(|host| hosts.contains(&host))
    })
}

pub fn summarize(project: Mod) -> ModSummary {
    let url = format!(
        "https://www.curseforge.com/minecraft/mc-mods/{}",
        project.slug
    );

    ModSummary {
        id: project.id.to_string(),
        slug: project.slug,
        title: project.name,
        description: project.summary,
        author: project
            .authors
            .into_iter()
            .next()
            .map(|author| author.name)
            .unwrap_or_default(),
        icon_url: project
            .logo
            .and_then(|logo| non_empty(logo.thumbnail_url).or(non_empty(logo.url))),
        downloads: project.download_count as i64,
        follows: project.thumbs_up_count,
        categories: project
            .categories
            .into_iter()
            .filter(|category| category.is_class != Some(true))
            .map(|category| category.name)
            .collect(),
        updated: project.date_modified,
        url,
        game_versions: newest_first(
            project
                .latest_files_indexes
                .iter()
                .map(|index| index.game_version.clone()),
        ),
        loaders: sorted_loaders(
            project
                .latest_files_indexes
                .iter()
                .filter_map(|index| index.mod_loader.and_then(loader_name)),
        ),
    }
}

pub fn project_details(project: Mod, body: String) -> ModProject {
    let links = [
        ("website", project.links.website_url.clone()),
        ("source", project.links.source_url.clone()),
        ("issues", project.links.issues_url.clone()),
        ("wiki", project.links.wiki_url.clone()),
    ]
    .into_iter()
    // Only http(s) links reach the page.
    .filter_map(|(kind, url)| {
        let url = non_empty(url)?;
        let scheme_ok =
            url::Url::parse(&url).is_ok_and(|parsed| matches!(parsed.scheme(), "http" | "https"));
        scheme_ok.then(|| ProjectLink {
            kind: kind.to_string(),
            url,
        })
    })
    .collect();

    ModProject {
        summary: summarize(project),
        body,
        links,
    }
}

/// The newest release among a project's latest files for one of `loaders` (all when empty) and
/// `game_version` (any when `None`).
pub fn newest_release(
    indexes: &[FileIndex],
    loaders: &[i64],
    game_version: Option<&str>,
) -> Option<i64> {
    indexes
        .iter()
        .filter(|index| index.release_type == RELEASE)
        .filter(|index| game_version.is_none_or(|version| index.game_version == version))
        .filter(|index| {
            loaders.is_empty()
                || index
                    .mod_loader
                    .is_some_and(|mod_loader| loaders.contains(&mod_loader))
        })
        .map(|index| index.file_id)
        .max()
}

pub fn map_file(file: File) -> ModVersion {
    let version_number = file
        .file_name
        .strip_suffix(".jar")
        .unwrap_or(&file.file_name)
        .to_string();
    let environment = |label: &str| {
        file.game_versions
            .iter()
            .any(|value| value.eq_ignore_ascii_case(label))
    };
    let client_only = environment("Client") && !environment("Server");
    let loaders = sorted_loaders(
        file.game_versions
            .iter()
            .filter_map(|value| loader_label(value)),
    );
    let url = file
        .download_url
        .filter(|url| is_https_url_on(url, DOWNLOAD_HOSTS));

    ModVersion {
        id: file.id.to_string(),
        project_id: file.mod_id.to_string(),
        name: if file.display_name.is_empty() {
            version_number.clone()
        } else {
            file.display_name
        },
        version_number,
        channel: match file.release_type {
            2 => "beta",
            3 => "alpha",
            _ => "release",
        }
        .to_string(),
        loaders,
        game_versions: newest_first(file.game_versions),
        client_only,
        downloads: file.download_count as i64,
        published: file.file_date,
        downloadable: url.is_some(),
        file: VersionFile {
            url,
            filename: file.file_name.replace(['/', '\\'], "_"),
            size: file.file_length,
            sha1: file
                .hashes
                .iter()
                .find(|hash| hash.algo == 1)
                .map(|hash| hash.value.to_ascii_lowercase())
                .filter(|hash| hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit())),
            fingerprint: file.file_fingerprint,
        },
        dependencies: file
            .dependencies
            .iter()
            .filter_map(|dependency| {
                let relation = match dependency.relation_type {
                    3 => "required",
                    2 => "optional",
                    5 => "incompatible",
                    _ => return None,
                };
                Some(VersionDependency {
                    project_id: dependency.mod_id.to_string(),
                    relation: relation.to_string(),
                })
            })
            .collect(),
    }
}

/// Mod categories, without the class entry CurseForge lists among them.
pub fn map_categories(categories: Vec<CfCategory>) -> Vec<Category> {
    let mut categories: Vec<Category> = categories
        .into_iter()
        .filter(|category| category.is_class != Some(true))
        .filter(|category| category.class_id.is_none_or(|class| class == MODS_CLASS_ID))
        .map(|category| Category {
            id: category.id.to_string(),
            name: category.name,
        })
        .collect();
    categories.sort_by(|a, b| a.name.cmp(&b.name));
    categories
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_split_loaders_from_game_versions() {
        let file: File = serde_json::from_value(serde_json::json!({
            "id": 5_000_001,
            "modId": 394468,
            "displayName": "Sodium 0.6.13 (Fabric 1.21.1)",
            "fileName": "sodium-fabric-0.6.13+mc1.21.1.jar",
            "releaseType": 1,
            "fileDate": "2026-09-20T10:00:00Z",
            "fileLength": 1234,
            "downloadCount": 42.0,
            "downloadUrl": "https://edge.forgecdn.net/files/5000/1/sodium-fabric-0.6.13+mc1.21.1.jar",
            "gameVersions": ["1.21.1", "Fabric", "Quilt", "Client", "1.21", "Java 21"],
            "fileFingerprint": 3_000_000_000u64,
            "hashes": [{"value": "ABCDEF0123456789ABCDEF0123456789ABCDEF01", "algo": 1}, {"value": "x", "algo": 2}],
            "dependencies": [
                {"modId": 306612, "relationType": 3},
                {"modId": 1, "relationType": 2},
                {"modId": 2, "relationType": 5},
                {"modId": 3, "relationType": 1}
            ]
        }))
        .unwrap();

        let version = map_file(file);
        assert_eq!(version.loaders, ["fabric", "quilt"]);
        assert_eq!(version.game_versions, ["1.21.1", "1.21"]);
        assert!(version.client_only);
        assert!(version.downloadable);
        assert_eq!(version.channel, "release");
        assert_eq!(
            version.file.sha1.as_deref(),
            Some("abcdef0123456789abcdef0123456789abcdef01")
        );
        assert_eq!(version.file.fingerprint, Some(3_000_000_000));
        let relations: Vec<(&str, &str)> = version
            .dependencies
            .iter()
            .map(|dependency| (dependency.project_id.as_str(), dependency.relation.as_str()))
            .collect();
        assert_eq!(
            relations,
            [
                ("306612", "required"),
                ("1", "optional"),
                ("2", "incompatible")
            ]
        );
    }

    #[test]
    fn foreign_or_missing_downloads_are_not_downloadable() {
        for url in [
            serde_json::Value::Null,
            serde_json::json!("https://example.com/a.jar"),
            serde_json::json!("http://edge.forgecdn.net/a.jar"),
        ] {
            let file: File = serde_json::from_value(serde_json::json!({
                "id": 1, "modId": 2, "fileName": "a/b.jar", "releaseType": 2,
                "fileDate": "2026-01-01T00:00:00Z", "downloadUrl": url
            }))
            .unwrap();
            let version = map_file(file);
            assert!(!version.downloadable);
            assert!(version.file.url.is_none());
            assert_eq!(version.file.filename, "a_b.jar");
            assert_eq!(version.channel, "beta");
        }
    }

    #[test]
    fn newest_release_for_loader_and_version() {
        let index =
            |file_id: i64, game_version: &str, release_type: i64, mod_loader: Option<i64>| {
                FileIndex {
                    game_version: game_version.to_string(),
                    file_id,
                    release_type,
                    mod_loader,
                }
            };
        let indexes = [
            index(10, "1.21.1", 1, Some(4)),
            index(12, "1.21.1", 2, Some(4)),
            index(11, "1.21.1", 1, Some(6)),
            index(9, "1.20.1", 1, Some(4)),
        ];
        assert_eq!(newest_release(&indexes, &[4], Some("1.21.1")), Some(10));
        assert_eq!(newest_release(&indexes, &[4, 6], Some("1.21.1")), Some(11));
        assert_eq!(newest_release(&indexes, &[1], Some("1.21.1")), None);
        assert_eq!(newest_release(&indexes, &[], None), Some(11));
    }

    #[test]
    fn summaries_map_loaders_and_drop_the_class_category() {
        let project: Mod = serde_json::from_value(serde_json::json!({
            "id": 394468,
            "name": "Sodium",
            "slug": "sodium",
            "summary": "Rendering engine",
            "downloadCount": 1.5e6,
            "thumbsUpCount": 10,
            "classId": 6,
            "categories": [
                {"id": 6, "name": "Mods", "isClass": true},
                {"id": 423, "name": "Map and Information"}
            ],
            "authors": [{"name": "jellysquid3_"}],
            "logo": {"thumbnailUrl": "https://media.forgecdn.net/thumb.png", "url": "https://media.forgecdn.net/full.png"},
            "latestFilesIndexes": [
                {"gameVersion": "1.21.1", "fileId": 1, "releaseType": 1, "modLoader": 4},
                {"gameVersion": "1.21.10", "fileId": 2, "releaseType": 1, "modLoader": 6},
                {"gameVersion": "1.21.1", "fileId": 3, "releaseType": 1, "modLoader": 5}
            ]
        }))
        .unwrap();

        let summary = summarize(project);
        assert_eq!(summary.categories, ["Map and Information"]);
        assert_eq!(summary.loaders, ["fabric", "neoforge", "quilt"]);
        assert_eq!(summary.game_versions, ["1.21.10", "1.21.1"]);
        assert_eq!(
            summary.url,
            "https://www.curseforge.com/minecraft/mc-mods/sodium"
        );
        assert_eq!(summary.downloads, 1_500_000);
    }
}
