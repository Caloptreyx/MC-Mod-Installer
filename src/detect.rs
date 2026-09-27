//! Pure Minecraft loader / version detection.
//!
//! The route gathers everything it can from Wings and the database into an
//! [`Inputs`] value; [`detect`] then derives the environment without any I/O.
//! Each field takes the first source that yields a value, in priority order
//! `log` → `files` → `variables` → `egg`.

use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;
use utoipa::ToSchema;

#[derive(ToSchema, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Loader {
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

#[derive(ToSchema, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Log,
    Files,
    Variables,
    Egg,
}

#[derive(ToSchema, Serialize, Debug, Default, Clone, PartialEq, Eq)]
pub struct Environment {
    pub loader: Option<Loader>,
    pub loader_source: Option<Source>,
    pub minecraft_version: Option<String>,
    pub minecraft_version_source: Option<Source>,
}

#[derive(Debug, Clone)]
pub struct DirEntry {
    pub name: String,
    pub directory: bool,
    pub modified: chrono::DateTime<chrono::Utc>,
}

/// Everything detection looks at. Directory listings are `None` when the
/// directory does not exist (or could not be read).
#[derive(Debug, Default, Clone)]
pub struct Inputs {
    /// The first lines of `logs/latest.log`.
    pub latest_log: Option<String>,
    pub root: Vec<DirEntry>,
    pub fabric_intermediary: Option<Vec<DirEntry>>,
    pub fabric_loader: Option<Vec<DirEntry>>,
    pub quilt_loader: Option<Vec<DirEntry>>,
    pub forge: Option<Vec<DirEntry>>,
    pub neoforge: Option<Vec<DirEntry>>,
    pub neoforged_forge: Option<Vec<DirEntry>>,
    pub versions: Option<Vec<DirEntry>>,
    /// `(env_variable, value)` pairs of the server's variables.
    pub variables: Vec<(String, String)>,
    pub egg_name: String,
    pub nest_name: String,
    pub startup: String,
    pub image: String,
}

#[derive(Debug, Default)]
struct Partial {
    loader: Option<Loader>,
    version: Option<String>,
}

pub fn detect(inputs: &Inputs) -> Environment {
    let sources = [
        (Source::Log, from_log(inputs.latest_log.as_deref())),
        (Source::Files, from_files(inputs)),
        (Source::Variables, from_variables(&inputs.variables)),
        (Source::Egg, from_egg(inputs)),
    ];

    let mut environment = Environment::default();
    for (source, partial) in sources {
        if environment.loader.is_none()
            && let Some(loader) = partial.loader
        {
            environment.loader = Some(loader);
            environment.loader_source = Some(source);
        }
        if environment.minecraft_version.is_none()
            && let Some(version) = partial.version
        {
            environment.minecraft_version = Some(version);
            environment.minecraft_version_source = Some(source);
        }
    }

    environment
}

/// Accepts `1.N`, `1.N.N`, year-based `NN.N` / `NN.N.N` (NN ≥ 25), each
/// optionally suffixed with `-preN`, `-rcN` or `-snapshotN` (inner dash
/// optional), and weekly snapshots like `24w14a`.
pub fn is_valid_version(version: &str) -> bool {
    static VERSION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r"^(?:(?:1|2[5-9]|[3-9][0-9])\.[0-9]+(?:\.[0-9]+)?(?:-(?:pre|rc|snapshot)-?[0-9]+)?|[0-9]{2}w[0-9]{2}[a-z])$",
        )
        .unwrap()
    });

    VERSION.is_match(version)
}

fn valid(version: &str) -> Option<String> {
    is_valid_version(version).then(|| version.to_string())
}

