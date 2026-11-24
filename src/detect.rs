//! Pure Minecraft server software detection.
//!
//! The environment route gathers listings, a few small files and the egg into an [`Inputs`]
//! value; [`detect`] then ranks every hint without any I/O. Each hint becomes a candidate with a
//! rank (lower wins), and every field is filled from the best candidate that agrees with the
//! chosen software:
//!
//! 1. the manual override file (`/.mc-mod-installer.json`);
//! 2. launch arguments (`unix_args.txt`, `run.sh` and the argument file it starts, Forge shim jar);
//! 3. `logs/latest.log` and `version_history.json`, when they are not older than the install;
//! 4. markers other tools leave (`.mcvc-type.json`, `.modpack-installer.json`);
//! 5. files: loader libraries, jar names, config files, `versions/` (newest wins);
//! 6. a stale log or `version_history.json`, and stale config files;
//! 7. startup variables;
//! 8. the egg, nest, startup command and image names.
//!
//! Launch arguments and markers that are older than a newer conflicting file drop to rank 5.

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::sync::LazyLock;
use utoipa::ToSchema;

pub type Time = chrono::DateTime<chrono::Utc>;

pub const OVERRIDE_FILE: &str = ".mc-mod-installer.json";
pub const MCVC_MARKER: &str = ".mcvc-type.json";
pub const MODPACK_MARKER: &str = ".modpack-installer.json";
pub const VERSION_HISTORY: &str = "version_history.json";
pub const UNIX_ARGS: &str = "unix_args.txt";
pub const RUN_SH: &str = "run.sh";
pub const LATEST_LOG: &str = "logs/latest.log";

const RANK_OVERRIDE: u8 = 1;
const RANK_ARGS: u8 = 2;
const RANK_FRESH: u8 = 3;
const RANK_MARKER: u8 = 4;
const RANK_FILES: u8 = 5;
const RANK_STALE: u8 = 6;
const RANK_VARIABLES: u8 = 7;
const RANK_EGG: u8 = 8;

/// Vanilla files exist next to every loader, so they only decide when nothing else does.
const VANILLA_ORDER: i64 = i64::MIN / 2;
const MAX_DETAIL: usize = 200;

#[derive(ToSchema, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Software {
    Vanilla,
    Paper,
    Purpur,
    Folia,
    Spigot,
    Bukkit,
    Sponge,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
    Mohist,
    Arclight,
    Youer,
    Velocity,
    BungeeCord,
    Waterfall,
}

#[derive(ToSchema, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Family {
    Mods,
    Plugins,
    Hybrid,
    Proxy,
    Vanilla,
}

/// Mod loaders whose mods a server can load.
#[derive(ToSchema, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Loader {
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

impl Software {
    pub const ALL: [Software; 17] = [
        Software::Vanilla,
        Software::Paper,
        Software::Purpur,
        Software::Folia,
        Software::Spigot,
        Software::Bukkit,
        Software::Sponge,
        Software::Fabric,
        Software::Quilt,
        Software::Forge,
        Software::NeoForge,
        Software::Mohist,
        Software::Arclight,
        Software::Youer,
        Software::Velocity,
        Software::BungeeCord,
        Software::Waterfall,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Software::Vanilla => "vanilla",
            Software::Paper => "paper",
            Software::Purpur => "purpur",
            Software::Folia => "folia",
            Software::Spigot => "spigot",
            Software::Bukkit => "bukkit",
            Software::Sponge => "sponge",
            Software::Fabric => "fabric",
            Software::Quilt => "quilt",
            Software::Forge => "forge",
            Software::NeoForge => "neoforge",
            Software::Mohist => "mohist",
            Software::Arclight => "arclight",
            Software::Youer => "youer",
            Software::Velocity => "velocity",
            Software::BungeeCord => "bungeecord",
            Software::Waterfall => "waterfall",
        }
    }

    pub fn from_id(value: &str) -> Option<Self> {
        let value = value.trim().to_ascii_lowercase();
        Self::ALL
            .into_iter()
            .find(|software| software.id() == value)
    }

    pub fn family(self) -> Family {
        match self {
            Software::Vanilla => Family::Vanilla,
            Software::Fabric | Software::Quilt | Software::Forge | Software::NeoForge => {
                Family::Mods
            }
            Software::Mohist | Software::Arclight | Software::Youer => Family::Hybrid,
            Software::Velocity | Software::BungeeCord | Software::Waterfall => Family::Proxy,
            Software::Paper
            | Software::Purpur
            | Software::Folia
            | Software::Spigot
            | Software::Bukkit
            | Software::Sponge => Family::Plugins,
        }
    }

    /// The software this one is built on, so hints for those describe the same server.
    fn ancestors(self) -> &'static [Software] {
        match self {
            Software::Spigot => &[Software::Bukkit],
            Software::Paper => &[Software::Spigot, Software::Bukkit],
            Software::Purpur | Software::Folia => {
                &[Software::Paper, Software::Spigot, Software::Bukkit]
            }
            Software::Mohist | Software::Arclight => {
                &[Software::Forge, Software::Spigot, Software::Bukkit]
            }
            Software::Youer => &[Software::NeoForge, Software::Spigot, Software::Bukkit],
            Software::Waterfall => &[Software::BungeeCord],
            _ => &[],
        }
    }

    fn descends_from(self, other: Software) -> bool {
        self.ancestors().contains(&other)
    }

    /// Whether two hints can describe the same server: equal, one built on the other, or
    /// vanilla files, which every Minecraft server has.
    fn compatible(self, other: Software) -> bool {
        let vanilla_with =
            |a: Software, b: Software| a == Software::Vanilla && b.family() != Family::Proxy;
        self == other
            || self.descends_from(other)
            || other.descends_from(self)
            || vanilla_with(self, other)
            || vanilla_with(other, self)
    }

    /// Mod loaders whose mods this software loads.
    pub fn mod_loaders(self, minecraft_version: Option<&str>) -> Vec<Loader> {
        match self {
            Software::Fabric => vec![Loader::Fabric],
            Software::Quilt => vec![Loader::Quilt, Loader::Fabric],
            Software::Forge | Software::Mohist | Software::Arclight => vec![Loader::Forge],
            // NeoForge for 1.20.1 is a Forge fork and still loads Forge mods.
            Software::NeoForge if minecraft_version == Some("1.20.1") => {
                vec![Loader::NeoForge, Loader::Forge]
            }
            Software::NeoForge | Software::Youer => vec![Loader::NeoForge],
            _ => Vec::new(),
        }
    }
}

#[derive(ToSchema, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Override,
    Args,
    Log,
    VersionHistory,
    Marker,
    Files,
    Variables,
    Egg,
}

#[derive(ToSchema, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

/// Why a hint counted less than its source normally does.
#[derive(ToSchema, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Note {
    /// Older than the newest install files (a log from before the last switch, a leftover config).
    Stale,
    /// Launch arguments or a marker older than newer files of another software.
    Superseded,
    /// The override file exists but could not be read.
    Invalid,
}

#[derive(ToSchema, Serialize, Debug, Clone, PartialEq, Eq)]
pub struct SoftwareField {
    pub value: Software,
    pub source: Source,
    pub confidence: Confidence,
}

#[derive(ToSchema, Serialize, Debug, Clone, PartialEq, Eq)]
pub struct VersionField {
    pub value: String,
    pub source: Source,
    pub confidence: Confidence,
}

#[derive(ToSchema, Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Evidence {
    pub source: Source,
    /// The file the hint comes from, a log line (at most 200 characters), a variable name, or
    /// `egg` / `nest` / `startup` / `image`.
    pub detail: String,
    pub software: Option<Software>,
    pub minecraft_version: Option<String>,
    pub loader_version: Option<String>,
    pub note: Option<Note>,
}

#[derive(ToSchema, Serialize, Debug, Clone, PartialEq, Eq)]
pub struct ManualOverride {
    pub software: Software,
    pub minecraft_version: Option<String>,
    pub loader_version: Option<String>,
    pub set_at: Option<String>,
}

#[derive(ToSchema, Serialize, Debug, Default, Clone, PartialEq, Eq)]
pub struct Detection {
    /// False when nothing at all points to a Minecraft server.
    pub minecraft: bool,
    pub software: Option<SoftwareField>,
    pub family: Option<Family>,
    /// Mod loaders whose mods the server loads (empty on plugin, proxy and vanilla servers).
    pub mod_loaders: Vec<Loader>,
    pub minecraft_version: Option<VersionField>,
    /// Fabric/Quilt loader, Forge/NeoForge version, Paper build or proxy version.
    pub loader_version: Option<VersionField>,
    pub evidence: Vec<Evidence>,
    /// Launch arguments, fresh logs, markers and files that disagree with the result.
    pub conflicts: Vec<Evidence>,
    /// The log or `version_history.json` is older than the install and was not trusted.
    pub log_stale: bool,
    #[serde(rename = "override")]
    pub manual_override: Option<ManualOverride>,
}

#[derive(Debug, Clone)]
pub struct DirEntry {
    pub name: String,
    pub directory: bool,
    pub modified: Time,
}

/// Everything detection looks at. Directory listings are `None` when the directory does not
/// exist or could not be read; file contents are `None` when missing or not readable.
#[derive(Debug, Default, Clone)]
pub struct Inputs {
    pub root: Vec<DirEntry>,
    pub config: Option<Vec<DirEntry>>,
    pub logs: Option<Vec<DirEntry>>,
    /// The first lines of `logs/latest.log`.
    pub latest_log: Option<String>,
    pub version_history: Option<String>,
    pub unix_args: Option<String>,
    pub run_sh: Option<String>,
    /// Path and content of the argument file `run.sh` starts.
    pub argfile: Option<(String, String)>,
    pub mcvc_marker: Option<String>,
    pub modpack_marker: Option<String>,
    pub override_file: Option<String>,
    pub fabric_intermediary: Option<Vec<DirEntry>>,
    pub fabric_loader: Option<Vec<DirEntry>>,
    pub quilt_loader: Option<Vec<DirEntry>>,
    pub forge: Option<Vec<DirEntry>>,
    pub neoforge: Option<Vec<DirEntry>>,
    pub neoforged_forge: Option<Vec<DirEntry>>,
    pub versions: Option<Vec<DirEntry>>,
    /// Name and listing of the newest `versions/<version>/` directory.
    pub version_jars: Option<(String, Vec<DirEntry>)>,
    /// `(env_variable, value)` pairs of the server's viewable, non-secret variables.
    pub variables: Vec<(String, String)>,
    pub egg_name: String,
    pub nest_name: String,
    pub startup: String,
    pub image: String,
}

impl Inputs {
    fn root_entry(&self, name: &str, directory: bool) -> Option<&DirEntry> {
        self.root
            .iter()
            .find(|entry| entry.directory == directory && entry.name.eq_ignore_ascii_case(name))
    }

    fn config_entry(&self, name: &str, directory: bool) -> Option<&DirEntry> {
        self.config
            .as_ref()?
            .iter()
            .find(|entry| entry.directory == directory && entry.name.eq_ignore_ascii_case(name))
    }

    fn root_jars(&self) -> impl Iterator<Item = &DirEntry> {
        self.root
            .iter()
            .filter(|entry| !entry.directory && entry.name.to_ascii_lowercase().ends_with(".jar"))
    }
}

#[derive(Debug, Clone)]
struct Candidate {
    source: Source,
    rank: u8,
    /// Tie-break within a rank, higher wins (usually the modification time).
    order: i64,
    confidence: Confidence,
    software: Option<Software>,
    minecraft: Option<String>,
    loader_version: Option<String>,
    detail: String,
    time: Option<Time>,
    note: Option<Note>,
}

impl Candidate {
    fn new(source: Source, rank: u8, confidence: Confidence, detail: &str) -> Self {
        Self {
            source,
            rank,
            order: 0,
            confidence,
            software: None,
            minecraft: None,
            loader_version: None,
            detail: truncate(detail),
            time: None,
            note: None,
        }
    }

    fn software(mut self, software: Option<Software>) -> Self {
        self.software = software;
        self
    }

    fn minecraft(mut self, version: Option<String>) -> Self {
        self.minecraft = version;
        self
    }

    fn loader_version(mut self, version: Option<String>) -> Self {
        self.loader_version = version;
        self
    }

    fn at(mut self, time: Option<Time>) -> Self {
        self.time = time;
        self.order = time.map_or(0, |time| time.timestamp());
        self
    }

    /// Drops a log-like hint to the stale rank when it is older than the install.
    fn fresh_since(mut self, installed_at: Option<Time>) -> Self {
        if let (Some(time), Some(installed_at)) = (self.time, installed_at)
            && time < installed_at
        {
            self.rank = RANK_STALE;
            self.confidence = Confidence::Low;
            self.note = Some(Note::Stale);
        }
        self
    }

    fn has_hint(&self) -> bool {
        self.software.is_some() || self.minecraft.is_some() || self.loader_version.is_some()
    }

    fn evidence(&self) -> Evidence {
        Evidence {
            source: self.source,
            detail: self.detail.clone(),
            software: self.software,
            minecraft_version: self.minecraft.clone(),
            loader_version: self.loader_version.clone(),
            note: self.note,
        }
    }
}

fn truncate(text: &str) -> String {
    let text = text.trim();
    match text.char_indices().nth(MAX_DETAIL) {
        Some((index, _)) => format!("{}…", &text[..index]),
        None => text.to_string(),
    }
}

pub fn detect(inputs: &Inputs) -> Detection {
    let installed_at = install_time(inputs);

    let mut candidates = Vec::new();
    let mut evidence_notes = Vec::new();

    let manual_override = match inputs.override_file.as_deref() {
        Some(text) => {
            let parsed = parse_override(text);
            if parsed.is_none() {
                evidence_notes.push(Evidence {
                    source: Source::Override,
                    detail: OVERRIDE_FILE.to_string(),
                    software: None,
                    minecraft_version: None,
                    loader_version: None,
                    note: Some(Note::Invalid),
                });
            }
            parsed
        }
        None => None,
    };
    if let Some(manual) = &manual_override {
        candidates.push(
            Candidate::new(
                Source::Override,
                RANK_OVERRIDE,
                Confidence::High,
                OVERRIDE_FILE,
            )
            .software(Some(manual.software))
            .minecraft(manual.minecraft_version.clone())
            .loader_version(manual.loader_version.clone()),
        );
    }

    candidates.extend(from_args(inputs));
    candidates.extend(from_log(inputs, installed_at));
    candidates.extend(from_version_history(inputs, installed_at));
    candidates.extend(from_markers(inputs));
    candidates.extend(from_files(inputs));
    candidates.extend(from_variables(&inputs.variables));
    candidates.extend(from_egg(inputs));
    candidates.retain(Candidate::has_hint);
    supersede(&mut candidates);

    // Stable: equal candidates keep the order they were added in.
    candidates.sort_by(|a, b| a.rank.cmp(&b.rank).then(b.order.cmp(&a.order)));

    let software_index = choose_software(&candidates);
    let software = software_index.map(|index| &candidates[index]);
    let chosen = software.and_then(|candidate| candidate.software);
    let family = chosen.map(Software::family);
    let agrees = |candidate: &Candidate| match (chosen, candidate.software) {
        (Some(chosen), Some(other)) => chosen.compatible(other),
        _ => true,
    };

    let minecraft_index = if family == Some(Family::Proxy) {
        None
    } else {
        candidates
            .iter()
            .position(|candidate| candidate.minecraft.is_some() && agrees(candidate))
    };
    let loader_index = chosen.and_then(|chosen| {
        candidates.iter().position(|candidate| {
            candidate.loader_version.is_some() && candidate.software == Some(chosen)
        })
    });

    let minecraft_version = minecraft_index.map(|index| VersionField {
        value: candidates[index].minecraft.clone().unwrap_or_default(),
        source: candidates[index].source,
        confidence: candidates[index].confidence,
    });
    let loader_version = loader_index.map(|index| VersionField {
        value: candidates[index].loader_version.clone().unwrap_or_default(),
        source: candidates[index].source,
        confidence: candidates[index].confidence,
    });

    let chosen_minecraft = minecraft_version.as_ref().map(|field| field.value.as_str());
    let conflicts = candidates
        .iter()
        .enumerate()
        .filter(|(index, candidate)| {
            (RANK_ARGS..=RANK_FILES).contains(&candidate.rank)
                && (!agrees(*candidate)
                    || (Some(*index) != minecraft_index
                        && chosen_minecraft.is_some()
                        && candidate.minecraft.is_some()
                        && candidate.minecraft.as_deref() != chosen_minecraft))
        })
        .map(|(_, candidate)| candidate.evidence())
        .collect();
    let mod_loaders = chosen
        .map(|software| software.mod_loaders(chosen_minecraft))
        .unwrap_or_default();

    let log_stale = candidates.iter().any(|candidate| {
        matches!(candidate.source, Source::Log | Source::VersionHistory)
            && candidate.note == Some(Note::Stale)
    });

    let minecraft = candidates
        .iter()
        .any(|candidate| candidate.software.is_some() || candidate.rank <= RANK_FILES)
        || inputs.root_entry("server.properties", false).is_some()
        || inputs.root_entry("eula.txt", false).is_some()
        || [&inputs.egg_name, &inputs.nest_name]
            .into_iter()
            .any(|name| name.to_ascii_lowercase().contains("minecraft"));

    let mut evidence: Vec<Evidence> = evidence_notes;
    evidence.extend(candidates.iter().map(Candidate::evidence));

    Detection {
        minecraft,
        software: software.and_then(|candidate| {
            Some(SoftwareField {
                value: candidate.software?,
                source: candidate.source,
                confidence: candidate.confidence,
            })
        }),
        family,
        mod_loaders,
        minecraft_version,
        loader_version,
        evidence,
        conflicts,
        log_stale,
        manual_override,
    }
}

/// The best candidate naming a software, refined to a fork when another hint names one
/// (Folia and hybrids from any source, other forks only from fresh files and better).
fn choose_software(candidates: &[Candidate]) -> Option<usize> {
    let mut index = candidates
        .iter()
        .position(|candidate| candidate.software.is_some())?;
    if candidates[index].source == Source::Override {
        return Some(index);
    }

    // Folia and hybrids often only show in a name (jar, egg, log), so any fresh hint refines.
    let eligible = |candidate: &Candidate, software: Software| {
        candidate.rank <= RANK_FILES
            || (candidate.rank != RANK_STALE
                && (software == Software::Folia || software.family() == Family::Hybrid))
    };
    for _ in 0..3 {
        let base = candidates[index].software?;
        let refined = candidates.iter().position(|candidate| {
            candidate.software.is_some_and(|software| {
                software.descends_from(base) && eligible(candidate, software)
            })
        });
        match refined {
            Some(refined) => index = refined,
            None => break,
        }
    }

    Some(index)
}

/// Launch arguments and markers older than newer files of another software lose to them.
fn supersede(candidates: &mut [Candidate]) {
    let artifacts: Vec<(Software, Time)> = candidates
        .iter()
        .filter(|candidate| candidate.rank == RANK_FILES)
        .filter_map(|candidate| Some((candidate.software?, candidate.time?)))
        .collect();

    for candidate in candidates.iter_mut() {
        if !matches!(candidate.source, Source::Args | Source::Marker) {
            continue;
        }
        let (Some(software), Some(time)) = (candidate.software, candidate.time) else {
            continue;
        };
        if artifacts
            .iter()
            .any(|(other, other_time)| !software.compatible(*other) && *other_time > time)
        {
            candidate.rank = RANK_FILES;
            candidate.confidence = Confidence::Low;
            candidate.note = Some(Note::Superseded);
        }
    }
}

/// The newest install artifact: server jars, loader library versions, `unix_args.txt` and the
/// install time recorded in markers.
fn install_time(inputs: &Inputs) -> Option<Time> {
    let jars = inputs.root_jars().map(|entry| entry.modified);
    let unix_args = inputs
        .root_entry(UNIX_ARGS, false)
        .map(|entry| entry.modified);
    let libraries = [
        &inputs.fabric_loader,
        &inputs.quilt_loader,
        &inputs.forge,
        &inputs.neoforge,
        &inputs.neoforged_forge,
    ]
    .into_iter()
    .flatten()
    .flatten()
    .map(|entry| entry.modified);
    let markers = [
        marker_json(inputs.mcvc_marker.as_deref())
            .and_then(|value| parse_time(string_field(&value, "installedAt")?)),
        marker_json(inputs.modpack_marker.as_deref())
            .and_then(|value| parse_time(string_field(&value, "installed_at")?)),
    ]
    .into_iter()
    .flatten();

    jars.chain(unix_args).chain(libraries).chain(markers).max()
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

/// A loader/build version: 1-64 characters of `[A-Za-z0-9.+_-]` with at least one digit.
pub fn safe_version(version: &str) -> Option<String> {
    let version = version.trim().trim_start_matches('#');
    (!version.is_empty()
        && version.len() <= 64
        && version.bytes().any(|byte| byte.is_ascii_digit())
        && version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'+')))
    .then(|| version.to_string())
}

fn parse_time(value: &str) -> Option<Time> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.to_utc())
}