fn from_log(log: Option<&str>) -> Partial {
    static LOADER_LINE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"Loading Minecraft (\S+) with (Fabric|Quilt) Loader").unwrap()
    });
    static LAUNCH_TARGET: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"--launchTarget, ([^,\]\s]+)").unwrap());
    static FML_MC_VERSION: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"--fml\.mcVersion, ([^,\]\s]+)").unwrap());
    // `Starting minecraft server version X` (vanilla and forks), or Paper's bootstrap line
    // `Loading Paper 26.3-32-dev/... for Minecraft 26.3`, which is logged even before the EULA check.
    static SERVER_VERSION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)(?:Starting minecraft server version|\bfor Minecraft) (\S+)").unwrap()
    });

    let Some(log) = log else {
        return Partial::default();
    };

    let mut loader = None;
    let mut loader_version = None;
    let mut server_version = None;

    for line in log.lines() {
        if let Some(captures) = LOADER_LINE.captures(line) {
            loader.get_or_insert(if &captures[2] == "Quilt" {
                Loader::Quilt
            } else {
                Loader::Fabric
            });
            if loader_version.is_none() {
                loader_version = valid(&captures[1]);
            }
        }

        if let Some(captures) = LAUNCH_TARGET.captures(line) {
            let target = captures[1].to_ascii_lowercase();
            let detected = if target.contains("neoforge") || line.contains("--fml.neoForgeVersion")
            {
                Some(Loader::NeoForge)
            } else if target.contains("forge") || target.contains("fml") {
                Some(Loader::Forge)
            } else {
                None
            };
            if loader.is_none() {
                loader = detected;
            }
        }

        if loader_version.is_none()
            && let Some(captures) = FML_MC_VERSION.captures(line)
        {
            loader_version = valid(&captures[1]);
        }

        if server_version.is_none()
            && let Some(captures) = SERVER_VERSION.captures(line)
        {
            server_version = valid(&captures[1]);
        }
    }

    Partial {
        loader,
        version: loader_version.or(server_version),
    }
}

/// The most recently modified entry for which `parse` yields a value.
fn newest<T>(entries: Option<&[DirEntry]>, parse: impl Fn(&DirEntry) -> Option<T>) -> Option<T> {
    entries?
        .iter()
        .filter_map(|entry| parse(entry).map(|value| (entry.modified, value)))
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, value)| value)
}

/// `20.4.237` → `1.20.4`, `21.0.3` → `1.21`, `26.1.0.5` → `26.1`,
/// `26.1.2.1` → `26.1.2`. Any `-beta` / `+build` suffix is ignored.
pub fn neoforge_to_minecraft(neoforge: &str) -> Option<String> {
    let numeric = neoforge.split(['-', '+']).next()?;
    let parts = numeric
        .split('.')
        .map(|part| part.parse::<u32>().ok())
        .collect::<Option<Vec<_>>>()?;

    let version = match parts.as_slice() {
        [major, 0, ..] if *major < 25 => format!("1.{major}"),
        [major, minor, ..] if *major < 25 => format!("1.{major}.{minor}"),
        [major, minor, 0, ..] => format!("{major}.{minor}"),
        [major, minor, patch, ..] => format!("{major}.{minor}.{patch}"),
        _ => return None,
    };

    valid(&version)
}

/// The Minecraft part of a `<mc>-<loader>` library directory name.
fn minecraft_prefix(name: &str) -> Option<String> {
    let (minecraft, rest) = name.split_once('-')?;
    if rest.is_empty() {
        return None;
    }
    valid(minecraft)
}

fn legacy_forge_jar(entry: &DirEntry) -> Option<String> {
    static FORGE_JAR: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^forge-([^-]+)-[0-9][^/]*\.jar$").unwrap());

    if entry.directory {
        return None;
    }
    valid(&FORGE_JAR.captures(&entry.name)?[1])
}