fn marker_json(text: Option<&str>) -> Option<Value> {
    serde_json::from_str(text?).ok()
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// The most recently modified entry for which `parse` yields a value.
fn newest<T>(
    entries: Option<&[DirEntry]>,
    parse: impl Fn(&DirEntry) -> Option<T>,
) -> Option<(Time, T)> {
    entries?
        .iter()
        .filter_map(|entry| parse(entry).map(|value| (entry.modified, value)))
        .max_by_key(|(modified, _)| *modified)
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

/// The Minecraft and loader parts of a `<mc>-<loader>` library directory name.
fn minecraft_prefix(name: &str) -> Option<(String, Option<String>)> {
    let (minecraft, rest) = name.split_once('-')?;
    if rest.is_empty() {
        return None;
    }
    Some((valid(minecraft)?, safe_version(rest)))
}

fn parse_override(text: &str) -> Option<ManualOverride> {
    let value: Value = serde_json::from_str(text).ok()?;
    let entry = value.get("override")?;
    let software = Software::from_id(entry.get("software")?.as_str()?)?;
    let optional = |key: &str, check: fn(&str) -> Option<String>| match entry.get(key) {
        None | Some(Value::Null) => Some(None),
        Some(Value::String(text)) if text.trim().is_empty() => Some(None),
        Some(Value::String(text)) => check(text.trim()).map(Some),
        Some(_) => None,
    };

    Some(ManualOverride {
        software,
        minecraft_version: optional("minecraftVersion", valid)?,
        loader_version: optional("loaderVersion", safe_version)?,
        set_at: string_field(&value, "setAt")
            .filter(|value| value.len() <= 64)
            .map(str::to_string),
    })
}

// ---------------------------------------------------------------------------------------------
// Launch arguments (copied from MC-Version-Changer's detector)
// ---------------------------------------------------------------------------------------------

/// How a file marks comments.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Syntax {
    /// A Java `@argfile` (`unix_args.txt`): any unquoted `#` starts a comment.
    ArgFile,
    /// A shell script (`run.sh`): an unquoted `#` starts a comment only at the start of a word.
    Shell,
}

/// The words of a launch arguments file or start script, with quotes and backslash escapes
/// decoded and comments dropped, so a commented-out command cannot name the loader.
fn tokenize(text: &str, syntax: Syntax) -> Vec<String> {
    let mut tokens = Vec::new();
    for line in text.lines() {
        let mut word = String::new();
        let mut in_word = false;
        let mut quote = None;
        let mut escaped = false;
        for char in line.chars() {
            if escaped {
                word.push(char);
                escaped = false;
                continue;
            }
            match (quote, char) {
                (Some(open), _) if char == open => quote = None,
                // Single quotes take backslashes literally in a shell, argument files do outside quotes.
                (Some('\''), '\\') if syntax == Syntax::Shell => word.push(char),
                (None, '\\') if syntax == Syntax::ArgFile => {
                    word.push(char);
                    in_word = true;
                }
                (_, '\\') => {
                    escaped = true;
                    in_word = true;
                }
                (Some(_), _) => word.push(char),
                (None, '#') if !in_word || syntax == Syntax::ArgFile => break,
                (None, '"' | '\'') => {
                    quote = Some(char);
                    in_word = true;
                }
                (None, _) if char.is_whitespace() => {
                    if in_word {
                        tokens.push(std::mem::take(&mut word));
                        in_word = false;
                    }
                }
                (None, _) => {
                    word.push(char);
                    in_word = true;
                }
            }
        }
        if in_word {
            tokens.push(word);
        }
    }

    tokens
}

/// `forge-<minecraft>-<forge>-shim.jar`, which Forge 1.20.3+ starts instead of `--fml.*` options.
fn forge_shim(name: &str) -> Option<(String, String)> {
    static FORGE_SHIM: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^forge-(\d[\w.+]*)-(\d[\w.+-]*)-shim\.jar$").unwrap());

    let captures = FORGE_SHIM.captures(name)?;
    Some((valid(&captures[1])?, safe_version(&captures[2])?))
}

/// `(software, minecraft, loader version)` from Forge/NeoForge launch arguments: the `--fml.*`
/// options of `unix_args.txt`, or the shim jar Forge 1.20.3+ starts.
fn parse_loader_args(text: &str, syntax: Syntax) -> Option<(Software, String, String)> {
    let tokens = tokenize(text, syntax);
    let option = |name: &str| {
        tokens
            .windows(2)
            .find(|pair| pair[0] == name)
            .map(|pair| pair[1].as_str())
    };

    if let Some(minecraft) = option("--fml.mcVersion").and_then(valid) {
        let neoforge = option("--fml.neoForgeVersion").and_then(safe_version);
        let forge = option("--fml.forgeVersion").and_then(safe_version);
        let loader = match (neoforge, forge) {
            (Some(version), _) => Some((Software::NeoForge, version)),
            // NeoForge for 1.20.1 still launches as Forge, under its own group.
            (None, Some(version)) if option("--fml.forgeGroup") == Some("net.neoforged") => {
                Some((Software::NeoForge, version))
            }
            (None, Some(version)) => Some((Software::Forge, version)),
            (None, None) => None,
        };
        if let Some((software, version)) = loader {
            return Some((software, minecraft, version));
        }
    }

    tokens.iter().find_map(|token| {
        let (minecraft, version) = forge_shim(token)?;
        Some((Software::Forge, minecraft, version))
    })
}

/// A relative path inside the server without `..`, empty segments, backslashes or colons.
pub fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\\', '\0', ':'])
        && path
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

/// The arguments file a start script passes (`@libraries/.../unix_args.txt` in Forge's `run.sh`).
pub fn referenced_args_file(text: &str) -> Option<String> {
    tokenize(text, Syntax::Shell)
        .into_iter()
        .filter_map(|token| token.strip_prefix('@').map(str::to_string))
        .find(|path| {
            path.starts_with("libraries/")
                && path.ends_with("/unix_args.txt")
                && safe_relative(path)
        })
}

fn from_args(inputs: &Inputs) -> Vec<Candidate> {
    let modified = |name: &str| inputs.root_entry(name, false).map(|entry| entry.modified);
    let candidate = |detail: &str, parsed: (Software, String, String), time: Option<Time>| {
        let (software, minecraft, version) = parsed;
        Candidate::new(Source::Args, RANK_ARGS, Confidence::High, detail)
            .software(Some(software))
            .minecraft(Some(minecraft))
            .loader_version(Some(version))
            .at(time)
    };

    let mut candidates = Vec::new();
    if let Some(parsed) = inputs
        .unix_args
        .as_deref()
        .and_then(|text| parse_loader_args(text, Syntax::ArgFile))
    {
        candidates.push(candidate(UNIX_ARGS, parsed, modified(UNIX_ARGS)));
    }
    if let Some(parsed) = inputs
        .run_sh
        .as_deref()
        .and_then(|text| parse_loader_args(text, Syntax::Shell))
    {
        candidates.push(candidate(RUN_SH, parsed, modified(RUN_SH)));
    } else if let Some((path, text)) = &inputs.argfile
        && let Some(parsed) = parse_loader_args(text, Syntax::ArgFile)
    {
        candidates.push(candidate(path.as_str(), parsed, modified(RUN_SH)));
    }
    for jar in inputs.root_jars() {
        if let Some((minecraft, version)) = forge_shim(&jar.name) {
            candidates.push(candidate(
                jar.name.as_str(),
                (Software::Forge, minecraft, version),
                Some(jar.modified),
            ));
        }
    }

    candidates
}

// ---------------------------------------------------------------------------------------------
// Logs and version_history.json
// ---------------------------------------------------------------------------------------------

/// A server brand as printed by the server (`Paper`, `CraftBukkit`, …).
fn brand(name: &str, version: &str) -> Option<Software> {
    Some(match name.to_ascii_lowercase().as_str() {
        "paper" | "pufferfish" | "leaves" => Software::Paper,
        "purpur" => Software::Purpur,
        "folia" => Software::Folia,
        "spigot" => Software::Spigot,
        "craftbukkit" if version.to_ascii_lowercase().contains("spigot") => Software::Spigot,
        "craftbukkit" | "bukkit" => Software::Bukkit,
        "mohist" => Software::Mohist,
        "arclight" => Software::Arclight,
        "youer" => Software::Youer,
        "velocity" => Software::Velocity,
        "waterfall" => Software::Waterfall,
        "bungeecord" => Software::BungeeCord,
        "sponge" | "spongevanilla" => Software::Sponge,
        _ => return None,
    })
}

/// `(minecraft, build)` of a Paper-style version: `1.21.4-232-main@abc`, `26.3-32-dev/26.3@x`,
/// or the old `git-Paper-196`.
fn paper_version(version: &str) -> (Option<String>, Option<String>) {
    static NEW: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^(\d+\.\d+(?:\.\d+)?(?:-(?:pre|rc)-?\d+)?)-(\d+)(?:[-@/ ]|$)").unwrap()
    });
    static OLD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^git-[A-Za-z]+-(\d+)").unwrap());

    if let Some(captures) = NEW.captures(version) {
        return (valid(&captures[1]), Some(captures[2].to_string()));
    }
    (
        None,
        OLD.captures(version)
            .map(|captures| captures[1].to_string()),
    )
}

#[derive(Default)]
struct LogHints {
    software: Option<Software>,
    minecraft: Option<String>,
    loader_version: Option<String>,
    server_version: Option<String>,
    line: Option<String>,
}

fn parse_log(log: &str) -> LogHints {
    static LOADER_LINE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"Loading Minecraft (\S+) with (Fabric|Quilt) Loader (\S+)").unwrap()
    });
    static LAUNCH_TARGET: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"--launchTarget, ([^,\]\s]+)").unwrap());
    static FML_OPTION: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"--fml\.(\w+), ([^,\]\s]+)").unwrap());
    static RUNNING: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"This server is running (\w+) version (\S+)(?: \(MC: ([^)\s]+)\))?").unwrap()
    });
    static BOOTSTRAP: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"Loading (\w+) (\S+)(?: \([^)]*\))? for Minecraft (\S+)").unwrap()
    });
    static VELOCITY: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"Booting up Velocity (\S+)").unwrap());
    static BUNGEE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"Enabled (BungeeCord|Waterfall) version (\S+)").unwrap());
    static SERVER_VERSION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)(?:Starting minecraft server version|\bfor Minecraft) (\S+)").unwrap()
    });

    let mut hints = LogHints::default();
    let found = |hints: &mut LogHints,
                 line: &str,
                 software: Option<Software>,
                 minecraft: Option<String>,
                 loader_version: Option<String>| {
        if hints.software.is_none() && software.is_some() {
            hints.software = software;
            hints.minecraft = minecraft;
            hints.loader_version = loader_version;
            hints.line = Some(line.to_string());
        }
    };

    for line in log.lines() {
        if let Some(captures) = LOADER_LINE.captures(line) {
            let software = if &captures[2] == "Quilt" {
                Software::Quilt
            } else {
                Software::Fabric
            };
            found(
                &mut hints,
                line,
                Some(software),
                valid(&captures[1]),
                safe_version(&captures[3]),
            );
        }

        if let Some(captures) = LAUNCH_TARGET.captures(line) {
            let target = captures[1].to_ascii_lowercase();
            let options: Vec<(String, String)> = FML_OPTION
                .captures_iter(line)
                .map(|option| (option[1].to_string(), option[2].to_string()))
                .collect();
            let option = |name: &str| {
                options
                    .iter()
                    .find(|(key, _)| key == name)
                    .map(|(_, value)| value.as_str())
            };
            let neoforge = option("neoForgeVersion");
            let software = if target.contains("neoforge")
                || neoforge.is_some()
                || option("forgeGroup") == Some("net.neoforged")
            {
                Some(Software::NeoForge)
            } else if target.contains("forge") || target.contains("fml") {
                Some(Software::Forge)
            } else {
                None
            };
            found(
                &mut hints,
                line,
                software,
                option("mcVersion").and_then(valid),
                neoforge.or(option("forgeVersion")).and_then(safe_version),
            );
        }

        if let Some(captures) = RUNNING.captures(line) {
            let version = &captures[2];
            let software = brand(&captures[1], version);
            let (minecraft, build) = paper_version(version);
            let minecraft = captures
                .get(3)
                .and_then(|minecraft| valid(minecraft.as_str()))
                .or(minecraft);
            let build = match software {
                Some(Software::Paper | Software::Purpur | Software::Folia) => build,
                _ => None,
            };
            found(&mut hints, line, software, minecraft, build);
        }

        if let Some(captures) = BOOTSTRAP.captures(line) {
            let software = brand(&captures[1], &captures[2]);
            let (_, build) = paper_version(&captures[2]);
            found(&mut hints, line, software, valid(&captures[3]), build);
        }

        if let Some(captures) = VELOCITY.captures(line) {
            found(
                &mut hints,
                line,
                Some(Software::Velocity),
                None,
                safe_version(&captures[1]),
            );
        }

        if let Some(captures) = BUNGEE.captures(line) {
            let software = brand(&captures[1], &captures[2]);
            found(&mut hints, line, software, None, None);
        }

        if hints.server_version.is_none()
            && let Some(captures) = SERVER_VERSION.captures(line)
            && let Some(version) = valid(&captures[1])
        {
            hints.server_version = Some(version);
            if hints.line.is_none() {
                hints.line = Some(line.to_string());
            }
        }
    }

    hints
}

fn from_log(inputs: &Inputs, installed_at: Option<Time>) -> Option<Candidate> {
    let hints = parse_log(inputs.latest_log.as_deref()?);
    let line = hints.line?;
    let modified = inputs
        .logs
        .as_ref()
        .and_then(|logs| {
            logs.iter()
                .find(|entry| !entry.directory && entry.name == "latest.log")
        })
        .map(|entry| entry.modified);

    Some(
        Candidate::new(Source::Log, RANK_FRESH, Confidence::High, &line)
            .software(hints.software)
            .minecraft(hints.minecraft.or(hints.server_version))
            .loader_version(hints.loader_version)
            .at(modified)
            .fresh_since(installed_at),
    )
}

/// `(software, minecraft, build)` of a `version_history.json` `currentVersion`, e.g.
/// `git-Paper-196 (MC: 1.20.1)` or `1.21.4-232-main@abc1234 (2025-01-01T00:00:00Z)`.
fn parse_version_history(current: &str) -> (Software, Option<String>, Option<String>) {
    static BRAND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^git-([A-Za-z]+)-").unwrap());
    static MINECRAFT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\(MC: ([^)\s]+)\)").unwrap());

    let software = BRAND
        .captures(current)
        .and_then(|captures| brand(&captures[1], current))
        .unwrap_or(Software::Paper);
    let (minecraft, build) = paper_version(current);
    let minecraft = MINECRAFT
        .captures(current)
        .and_then(|captures| valid(&captures[1]))
        .or(minecraft);

    (software, minecraft, build)
}

fn from_version_history(inputs: &Inputs, installed_at: Option<Time>) -> Option<Candidate> {
    let value = marker_json(inputs.version_history.as_deref())?;
    let current = string_field(&value, "currentVersion")?;
    let (software, minecraft, build) = parse_version_history(current);
    let modified = inputs
        .root_entry(VERSION_HISTORY, false)
        .map(|entry| entry.modified);

    Some(
        Candidate::new(
            Source::VersionHistory,
            RANK_FRESH,
            Confidence::High,
            VERSION_HISTORY,
        )
        .software(Some(software))
        .minecraft(minecraft)
        .loader_version(build)
        .at(modified)
        .fresh_since(installed_at),
    )
}

// ---------------------------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------------------------

/// mcjars type ids (`.mcvc-type.json`) for software this detector knows.
fn mcjars_type(value: &str) -> Option<Software> {
    match value.trim().to_ascii_uppercase().as_str() {
        "PUFFERFISH" | "LEAVES" | "CANVAS" | "DIVINEMC" => Some(Software::Paper),
        "SPONGEVANILLA" | "SPONGEFORGE" => Some(Software::Sponge),
        other => Software::from_id(other),
    }
}

fn from_markers(inputs: &Inputs) -> Vec<Candidate> {
    let modified = |name: &str| inputs.root_entry(name, false).map(|entry| entry.modified);
    let mut candidates = Vec::new();

    if let Some(value) = marker_json(inputs.mcvc_marker.as_deref()) {
        let software = string_field(&value, "type").and_then(mcjars_type);
        let version = string_field(&value, "version");
        let proxy = software.is_some_and(|software| software.family() == Family::Proxy);
        let (minecraft, loader_version) = if proxy {
            (None, version.and_then(safe_version))
        } else {
            (
                version.and_then(valid),
                string_field(&value, "buildName").and_then(safe_version),
            )
        };
        let time = string_field(&value, "installedAt")
            .and_then(parse_time)
            .or_else(|| modified(MCVC_MARKER));
        candidates.push(
            Candidate::new(Source::Marker, RANK_MARKER, Confidence::Medium, MCVC_MARKER)
                .software(software)
                .minecraft(minecraft)
                .loader_version(loader_version)
                .at(time),
        );
    }

    if let Some(value) = marker_json(inputs.modpack_marker.as_deref()) {
        let software = string_field(&value, "loader")
            .and_then(Software::from_id)
            .filter(|software| software.family() == Family::Mods);
        let time = string_field(&value, "installed_at")
            .and_then(parse_time)
            .or_else(|| modified(MODPACK_MARKER));
        candidates.push(
            Candidate::new(
                Source::Marker,
                RANK_MARKER,
                Confidence::Medium,
                MODPACK_MARKER,
            )
            .software(software)
            .minecraft(string_field(&value, "minecraft_version").and_then(valid))
            .loader_version(string_field(&value, "loader_version").and_then(safe_version))
            .at(time),
        );
    }

    candidates
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

fn files_candidate(detail: &str, software: Software, time: Option<Time>) -> Candidate {
    Candidate::new(Source::Files, RANK_FILES, Confidence::Medium, detail)
        .software(Some(software))
        .at(time)
}

/// Loader library directories, launcher jars and loader folders: one candidate per loader,
/// ordered by the newest of its files so leftovers of a previous loader lose.
fn loader_files(inputs: &Inputs) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    let intermediary = newest(inputs.fabric_intermediary.as_deref(), |entry| {
        valid(&entry.name)
    })
    .map(|(_, version)| version);

    let present = |names: &[(&str, bool)]| {
        names
            .iter()
            .filter_map(|(name, directory)| inputs.root_entry(name, *directory))
            .collect::<Vec<_>>()
    };

    // Quilt before Fabric: on equal times a Quilt server with Fabric-named files is Quilt.
    let quilt_files = present(&[("quilt-server-launch.jar", false), (".quilt", true)]);
    let quilt_loader = newest(inputs.quilt_loader.as_deref(), |entry| {
        safe_version(&entry.name)
    });
    if !quilt_files.is_empty() || inputs.quilt_loader.is_some() {
        let time = quilt_files
            .iter()
            .map(|entry| entry.modified)
            .chain(quilt_loader.as_ref().map(|(time, _)| *time))
            .max();
        let detail = match &quilt_loader {
            Some((_, version)) => format!("libraries/org/quiltmc/quilt-loader/{version}"),
            None => quilt_files
                .first()
                .map_or("libraries/org/quiltmc/quilt-loader".to_string(), |entry| {
                    entry.name.clone()
                }),
        };
        candidates.push(
            files_candidate(&detail, Software::Quilt, time)
                .minecraft(intermediary.clone())
                .loader_version(quilt_loader.map(|(_, version)| version)),
        );
    }

    static FABRIC_LAUNCHER: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^fabric-server-mc\.([^-]+)-loader\.([^-]+)-launcher\.[^/]*\.jar$").unwrap()
    });
    let mut fabric_files = present(&[
        (".fabric", true),
        ("fabric-server-launch.jar", false),
        ("fabric-server-launcher.properties", false),
    ]);
    let launcher = inputs.root_jars().find_map(|entry| {
        let captures = FABRIC_LAUNCHER.captures(&entry.name)?;
        Some((entry, valid(&captures[1]), safe_version(&captures[2])))
    });
    if let Some((entry, _, _)) = &launcher {
        fabric_files.push(*entry);
    }
    let fabric_loader = newest(inputs.fabric_loader.as_deref(), |entry| {
        safe_version(&entry.name)
    });
    if !fabric_files.is_empty() || inputs.fabric_loader.is_some() {
        let time = fabric_files
            .iter()
            .map(|entry| entry.modified)
            .chain(fabric_loader.as_ref().map(|(time, _)| *time))
            .max();
        let detail = match &fabric_loader {
            Some((_, version)) => format!("libraries/net/fabricmc/fabric-loader/{version}"),
            None => fabric_files.first().map_or(
                "libraries/net/fabricmc/fabric-loader".to_string(),
                |entry| entry.name.clone(),
            ),
        };
        let (launcher_minecraft, launcher_loader) = launcher
            .map(|(_, minecraft, loader)| (minecraft, loader))
            .unwrap_or_default();
        candidates.push(
            files_candidate(&detail, Software::Fabric, time)
                .minecraft(intermediary.or(launcher_minecraft))
                .loader_version(
                    fabric_loader
                        .map(|(_, version)| version)
                        .or(launcher_loader),
                ),
        );
    }

    // NeoForge (`neoforge/<version>`, or `neoforged/forge/1.20.1-<build>`) before Forge.
    let neoforge = newest(inputs.neoforge.as_deref(), |entry| {
        Some((
            format!("libraries/net/neoforged/neoforge/{}", entry.name),
            neoforge_to_minecraft(&entry.name)?,
            safe_version(&entry.name),
        ))
    });
    let neoforged_forge = newest(inputs.neoforged_forge.as_deref(), |entry| {
        let (minecraft, build) = minecraft_prefix(&entry.name)?;
        Some((
            format!("libraries/net/neoforged/forge/{}", entry.name),
            minecraft,
            build,
        ))
    });
    if let Some((time, (detail, minecraft, version))) = [neoforge, neoforged_forge]
        .into_iter()
        .flatten()
        .max_by_key(|(time, _)| *time)
    {
        candidates.push(
            files_candidate(&detail, Software::NeoForge, Some(time))
                .minecraft(Some(minecraft))
                .loader_version(version),
        );
    }

    static LEGACY_FORGE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^forge-([^-]+)-(\d[^/]*?)(?:-universal)?\.jar$").unwrap()
    });
    let forge = newest(inputs.forge.as_deref(), |entry| {
        let (minecraft, build) = minecraft_prefix(&entry.name)?;
        Some((
            format!("libraries/net/minecraftforge/forge/{}", entry.name),
            minecraft,
            build,
        ))
    });
    let legacy = newest(Some(inputs.root.as_slice()), |entry| {
        if entry.directory
            || forge_shim(&entry.name).is_some()
            || entry.name.to_ascii_lowercase().ends_with("-installer.jar")
        {
            return None;
        }
        let captures = LEGACY_FORGE.captures(&entry.name)?;
        Some((
            entry.name.clone(),
            valid(&captures[1])?,
            safe_version(&captures[2]),
        ))
    });
    if let Some((time, (detail, minecraft, version))) = forge.or(legacy) {
        candidates.push(
            files_candidate(&detail, Software::Forge, Some(time))
                .minecraft(Some(minecraft))
                .loader_version(version),
        );
    }

    candidates
}