fn from_files(inputs: &Inputs) -> Partial {
    let root_has = |name: &str, directory: bool| {
        inputs
            .root
            .iter()
            .any(|entry| entry.directory == directory && entry.name.eq_ignore_ascii_case(name))
    };

    let neoforge_version = newest(inputs.neoforge.as_deref(), |entry| {
        neoforge_to_minecraft(&entry.name)
    });
    let neoforged_forge_version = newest(inputs.neoforged_forge.as_deref(), |entry| {
        minecraft_prefix(&entry.name)
    });
    let forge_version = newest(inputs.forge.as_deref(), |entry| {
        minecraft_prefix(&entry.name)
    })
    .or_else(|| newest(Some(&inputs.root), legacy_forge_jar));

    let has_entries =
        |entries: &Option<Vec<DirEntry>>| entries.as_ref().is_some_and(|e| !e.is_empty());

    let (loader, loader_version) = if root_has("quilt-server-launch.jar", false)
        || root_has(".quilt", true)
        || inputs.quilt_loader.is_some()
    {
        (Some(Loader::Quilt), None)
    } else if root_has(".fabric", true)
        || root_has("fabric-server-launch.jar", false)
        || root_has("fabric-server-launcher.properties", false)
        || inputs.fabric_loader.is_some()
    {
        (Some(Loader::Fabric), None)
    } else if has_entries(&inputs.neoforge) || neoforged_forge_version.is_some() {
        (
            Some(Loader::NeoForge),
            neoforge_version.or(neoforged_forge_version),
        )
    } else if forge_version.is_some() {
        (Some(Loader::Forge), forge_version)
    } else {
        (None, None)
    };

    let version = loader_version
        .or_else(|| {
            newest(inputs.fabric_intermediary.as_deref(), |entry| {
                valid(&entry.name)
            })
        })
        .or_else(|| {
            newest(inputs.versions.as_deref(), |entry| {
                if entry.directory {
                    valid(&entry.name)
                } else {
                    None
                }
            })
        });

    Partial { loader, version }
}

fn from_variables(variables: &[(String, String)]) -> Partial {
    let lookup = |name: &str| {
        variables
            .iter()
            .filter(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.trim())
            .find(|value| !value.is_empty())
    };

    let version = ["MINECRAFT_VERSION", "MC_VERSION", "MCVERSION", "VERSION"]
        .into_iter()
        .filter_map(lookup)
        .find_map(valid);

    // A variable explicitly set to a loader name (e.g. `SERVER_TYPE=fabric`)
    // is the strongest signal; fall back to loader-specific version variables.
    let by_value =
        variables.iter().find_map(
            |(_, value)| match value.trim().to_ascii_lowercase().as_str() {
                "fabric" => Some(Loader::Fabric),
                "quilt" => Some(Loader::Quilt),
                "forge" => Some(Loader::Forge),
                "neoforge" => Some(Loader::NeoForge),
                _ => None,
            },
        );
    let by_name = [
        ("NEOFORGE_VERSION", Loader::NeoForge),
        ("QUILT_VERSION", Loader::Quilt),
        ("QUILT_LOADER_VERSION", Loader::Quilt),
        ("FABRIC_VERSION", Loader::Fabric),
        ("FABRIC_LOADER_VERSION", Loader::Fabric),
        ("FORGE_VERSION", Loader::Forge),
    ]
    .into_iter()
    .find_map(|(name, loader)| lookup(name).map(|_| loader));

    Partial {
        loader: by_value.or(by_name),
        version,
    }
}