/// Server jars named after their software (`paper-1.21.4-232.jar`, `mohist-1.20.1-…jar`).
fn jar_names(inputs: &Inputs) -> Vec<Candidate> {
    static JAR: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r"(?i)^(folia|purpur|paper|spigot|craftbukkit|mohist|arclight|youer|velocity|waterfall|bungeecord|spongevanilla)(?:[-_]([^/]*))?\.jar$",
        )
        .unwrap()
    });
    static MINECRAFT_SERVER: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^minecraft_server\.(.+)\.jar$").unwrap());

    inputs
        .root_jars()
        .filter_map(|entry| {
            if let Some(captures) = MINECRAFT_SERVER.captures(&entry.name) {
                let mut candidate =
                    files_candidate(&entry.name, Software::Vanilla, Some(entry.modified))
                        .minecraft(valid(&captures[1]));
                candidate.order = VANILLA_ORDER;
                return Some(candidate);
            }

            let captures = JAR.captures(&entry.name)?;
            let rest = captures.get(2).map_or("", |rest| rest.as_str());
            let software = brand(&captures[1], &captures[1])?;
            let (minecraft, build) = match software {
                Software::Paper | Software::Purpur | Software::Folia => paper_version(rest),
                Software::Velocity | Software::Waterfall | Software::BungeeCord => (None, None),
                _ => (rest.split('-').next().and_then(valid), None),
            };
            Some(
                files_candidate(&entry.name, software, Some(entry.modified))
                    .minecraft(minecraft)
                    .loader_version(build),
            )
        })
        .collect()
}

/// Config files of plugin and proxy servers. Paper-family files only count when they are not
/// older than the newest server jar: a leftover `purpur.yml` must not keep a Paper server Purpur.
fn config_files(inputs: &Inputs) -> Vec<Candidate> {
    let mut candidates = Vec::new();
    let server_jar = inputs.root_jars().map(|entry| entry.modified).max();

    let paper_family = [
        (
            "purpur.yml",
            inputs.root_entry("purpur.yml", false),
            Software::Purpur,
        ),
        (
            "config/paper-global.yml",
            inputs.config_entry("paper-global.yml", false),
            Software::Paper,
        ),
        (
            "paper.yml",
            inputs.root_entry("paper.yml", false),
            Software::Paper,
        ),
        (
            "spigot.yml",
            inputs.root_entry("spigot.yml", false),
            Software::Spigot,
        ),
        (
            "bukkit.yml",
            inputs.root_entry("bukkit.yml", false),
            Software::Bukkit,
        ),
    ];
    let fresh = |entry: &DirEntry| server_jar.is_none_or(|jar| entry.modified >= jar);
    let fresh_index = paper_family
        .iter()
        .position(|(_, entry, _)| entry.is_some_and(fresh));
    if let Some(index) = fresh_index
        && let (path, Some(entry), software) = paper_family[index]
    {
        candidates.push(files_candidate(path, software, Some(entry.modified)));
    }
    if let Some((path, Some(entry), software)) = paper_family
        .iter()
        .take(fresh_index.unwrap_or(paper_family.len()))
        .find(|(_, entry, _)| entry.is_some())
    {
        let mut candidate = files_candidate(path, *software, Some(entry.modified));
        candidate.rank = RANK_STALE;
        candidate.confidence = Confidence::Low;
        candidate.note = Some(Note::Stale);
        candidates.push(candidate);
    }

    for (path, entry, software) in [
        (
            "mohist-config",
            inputs.root_entry("mohist-config", true),
            Software::Mohist,
        ),
        (
            "config/sponge",
            inputs.config_entry("sponge", true),
            Software::Sponge,
        ),
        (
            "velocity.toml",
            inputs.root_entry("velocity.toml", false),
            Software::Velocity,
        ),
        (
            "waterfall.yml",
            inputs.root_entry("waterfall.yml", false),
            Software::Waterfall,
        ),
        (
            "modules.yml",
            inputs.root_entry("modules.yml", false),
            Software::BungeeCord,
        ),
    ] {
        if let Some(entry) = entry {
            candidates.push(files_candidate(path, software, Some(entry.modified)));
        }
    }

    candidates
}

/// The newest `versions/<version>` directory: its Minecraft version, and the software from the
/// jar inside (`paper-<v>.jar` from Paperclip, `server-<v>.jar` from the vanilla bundler).
fn versions_directory(inputs: &Inputs) -> Option<Candidate> {
    let (time, version) = newest(inputs.versions.as_deref(), |entry| {
        if entry.directory {
            valid(&entry.name)
        } else {
            None
        }
    })?;

    let jars = inputs
        .version_jars
        .as_ref()
        .filter(|(name, _)| *name == version)
        .map(|(_, jars)| jars.as_slice())
        .unwrap_or_default();
    let software = jars.iter().find_map(|jar| {
        let name = jar.name.to_ascii_lowercase();
        let (prefix, _) = name.split_once('-')?;
        match prefix {
            "paper" => Some(Software::Paper),
            "purpur" => Some(Software::Purpur),
            "folia" => Some(Software::Folia),
            _ => None,
        }
    });

    let detail = format!("versions/{version}");
    let candidate = files_candidate(&detail, software.unwrap_or(Software::Vanilla), Some(time))
        .minecraft(Some(version));
    Some(match software {
        Some(_) => candidate,
        None => Candidate {
            order: VANILLA_ORDER,
            ..candidate
        },
    })
}

fn from_files(inputs: &Inputs) -> Vec<Candidate> {
    let mut candidates = loader_files(inputs);
    candidates.extend(jar_names(inputs));
    candidates.extend(config_files(inputs));
    candidates.extend(versions_directory(inputs));
    candidates
}

// ---------------------------------------------------------------------------------------------
// Variables and egg
// ---------------------------------------------------------------------------------------------

fn from_variables(variables: &[(String, String)]) -> Option<Candidate> {
    let lookup = |name: &str| {
        variables
            .iter()
            .filter(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.trim())
            .find(|value| !value.is_empty())
    };

    let version = [
        "MINECRAFT_VERSION",
        "MC_VERSION",
        "MCVERSION",
        "VANILLA_VERSION",
        "VERSION",
    ]
    .into_iter()
    .find_map(|name| Some((name, valid(lookup(name)?)?)));

    // A variable explicitly set to a software name (e.g. `SERVER_TYPE=fabric`) is the strongest
    // signal; fall back to loader-specific version variables.
    let by_value = variables
        .iter()
        .find_map(|(key, value)| Some((key.as_str(), Software::from_id(value)?, None)));
    let by_name = [
        ("NEOFORGE_VERSION", Software::NeoForge),
        ("QUILT_VERSION", Software::Quilt),
        ("QUILT_LOADER_VERSION", Software::Quilt),
        ("FABRIC_VERSION", Software::Fabric),
        ("FABRIC_LOADER_VERSION", Software::Fabric),
        ("FORGE_VERSION", Software::Forge),
    ]
    .into_iter()
    .find_map(|(name, software)| {
        let value = lookup(name)?;
        Some((name, software, safe_version(value)))
    });
    let software = by_value.or(by_name);

    let detail = software
        .as_ref()
        .map(|(name, _, _)| *name)
        .or(version.as_ref().map(|(name, _)| *name))?;
    Some(
        Candidate::new(Source::Variables, RANK_VARIABLES, Confidence::Low, detail)
            .software(software.as_ref().map(|(_, software, _)| *software))
            .minecraft(version.map(|(_, version)| version))
            .loader_version(software.and_then(|(_, _, version)| version)),
    )
}