fn from_egg(inputs: &Inputs) -> Partial {
    const NEEDLES: [(&str, Loader); 4] = [
        ("neoforge", Loader::NeoForge),
        ("forge", Loader::Forge),
        ("quilt", Loader::Quilt),
        ("fabric", Loader::Fabric),
    ];

    let loader = [
        &inputs.egg_name,
        &inputs.nest_name,
        &inputs.startup,
        &inputs.image,
    ]
    .into_iter()
    .find_map(|haystack| {
        let haystack = haystack.to_ascii_lowercase();
        NEEDLES
            .iter()
            .find(|(needle, _)| haystack.contains(needle))
            .map(|(_, loader)| *loader)
    });

    Partial {
        loader,
        version: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, directory: bool, modified: i64) -> DirEntry {
        DirEntry {
            name: name.to_string(),
            directory,
            modified: chrono::DateTime::from_timestamp(modified, 0).unwrap(),
        }
    }

    fn dirs(names: &[(&str, i64)]) -> Option<Vec<DirEntry>> {
        Some(
            names
                .iter()
                .map(|(name, modified)| entry(name, true, *modified))
                .collect(),
        )
    }

    fn vars(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    fn log(content: &str) -> Inputs {
        Inputs {
            latest_log: Some(content.to_string()),
            ..Default::default()
        }
    }

    fn expect(
        environment: Environment,
        loader: Option<(Loader, Source)>,
        version: Option<(&str, Source)>,
    ) {
        assert_eq!(environment.loader, loader.map(|(l, _)| l));
        assert_eq!(environment.loader_source, loader.map(|(_, s)| s));
        assert_eq!(
            environment.minecraft_version.as_deref(),
            version.map(|(v, _)| v)
        );
        assert_eq!(
            environment.minecraft_version_source,
            version.map(|(_, s)| s)
        );
    }

    #[test]
    fn fabric_log() {
        let environment = detect(&log(
            "[12:00:00] [main/INFO]: Loading Minecraft 1.20.1 with Fabric Loader 0.15.3\n\
             [12:00:02] [Server thread/INFO]: Starting minecraft server version 1.20.1\n",
        ));
        expect(
            environment,
            Some((Loader::Fabric, Source::Log)),
            Some(("1.20.1", Source::Log)),
        );
    }

    #[test]
    fn quilt_log() {
        let environment = detect(&log(
            "[12:00:00] [main/INFO]: Loading Minecraft 1.19.2 with Quilt Loader 0.19.1\n",
        ));
        expect(
            environment,
            Some((Loader::Quilt, Source::Log)),
            Some(("1.19.2", Source::Log)),
        );
    }

    #[test]
    fn forge_modlauncher_log() {
        let environment = detect(&log(
            "[12:00:00] [main/INFO] [cp.mo.mo.Launcher/MODLAUNCHER]: ModLauncher running: args [--launchTarget, forgeserver, --fml.forgeVersion, 47.2.0, --fml.mcVersion, 1.20.1, --fml.forgeGroup, net.minecraftforge, --fml.mcpVersion, 20230612.114412]\n",
        ));
        expect(
            environment,
            Some((Loader::Forge, Source::Log)),
            Some(("1.20.1", Source::Log)),
        );
    }

    #[test]
    fn neoforge_modlauncher_log() {
        // Older NeoForge still uses the `forgeserver` target but passes a NeoForge version.
        let environment = detect(&log(
            "[main/INFO] [cp.mo.mo.Launcher/MODLAUNCHER]: ModLauncher running: args [--launchTarget, forgeserver, --fml.fmlVersion, 2.0.17, --fml.mcVersion, 1.20.4, --fml.neoForgeVersion, 20.4.80-beta, --fml.neoFormVersion, 20231207.154220]\n",
        ));
        expect(
            environment,
            Some((Loader::NeoForge, Source::Log)),
            Some(("1.20.4", Source::Log)),
        );

        let environment = detect(&log(
            "ModLauncher running: args [--launchTarget, neoforgeserver, --fml.fmlVersion, 4.0.24, --fml.mcVersion, 1.21.1]\n",
        ));
        expect(
            environment,
            Some((Loader::NeoForge, Source::Log)),
            Some(("1.21.1", Source::Log)),
        );
    }

    #[test]
    fn paper_log_yields_version_only() {
        let environment = detect(&log(
            "[12:00:00 INFO]: Starting minecraft server version 1.20.4\n\
             [12:00:00 INFO]: Loading properties\n\
             [12:00:01 INFO]: This server is running Paper version 1.20.4-496-release\n",
        ));
        expect(environment, None, Some(("1.20.4", Source::Log)));
    }

    #[test]
    fn paper_bootstrap_log_before_eula_yields_version() {
        let environment = detect(&log(
            "[15:29:31] [ServerMain/INFO]: [bootstrap] Loading Paper 26.3-32-dev/26.3@0c803ba (2026-09-21T17:06:10Z) for Minecraft 26.3\n\
             [15:29:35] [ServerMain/INFO]: You need to agree to the EULA in order to run the server.\n",
        ));
        expect(environment, None, Some(("26.3", Source::Log)));
    }

    #[test]
    fn files_forge() {
        let environment = detect(&Inputs {
            root: vec![entry("libraries", true, 0), entry("run.sh", false, 0)],
            forge: dirs(&[("1.19.2-43.3.0", 10), ("1.20.1-47.2.0", 20)]),
            ..Default::default()
        });
        expect(
            environment,
            Some((Loader::Forge, Source::Files)),
            Some(("1.20.1", Source::Files)),
        );
    }

    #[test]
    fn files_legacy_forge_jar() {
        let environment = detect(&Inputs {
            root: vec![
                entry("forge-1.12.2-14.23.5.2860.jar", false, 0),
                entry("minecraft_server.1.12.2.jar", false, 0),
            ],
            ..Default::default()
        });
        expect(
            environment,
            Some((Loader::Forge, Source::Files)),
            Some(("1.12.2", Source::Files)),
        );
    }

    #[test]
    fn files_neoforge_version_mapping() {
        for (neoforge, minecraft) in [
            ("20.4.237", "1.20.4"),
            ("21.0.167", "1.21"),
            ("21.1.77", "1.21.1"),
            ("20.2.86-beta", "1.20.2"),
            ("26.1.0.3", "26.1"),
            ("26.1.2.7", "26.1.2"),
        ] {
            let environment = detect(&Inputs {
                neoforge: dirs(&[(neoforge, 0)]),
                ..Default::default()
            });
            expect(
                environment,
                Some((Loader::NeoForge, Source::Files)),
                Some((minecraft, Source::Files)),
            );
        }
    }

    #[test]
    fn files_neoforge_picks_newest_entry() {
        let environment = detect(&Inputs {
            neoforge: dirs(&[("21.1.77", 50), ("20.4.237", 10)]),
            ..Default::default()
        });
        expect(
            environment,
            Some((Loader::NeoForge, Source::Files)),
            Some(("1.21.1", Source::Files)),
        );
    }

    #[test]
    fn files_neoforged_forge_for_1_20_1() {
        let environment = detect(&Inputs {
            neoforged_forge: dirs(&[("1.20.1-47.1.106", 0)]),
            ..Default::default()
        });
        expect(
            environment,
            Some((Loader::NeoForge, Source::Files)),
            Some(("1.20.1", Source::Files)),
        );
    }

    #[test]
    fn files_fabric_with_intermediary_version() {
        let environment = detect(&Inputs {
            root: vec![
                entry(".fabric", true, 0),
                entry("fabric-server-launch.jar", false, 0),
            ],
            fabric_loader: dirs(&[("0.15.3", 0)]),
            fabric_intermediary: dirs(&[("1.20.1", 5), ("1.20.4", 30)]),
            ..Default::default()
        });
        expect(
            environment,
            Some((Loader::Fabric, Source::Files)),
            Some(("1.20.4", Source::Files)),
        );
    }

    #[test]
    fn files_quilt_checked_before_fabric() {
        let environment = detect(&Inputs {
            root: vec![entry("quilt-server-launch.jar", false, 0)],
            fabric_loader: dirs(&[("0.15.3", 0)]),
            fabric_intermediary: dirs(&[("1.20.1", 0)]),
            ..Default::default()
        });
        expect(
            environment,
            Some((Loader::Quilt, Source::Files)),
            Some(("1.20.1", Source::Files)),
        );
    }

    #[test]
    fn files_vanilla_versions_directory() {
        let environment = detect(&Inputs {
            versions: dirs(&[("1.21.4", 0)]),
            ..Default::default()
        });
        expect(environment, None, Some(("1.21.4", Source::Files)));
    }

    #[test]
    fn variables_source() {
        let environment = detect(&Inputs {
            variables: vars(&[
                ("SERVER_JARFILE", "server.jar"),
                ("MINECRAFT_VERSION", "1.21.1"),
                ("NEOFORGE_VERSION", "21.1.77"),
            ]),
            ..Default::default()
        });
        expect(
            environment,
            Some((Loader::NeoForge, Source::Variables)),
            Some(("1.21.1", Source::Variables)),
        );

        let environment = detect(&Inputs {
            variables: vars(&[("SERVER_TYPE", "Fabric"), ("VERSION", "1.20.1")]),
            ..Default::default()
        });
        expect(
            environment,
            Some((Loader::Fabric, Source::Variables)),
            Some(("1.20.1", Source::Variables)),
        );
    }

    #[test]
    fn variables_reject_non_versions() {
        let environment = detect(&Inputs {
            variables: vars(&[
                ("MINECRAFT_VERSION", "latest"),
                ("MC_VERSION", "recommended"),
                ("MCVERSION", ""),
                ("VERSION", "snapshot"),
                ("FORGE_VERSION", ""),
            ]),
            ..Default::default()
        });
        expect(environment, None, None);

        // `latest` is skipped, the next candidate is used.
        let environment = detect(&Inputs {
            variables: vars(&[("MINECRAFT_VERSION", "latest"), ("VERSION", "1.20.6")]),
            ..Default::default()
        });
        expect(environment, None, Some(("1.20.6", Source::Variables)));
    }

    #[test]
    fn egg_fallback() {
        let environment = detect(&Inputs {
            egg_name: "NeoForge".to_string(),
            nest_name: "Minecraft".to_string(),
            startup: "java -jar server.jar".to_string(),
            ..Default::default()
        });
        expect(environment, Some((Loader::NeoForge, Source::Egg)), None);

        let environment = detect(&Inputs {
            egg_name: "Modded Server".to_string(),
            nest_name: "Minecraft".to_string(),
            startup: "java -jar quilt-server-launch.jar nogui".to_string(),
            image: "ghcr.io/pterodactyl/yolks:java_17".to_string(),
            ..Default::default()
        });
        expect(environment, Some((Loader::Quilt, Source::Egg)), None);

        let environment = detect(&Inputs {
            egg_name: "Paper".to_string(),
            nest_name: "Minecraft".to_string(),
            ..Default::default()
        });
        expect(environment, None, None);
    }

    #[test]
    fn source_priority() {
        let all = Inputs {
            latest_log: Some("Loading Minecraft 1.20.1 with Fabric Loader 0.15.3\n".to_string()),
            forge: dirs(&[("1.19.2-43.3.0", 0)]),
            variables: vars(&[("MINECRAFT_VERSION", "1.18.2"), ("QUILT_VERSION", "0.19")]),
            egg_name: "NeoForge".to_string(),
            ..Default::default()
        };
        expect(
            detect(&all),
            Some((Loader::Fabric, Source::Log)),
            Some(("1.20.1", Source::Log)),
        );

        let without_log = Inputs {
            latest_log: None,
            ..all.clone()
        };
        expect(
            detect(&without_log),
            Some((Loader::Forge, Source::Files)),
            Some(("1.19.2", Source::Files)),
        );

        let variables_and_egg = Inputs {
            forge: None,
            ..without_log.clone()
        };
        expect(
            detect(&variables_and_egg),
            Some((Loader::Quilt, Source::Variables)),
            Some(("1.18.2", Source::Variables)),
        );

        let egg_only = Inputs {
            variables: Vec::new(),
            ..variables_and_egg
        };
        expect(
            detect(&egg_only),
            Some((Loader::NeoForge, Source::Egg)),
            None,
        );

        // Fields are resolved independently: a Paper log only supplies the version.
        let mixed = Inputs {
            latest_log: Some("Starting minecraft server version 1.21.4\n".to_string()),
            ..without_log
        };
        expect(
            detect(&mixed),
            Some((Loader::Forge, Source::Files)),
            Some(("1.21.4", Source::Log)),
        );
    }

    #[test]
    fn version_validation() {
        for accepted in [
            "1.8",
            "1.20.1",
            "1.21.9-rc1",
            "1.21.9-rc-1",
            "1.20.5-pre3",
            "26.1",
            "26.1.2",
            "26.3-pre-2",
            "26.4-snapshot-1",
            "26.4-snapshot1",
            "24w14a",
        ] {
            assert!(is_valid_version(accepted), "{accepted} should be accepted");
        }
        for rejected in [
            "",
            "latest",
            "recommended",
            "snapshot",
            "1",
            "1.20.1.1",
            "20.4.237",
            "1.20.1-47.2.0",
            "1.20-beta",
            " 1.20.1",
        ] {
            assert!(!is_valid_version(rejected), "{rejected} should be rejected");
        }
    }
}