fn from_egg(inputs: &Inputs) -> Option<Candidate> {
    static KEYWORD: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r"(?i)\b(mohist|arclight|youer|folia|purpur|paper|neoforge|forge|quilt|fabric|velocity|waterfall|bungeecord|spigot|craftbukkit|bukkit|sponge|vanilla)\b",
        )
        .unwrap()
    });
    // Most specific first: a "Forge & Paper" nest is ambiguous, an egg named "Paper" is not.
    const PRIORITY: [Software; 17] = [
        Software::Mohist,
        Software::Arclight,
        Software::Youer,
        Software::Folia,
        Software::Purpur,
        Software::Paper,
        Software::NeoForge,
        Software::Forge,
        Software::Quilt,
        Software::Fabric,
        Software::Velocity,
        Software::Waterfall,
        Software::BungeeCord,
        Software::Spigot,
        Software::Bukkit,
        Software::Sponge,
        Software::Vanilla,
    ];

    [
        ("egg", &inputs.egg_name),
        ("nest", &inputs.nest_name),
        ("startup", &inputs.startup),
        ("image", &inputs.image),
    ]
    .into_iter()
    .find_map(|(detail, haystack)| {
        let found: Vec<Software> = KEYWORD
            .captures_iter(haystack)
            .filter_map(|captures| {
                let keyword = captures[1].to_ascii_lowercase();
                match keyword.as_str() {
                    "craftbukkit" => Some(Software::Bukkit),
                    other => Software::from_id(other),
                }
            })
            .collect();
        let software = PRIORITY
            .into_iter()
            .find(|software| found.contains(software))?;
        Some(
            Candidate::new(Source::Egg, RANK_EGG, Confidence::Low, detail).software(Some(software)),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn time(seconds: i64) -> Time {
        chrono::DateTime::from_timestamp(seconds, 0).unwrap()
    }

    fn entry(name: &str, directory: bool, modified: i64) -> DirEntry {
        DirEntry {
            name: name.to_string(),
            directory,
            modified: time(modified),
        }
    }

    fn file(name: &str, modified: i64) -> DirEntry {
        entry(name, false, modified)
    }

    fn dir(name: &str, modified: i64) -> DirEntry {
        entry(name, true, modified)
    }

    fn dirs(names: &[(&str, i64)]) -> Option<Vec<DirEntry>> {
        Some(
            names
                .iter()
                .map(|(name, modified)| dir(name, *modified))
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
        detection: &Detection,
        software: Option<(Software, Source)>,
        version: Option<(&str, Source)>,
    ) {
        assert_eq!(
            detection
                .software
                .as_ref()
                .map(|field| (field.value, field.source)),
            software,
            "software of {detection:#?}"
        );
        assert_eq!(
            detection
                .minecraft_version
                .as_ref()
                .map(|field| (field.value.as_str(), field.source)),
            version,
            "Minecraft version of {detection:#?}"
        );
    }

    fn loader_version(detection: &Detection) -> Option<&str> {
        detection
            .loader_version
            .as_ref()
            .map(|field| field.value.as_str())
    }

    #[test]
    fn fabric_log() {
        let detection = detect(&log(
            "[12:00:00] [main/INFO]: Loading Minecraft 1.20.1 with Fabric Loader 0.15.3\n\
             [12:00:02] [Server thread/INFO]: Starting minecraft server version 1.20.1\n",
        ));
        expect(
            &detection,
            Some((Software::Fabric, Source::Log)),
            Some(("1.20.1", Source::Log)),
        );
        assert_eq!(loader_version(&detection), Some("0.15.3"));
        assert_eq!(detection.mod_loaders, [Loader::Fabric]);
        assert_eq!(detection.family, Some(Family::Mods));
        assert!(detection.minecraft);
    }

    #[test]
    fn quilt_log() {
        let detection = detect(&log(
            "[12:00:00] [main/INFO]: Loading Minecraft 1.19.2 with Quilt Loader 0.19.1\n",
        ));
        expect(
            &detection,
            Some((Software::Quilt, Source::Log)),
            Some(("1.19.2", Source::Log)),
        );
        // Quilt loads Fabric mods too.
        assert_eq!(detection.mod_loaders, [Loader::Quilt, Loader::Fabric]);
    }

    #[test]
    fn forge_modlauncher_log() {
        let detection = detect(&log(
            "[12:00:00] [main/INFO] [cp.mo.mo.Launcher/MODLAUNCHER]: ModLauncher running: args [--launchTarget, forgeserver, --fml.forgeVersion, 47.2.0, --fml.mcVersion, 1.20.1, --fml.forgeGroup, net.minecraftforge, --fml.mcpVersion, 20230612.114412]\n",
        ));
        expect(
            &detection,
            Some((Software::Forge, Source::Log)),
            Some(("1.20.1", Source::Log)),
        );
        assert_eq!(loader_version(&detection), Some("47.2.0"));
    }

    #[test]
    fn neoforge_modlauncher_log() {
        // Older NeoForge still uses the `forgeserver` target but passes a NeoForge version.
        let detection = detect(&log(
            "[main/INFO] [cp.mo.mo.Launcher/MODLAUNCHER]: ModLauncher running: args [--launchTarget, forgeserver, --fml.fmlVersion, 2.0.17, --fml.mcVersion, 1.20.4, --fml.neoForgeVersion, 20.4.80-beta, --fml.neoFormVersion, 20231207.154220]\n",
        ));
        expect(
            &detection,
            Some((Software::NeoForge, Source::Log)),
            Some(("1.20.4", Source::Log)),
        );
        assert_eq!(loader_version(&detection), Some("20.4.80-beta"));

        let detection = detect(&log(
            "ModLauncher running: args [--launchTarget, neoforgeserver, --fml.fmlVersion, 4.0.24, --fml.mcVersion, 1.21.1]\n",
        ));
        expect(
            &detection,
            Some((Software::NeoForge, Source::Log)),
            Some(("1.21.1", Source::Log)),
        );

        // NeoForge for 1.20.1 launches as Forge under its own group, and loads Forge mods.
        let detection = detect(&log(
            "ModLauncher running: args [--launchTarget, forgeserver, --fml.forgeVersion, 47.1.106, --fml.mcVersion, 1.20.1, --fml.forgeGroup, net.neoforged, --fml.mcpVersion, 20230612.114412]\n",
        ));
        expect(
            &detection,
            Some((Software::NeoForge, Source::Log)),
            Some(("1.20.1", Source::Log)),
        );
        assert_eq!(detection.mod_loaders, [Loader::NeoForge, Loader::Forge]);
    }

    #[test]
    fn paper_log_is_a_plugin_server() {
        let detection = detect(&log(
            "[12:00:00 INFO]: Starting minecraft server version 1.20.4\n\
             [12:00:00 INFO]: Loading properties\n\
             [12:00:01 INFO]: This server is running Paper version 1.20.4-496-release (MC: 1.20.4) (Implementing API version 1.20.4-R0.1-SNAPSHOT)\n",
        ));
        expect(
            &detection,
            Some((Software::Paper, Source::Log)),
            Some(("1.20.4", Source::Log)),
        );
        assert_eq!(loader_version(&detection), Some("496"));
        assert_eq!(detection.family, Some(Family::Plugins));
        assert!(detection.mod_loaders.is_empty());
    }

    #[test]
    fn paper_bootstrap_log_before_eula_yields_version() {
        let detection = detect(&log(
            "[15:29:31] [ServerMain/INFO]: [bootstrap] Loading Paper 26.3-32-dev/26.3@0c803ba (2026-09-21T17:06:10Z) for Minecraft 26.3\n\
             [15:29:35] [ServerMain/INFO]: You need to agree to the EULA in order to run the server.\n",
        ));
        expect(
            &detection,
            Some((Software::Paper, Source::Log)),
            Some(("26.3", Source::Log)),
        );
        assert_eq!(loader_version(&detection), Some("32"));
    }

    #[test]
    fn folia_and_proxy_logs() {
        let detection = detect(&log(
            "[ServerMain/INFO]: [bootstrap] Loading Folia 1.21.4-6-ver/1.21.4@abc (2025-01-01T00:00:00Z) for Minecraft 1.21.4\n",
        ));
        expect(
            &detection,
            Some((Software::Folia, Source::Log)),
            Some(("1.21.4", Source::Log)),
        );

        // Proxies have no Minecraft version, only their own.
        let detection = detect(&log(
            "[12:00:00 INFO]: Booting up Velocity 3.4.0-SNAPSHOT (git-a1b2c3d4-b480)...\n",
        ));
        expect(&detection, Some((Software::Velocity, Source::Log)), None);
        assert_eq!(loader_version(&detection), Some("3.4.0-SNAPSHOT"));
        assert_eq!(detection.family, Some(Family::Proxy));

        let detection = detect(&log(
            "[12:00:00 INFO]: Enabled Waterfall version git:Waterfall-Bootstrap:1.21-R0.1-SNAPSHOT:abc:600\n",
        ));
        expect(&detection, Some((Software::Waterfall, Source::Log)), None);
    }

    #[test]
    fn files_forge() {
        let detection = detect(&Inputs {
            root: vec![dir("libraries", 0), file("run.sh", 0)],
            forge: dirs(&[("1.19.2-43.3.0", 10), ("1.20.1-47.2.0", 20)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Forge, Source::Files)),
            Some(("1.20.1", Source::Files)),
        );
        assert_eq!(loader_version(&detection), Some("47.2.0"));
    }

    #[test]
    fn files_legacy_forge_jar() {
        let detection = detect(&Inputs {
            root: vec![
                file("forge-1.12.2-14.23.5.2860.jar", 0),
                file("minecraft_server.1.12.2.jar", 0),
            ],
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Forge, Source::Files)),
            Some(("1.12.2", Source::Files)),
        );
        assert_eq!(loader_version(&detection), Some("14.23.5.2860"));
        assert!(detection.conflicts.is_empty());
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
            let detection = detect(&Inputs {
                neoforge: dirs(&[(neoforge, 0)]),
                ..Default::default()
            });
            expect(
                &detection,
                Some((Software::NeoForge, Source::Files)),
                Some((minecraft, Source::Files)),
            );
            assert_eq!(loader_version(&detection), Some(neoforge));
        }
    }

    #[test]
    fn files_neoforge_picks_newest_entry() {
        let detection = detect(&Inputs {
            neoforge: dirs(&[("21.1.77", 50), ("20.4.237", 10)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::NeoForge, Source::Files)),
            Some(("1.21.1", Source::Files)),
        );
    }

    #[test]
    fn files_neoforged_forge_for_1_20_1() {
        let detection = detect(&Inputs {
            neoforged_forge: dirs(&[("1.20.1-47.1.106", 0)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::NeoForge, Source::Files)),
            Some(("1.20.1", Source::Files)),
        );
        assert_eq!(loader_version(&detection), Some("47.1.106"));
        assert_eq!(detection.mod_loaders, [Loader::NeoForge, Loader::Forge]);
    }

    #[test]
    fn files_fabric_with_intermediary_version() {
        let detection = detect(&Inputs {
            root: vec![dir(".fabric", 0), file("fabric-server-launch.jar", 0)],
            fabric_loader: dirs(&[("0.15.3", 0)]),
            fabric_intermediary: dirs(&[("1.20.1", 5), ("1.20.4", 30)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Fabric, Source::Files)),
            Some(("1.20.4", Source::Files)),
        );
        assert_eq!(loader_version(&detection), Some("0.15.3"));
    }

    #[test]
    fn files_fabric_launcher_jar() {
        let detection = detect(&Inputs {
            root: vec![file(
                "fabric-server-mc.1.21.1-loader.0.16.5-launcher.1.0.1.jar",
                10,
            )],
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Fabric, Source::Files)),
            Some(("1.21.1", Source::Files)),
        );
        assert_eq!(loader_version(&detection), Some("0.16.5"));
    }

    #[test]
    fn files_quilt_checked_before_fabric() {
        let detection = detect(&Inputs {
            root: vec![file("quilt-server-launch.jar", 0)],
            fabric_loader: dirs(&[("0.15.3", 0)]),
            fabric_intermediary: dirs(&[("1.20.1", 0)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Quilt, Source::Files)),
            Some(("1.20.1", Source::Files)),
        );
    }

    #[test]
    fn files_vanilla_versions_directory() {
        let detection = detect(&Inputs {
            versions: dirs(&[("1.21.4", 0)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Vanilla, Source::Files)),
            Some(("1.21.4", Source::Files)),
        );
        assert_eq!(detection.family, Some(Family::Vanilla));
        assert!(detection.mod_loaders.is_empty());
    }

    #[test]
    fn variables_source() {
        let detection = detect(&Inputs {
            variables: vars(&[
                ("SERVER_JARFILE", "server.jar"),
                ("MINECRAFT_VERSION", "1.21.1"),
                ("NEOFORGE_VERSION", "21.1.77"),
            ]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::NeoForge, Source::Variables)),
            Some(("1.21.1", Source::Variables)),
        );
        assert_eq!(loader_version(&detection), Some("21.1.77"));

        let detection = detect(&Inputs {
            variables: vars(&[("SERVER_TYPE", "Fabric"), ("VERSION", "1.20.1")]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Fabric, Source::Variables)),
            Some(("1.20.1", Source::Variables)),
        );
    }

    #[test]
    fn variables_reject_non_versions() {
        let detection = detect(&Inputs {
            variables: vars(&[
                ("MINECRAFT_VERSION", "latest"),
                ("MC_VERSION", "recommended"),
                ("MCVERSION", ""),
                ("VERSION", "snapshot"),
                ("FORGE_VERSION", ""),
            ]),
            ..Default::default()
        });
        expect(&detection, None, None);
        assert!(!detection.minecraft);

        // `latest` is skipped, the next candidate is used.
        let detection = detect(&Inputs {
            variables: vars(&[("MINECRAFT_VERSION", "latest"), ("VERSION", "1.20.6")]),
            ..Default::default()
        });
        expect(&detection, None, Some(("1.20.6", Source::Variables)));
    }

    #[test]
    fn egg_fallback() {
        let detection = detect(&Inputs {
            egg_name: "NeoForge".to_string(),
            nest_name: "Minecraft".to_string(),
            startup: "java -jar server.jar".to_string(),
            ..Default::default()
        });
        expect(&detection, Some((Software::NeoForge, Source::Egg)), None);

        let detection = detect(&Inputs {
            egg_name: "Modded Server".to_string(),
            nest_name: "Minecraft".to_string(),
            startup: "java -jar quilt-server-launch.jar nogui".to_string(),
            image: "ghcr.io/pterodactyl/yolks:java_17".to_string(),
            ..Default::default()
        });
        expect(&detection, Some((Software::Quilt, Source::Egg)), None);

        let detection = detect(&Inputs {
            egg_name: "Paper".to_string(),
            nest_name: "Minecraft".to_string(),
            ..Default::default()
        });
        expect(&detection, Some((Software::Paper, Source::Egg)), None);
        assert_eq!(detection.family, Some(Family::Plugins));
    }

    #[test]
    fn egg_name_beats_nest_name() {
        // A "Paper" egg in a "Forge & Paper" nest is Paper; "neoforge" is not "forge".
        let detection = detect(&Inputs {
            egg_name: "Paper".to_string(),
            nest_name: "Forge & Paper".to_string(),
            ..Default::default()
        });
        expect(&detection, Some((Software::Paper, Source::Egg)), None);

        let detection = detect(&Inputs {
            egg_name: "Modded".to_string(),
            nest_name: "NeoForge servers".to_string(),
            ..Default::default()
        });
        expect(&detection, Some((Software::NeoForge, Source::Egg)), None);
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
            &detect(&all),
            Some((Software::Fabric, Source::Log)),
            Some(("1.20.1", Source::Log)),
        );

        let without_log = Inputs {
            latest_log: None,
            ..all.clone()
        };
        expect(
            &detect(&without_log),
            Some((Software::Forge, Source::Files)),
            Some(("1.19.2", Source::Files)),
        );

        let variables_and_egg = Inputs {
            forge: None,
            ..without_log.clone()
        };
        expect(
            &detect(&variables_and_egg),
            Some((Software::Quilt, Source::Variables)),
            Some(("1.18.2", Source::Variables)),
        );

        let egg_only = Inputs {
            variables: Vec::new(),
            ..variables_and_egg
        };
        expect(
            &detect(&egg_only),
            Some((Software::NeoForge, Source::Egg)),
            None,
        );

        // A fresh log that only names the version still wins it, and the files are a conflict.
        let mixed = Inputs {
            latest_log: Some("Starting minecraft server version 1.21.4\n".to_string()),
            ..without_log
        };
        let detection = detect(&mixed);
        expect(
            &detection,
            Some((Software::Forge, Source::Files)),
            Some(("1.21.4", Source::Log)),
        );
        assert_eq!(detection.conflicts.len(), 1);
        assert_eq!(
            detection.conflicts[0].minecraft_version.as_deref(),
            Some("1.19.2")
        );
    }

    #[test]
    fn stale_log_loses_to_newer_libraries() {
        // The log is from before a switch to NeoForge 1.21.1.
        let detection = detect(&Inputs {
            latest_log: Some("Loading Minecraft 1.20.1 with Fabric Loader 0.15.3\n".to_string()),
            logs: Some(vec![file("latest.log", 100)]),
            neoforge: dirs(&[("21.1.77", 200)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::NeoForge, Source::Files)),
            Some(("1.21.1", Source::Files)),
        );
        assert!(detection.log_stale);
        let log = detection
            .evidence
            .iter()
            .find(|evidence| evidence.source == Source::Log)
            .unwrap();
        assert_eq!(log.note, Some(Note::Stale));
        assert!(detection.conflicts.is_empty());

        // A marker's install time counts as well.
        let detection = detect(&Inputs {
            latest_log: Some("Loading Minecraft 1.20.1 with Fabric Loader 0.15.3\n".to_string()),
            logs: Some(vec![file("latest.log", 100)]),
            mcvc_marker: Some(
                r#"{"type":"NEOFORGE","version":"1.21.1","buildName":"21.1.77","installedAt":"2026-01-01T00:00:00Z"}"#
                    .to_string(),
            ),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::NeoForge, Source::Marker)),
            Some(("1.21.1", Source::Marker)),
        );
        assert!(detection.log_stale);

        // A log written after the install wins.
        let detection = detect(&Inputs {
            latest_log: Some("Loading Minecraft 1.21.1 with Fabric Loader 0.16.5\n".to_string()),
            logs: Some(vec![file("latest.log", 300)]),
            fabric_loader: dirs(&[("0.16.5", 200)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Fabric, Source::Log)),
            Some(("1.21.1", Source::Log)),
        );
        assert!(!detection.log_stale);
    }

    #[test]
    fn neoforge_to_forge_leftovers() {
        // Switched back to Forge: the NeoForge libraries are older leftovers.
        let detection = detect(&Inputs {
            neoforge: dirs(&[("21.1.77", 100)]),
            forge: dirs(&[("1.21.1-52.0.40", 200)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Forge, Source::Files)),
            Some(("1.21.1", Source::Files)),
        );
        assert_eq!(loader_version(&detection), Some("52.0.40"));
        assert_eq!(detection.conflicts.len(), 1);
        assert_eq!(detection.conflicts[0].software, Some(Software::NeoForge));
    }

    #[test]
    fn quilt_to_fabric_leftovers() {
        let detection = detect(&Inputs {
            root: vec![dir(".fabric", 200), file("fabric-server-launch.jar", 200)],
            quilt_loader: dirs(&[("0.26.0", 100)]),
            fabric_loader: dirs(&[("0.16.5", 200)]),
            fabric_intermediary: dirs(&[("1.21.1", 200)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Fabric, Source::Files)),
            Some(("1.21.1", Source::Files)),
        );
        assert_eq!(detection.mod_loaders, [Loader::Fabric]);
        assert_eq!(detection.conflicts.len(), 1);
        assert_eq!(detection.conflicts[0].software, Some(Software::Quilt));
    }

    #[test]
    fn downgrade_uses_newest_versions_directory() {
        let detection = detect(&Inputs {
            versions: dirs(&[("1.21.4", 100), ("1.20.6", 200)]),
            version_jars: Some(("1.20.6".to_string(), vec![file("paper-1.20.6.jar", 200)])),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Paper, Source::Files)),
            Some(("1.20.6", Source::Files)),
        );
    }

    #[test]
    fn plugin_and_proxy_servers_are_recognised() {
        let paper = detect(&Inputs {
            root: vec![
                file("server.jar", 100),
                file("bukkit.yml", 150),
                file("spigot.yml", 150),
                dir("config", 150),
            ],
            config: Some(vec![file("paper-global.yml", 150)]),
            version_history: Some(
                r#"{"currentVersion":"1.21.4-232-main@abc1234 (2025-02-01T00:00:00Z)"}"#
                    .to_string(),
            ),
            ..Default::default()
        });
        expect(
            &paper,
            Some((Software::Paper, Source::VersionHistory)),
            Some(("1.21.4", Source::VersionHistory)),
        );
        assert_eq!(loader_version(&paper), Some("232"));
        assert_eq!(paper.family, Some(Family::Plugins));
        assert!(paper.mod_loaders.is_empty());

        let old_paper = detect(&Inputs {
            version_history: Some(r#"{"currentVersion":"git-Paper-196 (MC: 1.20.1)"}"#.to_string()),
            ..Default::default()
        });
        expect(
            &old_paper,
            Some((Software::Paper, Source::VersionHistory)),
            Some(("1.20.1", Source::VersionHistory)),
        );
        assert_eq!(loader_version(&old_paper), Some("196"));

        let purpur = detect(&Inputs {
            root: vec![
                file("server.jar", 100),
                file("purpur.yml", 150),
                file("spigot.yml", 150),
            ],
            config: Some(vec![file("paper-global.yml", 150)]),
            ..Default::default()
        });
        expect(&purpur, Some((Software::Purpur, Source::Files)), None);

        let velocity = detect(&Inputs {
            root: vec![file("velocity.jar", 100), file("velocity.toml", 100)],
            ..Default::default()
        });
        expect(&velocity, Some((Software::Velocity, Source::Files)), None);
        assert_eq!(velocity.family, Some(Family::Proxy));

        let bungee = detect(&Inputs {
            root: vec![file("modules.yml", 100), file("config.yml", 100)],
            ..Default::default()
        });
        expect(&bungee, Some((Software::BungeeCord, Source::Files)), None);

        let spigot = detect(&Inputs {
            root: vec![file("spigot.yml", 100), file("bukkit.yml", 100)],
            ..Default::default()
        });
        expect(&spigot, Some((Software::Spigot, Source::Files)), None);
    }

    #[test]
    fn stale_purpur_config_does_not_keep_paper_purpur() {
        let detection = detect(&Inputs {
            root: vec![
                file("server.jar", 200),
                file("purpur.yml", 100),
                file("spigot.yml", 250),
            ],
            config: Some(vec![file("paper-global.yml", 250)]),
            ..Default::default()
        });
        expect(&detection, Some((Software::Paper, Source::Files)), None);
        let purpur = detection
            .evidence
            .iter()
            .find(|evidence| evidence.software == Some(Software::Purpur))
            .unwrap();
        assert_eq!(purpur.note, Some(Note::Stale));
    }

    #[test]
    fn folia_beats_paper_config() {
        // Folia writes Paper's config; its egg (or jar) names it.
        let by_egg = detect(&Inputs {
            root: vec![file("server.jar", 100)],
            config: Some(vec![file("paper-global.yml", 200)]),
            egg_name: "Folia".to_string(),
            ..Default::default()
        });
        expect(&by_egg, Some((Software::Folia, Source::Egg)), None);

        let by_jar = detect(&Inputs {
            root: vec![file("folia-1.21.4-6.jar", 100)],
            config: Some(vec![file("paper-global.yml", 200)]),
            ..Default::default()
        });
        expect(
            &by_jar,
            Some((Software::Folia, Source::Files)),
            Some(("1.21.4", Source::Files)),
        );

        // Without any name it stays Paper.
        let unnamed = detect(&Inputs {
            root: vec![file("server.jar", 100)],
            config: Some(vec![file("paper-global.yml", 200)]),
            ..Default::default()
        });
        expect(&unnamed, Some((Software::Paper, Source::Files)), None);
    }

    #[test]
    fn hybrids_beat_their_loader_and_bukkit_files() {
        let mohist = detect(&Inputs {
            root: vec![
                file("mohist-1.20.1-929-server.jar", 100),
                file("bukkit.yml", 150),
                file("spigot.yml", 150),
                dir("mohist-config", 150),
            ],
            forge: dirs(&[("1.20.1-47.2.0", 160)]),
            ..Default::default()
        });
        expect(
            &mohist,
            Some((Software::Mohist, Source::Files)),
            Some(("1.20.1", Source::Files)),
        );
        assert_eq!(mohist.family, Some(Family::Hybrid));
        assert_eq!(mohist.mod_loaders, [Loader::Forge]);
        assert!(mohist.conflicts.is_empty());

        let arclight_egg = detect(&Inputs {
            root: vec![file("server.jar", 100), file("bukkit.yml", 150)],
            forge: dirs(&[("1.20.1-47.2.0", 160)]),
            egg_name: "Arclight".to_string(),
            ..Default::default()
        });
        expect(
            &arclight_egg,
            Some((Software::Arclight, Source::Egg)),
            Some(("1.20.1", Source::Files)),
        );

        let youer = detect(&Inputs {
            root: vec![file("youer-1.21.1.jar", 100)],
            neoforge: dirs(&[("21.1.77", 100)]),
            ..Default::default()
        });
        expect(
            &youer,
            Some((Software::Youer, Source::Files)),
            Some(("1.21.1", Source::Files)),
        );
        assert_eq!(youer.mod_loaders, [Loader::NeoForge]);
    }

    #[test]
    fn launch_arguments() {
        let run_sh = "#!/usr/bin/env sh\n\
            java @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.20.1-47.4.2/unix_args.txt \"$@\"\n";
        assert_eq!(
            referenced_args_file(run_sh).as_deref(),
            Some("libraries/net/minecraftforge/forge/1.20.1-47.4.2/unix_args.txt")
        );
        assert_eq!(
            referenced_args_file("java @libraries/../../etc/unix_args.txt"),
            None
        );

        let detection = detect(&Inputs {
            root: vec![file("run.sh", 100)],
            run_sh: Some(run_sh.to_string()),
            argfile: Some((
                "libraries/net/minecraftforge/forge/1.20.1-47.4.2/unix_args.txt".to_string(),
                "--launchTarget forgeserver\n--fml.forgeVersion 47.4.2\n--fml.mcVersion 1.20.1\n\
                 --fml.forgeGroup net.neoforged\n"
                    .to_string(),
            )),
            egg_name: "Forge".to_string(),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::NeoForge, Source::Args)),
            Some(("1.20.1", Source::Args)),
        );
        assert_eq!(loader_version(&detection), Some("47.4.2"));

        let shim = detect(&Inputs {
            root: vec![file("forge-1.21.10-60.1.0-shim.jar", 100)],
            ..Default::default()
        });
        expect(
            &shim,
            Some((Software::Forge, Source::Args)),
            Some(("1.21.10", Source::Args)),
        );
        assert_eq!(loader_version(&shim), Some("60.1.0"));

        let neoforge = detect(&Inputs {
            unix_args: Some(
                "--launchTarget forgeserver\n--fml.neoForgeVersion 21.1.257\n--fml.mcVersion 1.21.1\n"
                    .to_string(),
            ),
            ..Default::default()
        });
        expect(
            &neoforge,
            Some((Software::NeoForge, Source::Args)),
            Some(("1.21.1", Source::Args)),
        );

        // Commented-out lines name nothing.
        let commented = detect(&Inputs {
            run_sh: Some(
                "# java -jar forge-1.20.4-49.0.1-shim.jar\njava -jar server.jar\n".to_string(),
            ),
            ..Default::default()
        });
        expect(&commented, None, None);
    }

    #[test]
    fn old_launch_arguments_lose_to_newer_files() {
        // run.sh from a Forge install, then a switch to Fabric.
        let detection = detect(&Inputs {
            root: vec![file("run.sh", 100), file("fabric-server-launch.jar", 200)],
            run_sh: Some(
                "java @libraries/net/minecraftforge/forge/1.20.1-47.4.2/unix_args.txt\n"
                    .to_string(),
            ),
            argfile: Some((
                "libraries/net/minecraftforge/forge/1.20.1-47.4.2/unix_args.txt".to_string(),
                "--fml.forgeVersion 47.4.2 --fml.mcVersion 1.20.1".to_string(),
            )),
            fabric_intermediary: dirs(&[("1.21.1", 200)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Fabric, Source::Files)),
            Some(("1.21.1", Source::Files)),
        );
        let args = detection
            .evidence
            .iter()
            .find(|evidence| evidence.source == Source::Args)
            .unwrap();
        assert_eq!(args.note, Some(Note::Superseded));
        assert_eq!(detection.conflicts.len(), 1);
    }

    #[test]
    fn markers() {
        let modpack = detect(&Inputs {
            modpack_marker: Some(
                r#"{"name":"Pack","loader":"fabric","loader_version":"0.16.5","minecraft_version":"1.21.1","installed_at":"2026-01-01T00:00:00Z"}"#
                    .to_string(),
            ),
            egg_name: "Forge".to_string(),
            ..Default::default()
        });
        expect(
            &modpack,
            Some((Software::Fabric, Source::Marker)),
            Some(("1.21.1", Source::Marker)),
        );
        assert_eq!(loader_version(&modpack), Some("0.16.5"));

        let mcvc = detect(&Inputs {
            mcvc_marker: Some(
                r##"{"type":"PAPER","version":"1.21.1","buildId":298600,"buildName":"#142","installedAt":"2026-10-02T10:00:00+00:00"}"##
                    .to_string(),
            ),
            ..Default::default()
        });
        expect(
            &mcvc,
            Some((Software::Paper, Source::Marker)),
            Some(("1.21.1", Source::Marker)),
        );
        assert_eq!(loader_version(&mcvc), Some("142"));

        // An older marker loses to newer files of another loader.
        let superseded = detect(&Inputs {
            modpack_marker: Some(
                r#"{"loader":"fabric","minecraft_version":"1.21.1","installed_at":"1970-01-01T00:01:40Z"}"#
                    .to_string(),
            ),
            neoforge: dirs(&[("21.1.77", 200)]),
            ..Default::default()
        });
        expect(
            &superseded,
            Some((Software::NeoForge, Source::Files)),
            Some(("1.21.1", Source::Files)),
        );
    }

    #[test]
    fn manual_override() {
        let inputs = Inputs {
            override_file: Some(
                r#"{"override":{"software":"quilt","minecraftVersion":"1.20.1","loaderVersion":null},"setAt":"2026-11-24T10:00:00Z"}"#
                    .to_string(),
            ),
            forge: dirs(&[("1.21.1-52.0.40", 200)]),
            ..Default::default()
        };
        let detection = detect(&inputs);
        expect(
            &detection,
            Some((Software::Quilt, Source::Override)),
            Some(("1.20.1", Source::Override)),
        );
        assert_eq!(
            detection.manual_override,
            Some(ManualOverride {
                software: Software::Quilt,
                minecraft_version: Some("1.20.1".to_string()),
                loader_version: None,
                set_at: Some("2026-11-24T10:00:00Z".to_string()),
            })
        );
        // The Forge files disagree, so the page can warn.
        assert_eq!(detection.conflicts.len(), 1);

        // Only the software: the version comes from the files.
        let detection = detect(&Inputs {
            override_file: Some(r#"{"override":{"software":"forge"}}"#.to_string()),
            ..inputs.clone()
        });
        expect(
            &detection,
            Some((Software::Forge, Source::Override)),
            Some(("1.21.1", Source::Files)),
        );

        // An invalid override is ignored and noted.
        for invalid in [
            "not json",
            r#"{"override":{"software":"bedrock"}}"#,
            r#"{"override":{"software":"fabric","minecraftVersion":"latest"}}"#,
        ] {
            let detection = detect(&Inputs {
                override_file: Some(invalid.to_string()),
                ..inputs.clone()
            });
            expect(
                &detection,
                Some((Software::Forge, Source::Files)),
                Some(("1.21.1", Source::Files)),
            );
            assert_eq!(detection.manual_override, None);
            assert_eq!(detection.evidence[0].note, Some(Note::Invalid));
        }
    }

    #[test]
    fn snapshots() {
        let detection = detect(&log(
            "[Server thread/INFO]: Starting minecraft server version 24w14a\n",
        ));
        expect(&detection, None, Some(("24w14a", Source::Log)));

        let detection = detect(&Inputs {
            versions: dirs(&[("26.3-pre-2", 0)]),
            ..Default::default()
        });
        expect(
            &detection,
            Some((Software::Vanilla, Source::Files)),
            Some(("26.3-pre-2", Source::Files)),
        );
    }

    #[test]
    fn not_minecraft() {
        let detection = detect(&Inputs {
            root: vec![file("7DaysToDieServer.x86_64", 0), dir("Data", 0)],
            egg_name: "7 Days to Die".to_string(),
            nest_name: "Survival".to_string(),
            ..Default::default()
        });
        assert!(!detection.minecraft);
        assert_eq!(detection.software, None);

        let detection = detect(&Inputs {
            root: vec![file("server.properties", 0), file("eula.txt", 0)],
            ..Default::default()
        });
        assert!(detection.minecraft);
        assert_eq!(detection.software, None);
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
