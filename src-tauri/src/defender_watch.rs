//! Conservative, flat download-folder polling. A quiet file alone is not a
//! completion signal: automatic checks require an observed temporary download
//! to be renamed to a final name without changing its Windows file identity.
//! Direct-to-final downloads and temporary files missed between polls require
//! a manual scan; this is not prevention before execution.

use super::defender_windows::{file_stamp, ready_file, FileStamp};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAX_FOLDERS: usize = 8;
const MAX_FOLDER_ENTRIES: usize = 2_048;
const MAX_TRACKED_PER_FOLDER: usize = 512;
const MAX_BATCH: usize = 64;
const MAX_HISTORY: usize = 4_096;
const MAX_AUTO_FILE_SIZE: u64 = 512 * 1024 * 1024;
const SETTLE_TIME: Duration = Duration::from_secs(6);

const FOLDER_UNAVAILABLE: &str = "A selected folder could not be read.";
const FOLDER_TOO_LARGE: &str =
    "A selected folder has more than 2,048 items. Choose a smaller download folder.";
const TOO_MANY_FOLDERS: &str = "Automatic download checking supports up to eight selected folders.";
const TOO_MANY_DOWNLOADS: &str = "Too many temporary downloads are present to track them all. Use Scan File for downloads that were not checked.";
const FILE_TOO_LARGE: &str = "An automatic check was skipped because the download exceeds 512 MiB. Use Scan File to check it manually.";

pub struct WatchBatch {
    pub ready: Vec<PathBuf>,
    pub warning: Option<String>,
    pub pause: bool,
}

pub struct DownloadWatcher {
    started: Instant,
    folders: HashMap<PathBuf, FolderState>,
    history: History,
    warned: HashSet<&'static str>,
}

#[derive(Default)]
struct FolderState {
    tracked: HashMap<String, Candidate>,
}

struct Candidate {
    path: PathBuf,
    final_path: PathBuf,
    stamp: FileStamp,
    final_since: Option<Duration>,
}

struct Entry {
    path: PathBuf,
    stamp: FileStamp,
    temporary: bool,
}

#[derive(Default)]
struct History {
    seen: HashSet<FileStamp>,
    order: VecDeque<FileStamp>,
}

impl History {
    fn remember(&mut self, stamp: FileStamp) {
        if self.seen.insert(stamp.clone()) {
            self.order.push_back(stamp);
        }
        while self.order.len() > MAX_HISTORY {
            if let Some(oldest) = self.order.pop_front() {
                self.seen.remove(&oldest);
            }
        }
    }
}

impl DownloadWatcher {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            folders: HashMap::new(),
            history: History::default(),
            warned: HashSet::new(),
        }
    }

    /// Discard observations and queued candidates when either toggle is off.
    /// Final files already present on restart are deliberately not scanned.
    pub fn reset(&mut self) {
        self.folders.clear();
        self.history = History::default();
        self.warned.clear();
        self.started = Instant::now();
    }

    /// A zero budget still observes renames and writes without consuming ready
    /// candidates. The caller supplies its remaining bounded queue capacity.
    pub fn poll_with_limit(&mut self, folders: &[PathBuf], limit: usize) -> WatchBatch {
        let selected: Vec<PathBuf> = folders
            .iter()
            .take(MAX_FOLDERS)
            .cloned()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        self.folders.retain(|path, _| selected.contains(path));
        let mut batch = WatchBatch {
            ready: Vec::new(),
            warning: None,
            pause: false,
        };
        let mut warnings = Vec::new();
        if folders.len() > MAX_FOLDERS {
            warnings.push(TOO_MANY_FOLDERS);
        }
        let now = self.started.elapsed();
        let budget = limit.min(MAX_BATCH);
        for folder in selected {
            let expected_finals = self
                .folders
                .get(&folder)
                .map(FolderState::expected_finals)
                .unwrap_or_default();
            match snapshot(&folder, &expected_finals) {
                Ok(entries) => {
                    self.folders.entry(folder).or_default().update(
                        entries,
                        now,
                        &mut self.history,
                        budget.saturating_sub(batch.ready.len()),
                        ready_file,
                        &mut batch.ready,
                        &mut warnings,
                    );
                }
                Err(warning) => {
                    // Do not correlate a later final file with observations
                    // made before a gap in access or an incomplete snapshot.
                    self.folders.remove(&folder);
                    warnings.push(warning);
                    batch.pause = true;
                }
            }
        }
        if let Some(warning) = warnings
            .into_iter()
            .find(|warning| !self.warned.contains(warning))
        {
            self.warned.insert(warning);
            batch.warning = Some(warning.to_string());
        }
        batch
    }
}

fn temporary_name(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "crdownload" | "part" | "download" | "partial" | "opdownload" | "filepart"
            )
        })
        .unwrap_or(false)
}

fn expected_final(path: &Path) -> PathBuf {
    path.with_extension("")
}

fn snapshot(folder: &Path, expected_finals: &HashSet<PathBuf>) -> Result<Vec<Entry>, &'static str> {
    let directory = fs::symlink_metadata(folder).map_err(|_| FOLDER_UNAVAILABLE)?;
    if !directory.is_dir() || directory.file_type().is_symlink() {
        return Err(FOLDER_UNAVAILABLE);
    }
    let mut entries = Vec::new();
    for (index, item) in fs::read_dir(folder)
        .map_err(|_| FOLDER_UNAVAILABLE)?
        .enumerate()
    {
        if index >= MAX_FOLDER_ENTRIES {
            return Err(FOLDER_TOO_LARGE);
        }
        let item = item.map_err(|_| FOLDER_UNAVAILABLE)?;
        let kind = item.file_type().map_err(|_| FOLDER_UNAVAILABLE)?;
        if !kind.is_file() || kind.is_symlink() {
            continue;
        }
        let path = item.path();
        let temporary = temporary_name(&path);
        if !temporary && !expected_finals.contains(&path) {
            // Existing/direct-to-final files are intentionally ignored, and avoiding
            // metadata opens for them keeps polling light even in a large folder.
            continue;
        }
        // A file can vanish during enumeration. Do not retain its previous
        // candidate: the complete snapshot below will drop missing identities.
        if let Ok(stamp) = file_stamp(&path) {
            entries.push(Entry {
                temporary,
                path,
                stamp,
            });
        }
    }
    Ok(entries)
}

impl FolderState {
    fn expected_finals(&self) -> HashSet<PathBuf> {
        self.tracked
            .values()
            .map(|candidate| candidate.final_path.clone())
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    fn update(
        &mut self,
        entries: Vec<Entry>,
        now: Duration,
        history: &mut History,
        limit: usize,
        mut check_ready: impl FnMut(&Path) -> Result<FileStamp, String>,
        ready: &mut Vec<PathBuf>,
        warnings: &mut Vec<&'static str>,
    ) {
        let mut by_identity: HashMap<String, Vec<Entry>> = HashMap::new();
        for entry in entries {
            by_identity
                .entry(entry.stamp.identity.clone())
                .or_default()
                .push(entry);
        }
        self.tracked
            .retain(|identity, _| by_identity.contains_key(identity));
        let initial_ready = ready.len();
        for (identity, entries) in by_identity {
            if let Some(temporary) = entries.iter().find(|entry| entry.temporary) {
                if self.tracked.contains_key(&identity)
                    || self.tracked.len() < MAX_TRACKED_PER_FOLDER
                {
                    self.tracked.insert(
                        identity,
                        Candidate {
                            path: temporary.path.clone(),
                            final_path: expected_final(&temporary.path),
                            stamp: temporary.stamp.clone(),
                            final_since: None,
                        },
                    );
                } else {
                    warnings.push(TOO_MANY_DOWNLOADS);
                }
                continue;
            }
            let Some(candidate) = self.tracked.get_mut(&identity) else {
                // No observed temporary identity: existing and direct-to-final
                // files are never considered completed just because they sit still.
                continue;
            };
            if entries.len() != 1 {
                // Multiple hard-link aliases are not an unambiguous rename.
                candidate.final_since = None;
                continue;
            }
            let entry = &entries[0];
            if candidate.path != entry.path
                || candidate.stamp != entry.stamp
                || candidate.final_since.is_none()
            {
                candidate.path = entry.path.clone();
                candidate.stamp = entry.stamp.clone();
                candidate.final_since = Some(now);
                continue;
            }
            if history.seen.contains(&entry.stamp) {
                self.tracked.remove(&identity);
                continue;
            }
            if entry.stamp.size > MAX_AUTO_FILE_SIZE {
                history.remember(entry.stamp.clone());
                self.tracked.remove(&identity);
                warnings.push(FILE_TOO_LARGE);
                continue;
            }
            if now.saturating_sub(candidate.final_since.unwrap_or(now)) < SETTLE_TIME
                || ready.len() - initial_ready >= limit
            {
                continue;
            }
            match check_ready(&entry.path) {
                Ok(current) if current == entry.stamp => {
                    ready.push(entry.path.clone());
                    history.remember(current);
                    self.tracked.remove(&identity);
                }
                Ok(current) => {
                    // A write/replacement raced the folder snapshot. The scan
                    // service independently revalidates again when opening it.
                    candidate.stamp = current;
                    candidate.final_since = Some(now);
                }
                Err(_) => {
                    // A writer still owns the file, or it disappeared. Keep it
                    // pending only while future snapshots show the same identity.
                    candidate.final_since = Some(now);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, identity: &str, size: u64, modified: u64) -> Entry {
        let path = PathBuf::from(name);
        Entry {
            temporary: temporary_name(&path),
            path,
            stamp: FileStamp {
                identity: identity.into(),
                size,
                modified,
            },
        }
    }

    #[derive(Default)]
    struct Harness {
        folder: FolderState,
        history: History,
    }

    impl Harness {
        fn poll(
            &mut self,
            second: u64,
            entries: Vec<Entry>,
            limit: usize,
        ) -> (Vec<PathBuf>, Vec<&'static str>) {
            let stamps: HashMap<PathBuf, FileStamp> = entries
                .iter()
                .map(|entry| (entry.path.clone(), entry.stamp.clone()))
                .collect();
            let mut ready = Vec::new();
            let mut warnings = Vec::new();
            self.folder.update(
                entries,
                Duration::from_secs(second),
                &mut self.history,
                limit,
                |path| stamps.get(path).cloned().ok_or_else(|| "missing".into()),
                &mut ready,
                &mut warnings,
            );
            (ready, warnings)
        }
    }

    #[test]
    fn stable_final_files_without_observed_temporary_are_ignored() {
        let mut harness = Harness::default();
        assert!(harness
            .poll(0, vec![entry("old.exe", "old", 12, 1)], MAX_BATCH)
            .0
            .is_empty());
        assert!(harness
            .poll(10, vec![entry("new.exe", "new", 12, 1)], MAX_BATCH)
            .0
            .is_empty());
        assert!(harness
            .poll(100, vec![entry("new.exe", "new", 12, 1)], MAX_BATCH)
            .0
            .is_empty());
    }

    #[test]
    fn rename_requires_same_identity_and_six_quiet_seconds() {
        let mut harness = Harness::default();
        harness.poll(
            0,
            vec![entry("file.exe.crdownload", "same", 10, 1)],
            MAX_BATCH,
        );
        assert!(harness
            .poll(2, vec![entry("file.exe", "same", 10, 2)], MAX_BATCH)
            .0
            .is_empty());
        assert!(harness
            .poll(6, vec![entry("file.exe", "same", 10, 2)], MAX_BATCH)
            .0
            .is_empty());
        assert_eq!(
            harness
                .poll(8, vec![entry("file.exe", "same", 10, 2)], MAX_BATCH)
                .0,
            vec![PathBuf::from("file.exe")]
        );
        assert!(harness
            .poll(10, vec![entry("file.exe", "same", 10, 2)], MAX_BATCH)
            .0
            .is_empty());
    }

    #[test]
    fn ongoing_same_size_writes_restart_settling() {
        let mut harness = Harness::default();
        harness.poll(0, vec![entry("file.part", "same", 10, 1)], MAX_BATCH);
        harness.poll(2, vec![entry("file", "same", 10, 2)], MAX_BATCH);
        assert!(harness
            .poll(8, vec![entry("file", "same", 10, 3)], MAX_BATCH)
            .0
            .is_empty());
        assert!(harness
            .poll(12, vec![entry("file", "same", 10, 3)], MAX_BATCH)
            .0
            .is_empty());
        assert_eq!(
            harness
                .poll(14, vec![entry("file", "same", 10, 3)], MAX_BATCH)
                .0
                .len(),
            1
        );
    }

    #[test]
    fn replacement_or_missing_temporary_cannot_complete_candidate() {
        let mut harness = Harness::default();
        harness.poll(0, vec![entry("file.part", "old", 10, 1)], MAX_BATCH);
        harness.poll(2, vec![entry("file", "replacement", 10, 1)], MAX_BATCH);
        assert!(harness
            .poll(20, vec![entry("file", "replacement", 10, 1)], MAX_BATCH)
            .0
            .is_empty());
        harness.poll(22, vec![entry("next.part", "next", 10, 1)], MAX_BATCH);
        harness.poll(24, vec![], MAX_BATCH);
        assert!(harness
            .poll(40, vec![entry("next", "next", 10, 1)], MAX_BATCH)
            .0
            .is_empty());
    }

    #[test]
    fn queue_budget_zero_keeps_settled_candidate_pending() {
        let mut harness = Harness::default();
        harness.poll(0, vec![entry("file.part", "same", 10, 1)], 0);
        harness.poll(2, vec![entry("file", "same", 10, 2)], 0);
        assert!(harness
            .poll(8, vec![entry("file", "same", 10, 2)], 0)
            .0
            .is_empty());
        assert_eq!(
            harness
                .poll(10, vec![entry("file", "same", 10, 2)], 1)
                .0
                .len(),
            1
        );
    }

    #[test]
    fn duplicate_temporary_cycle_same_version_is_not_queued_twice() {
        let mut harness = Harness::default();
        harness.poll(0, vec![entry("file.part", "same", 10, 1)], MAX_BATCH);
        harness.poll(2, vec![entry("file", "same", 10, 2)], MAX_BATCH);
        assert_eq!(
            harness
                .poll(8, vec![entry("file", "same", 10, 2)], MAX_BATCH)
                .0
                .len(),
            1
        );
        harness.poll(10, vec![entry("file.part", "same", 10, 2)], MAX_BATCH);
        harness.poll(12, vec![entry("file", "same", 10, 2)], MAX_BATCH);
        assert!(harness
            .poll(20, vec![entry("file", "same", 10, 2)], MAX_BATCH)
            .0
            .is_empty());
    }

    #[test]
    fn reset_discards_candidates_and_restart_does_not_scan_existing_finals() {
        let mut watcher = DownloadWatcher::new();
        let mut harness = Harness::default();
        harness.poll(0, vec![entry("file.part", "same", 10, 1)], MAX_BATCH);
        watcher
            .folders
            .insert(PathBuf::from("downloads"), harness.folder);
        watcher.warned.insert(FILE_TOO_LARGE);
        watcher.reset();
        assert!(watcher.folders.is_empty());
        assert!(watcher.history.seen.is_empty());
        assert!(watcher.warned.is_empty());
        let mut restarted = Harness::default();
        restarted.poll(0, vec![entry("file", "same", 10, 2)], MAX_BATCH);
        assert!(restarted
            .poll(20, vec![entry("file", "same", 10, 2)], MAX_BATCH)
            .0
            .is_empty());
    }

    #[test]
    fn oversized_download_is_skipped_and_warned_once_per_version() {
        let mut harness = Harness::default();
        let size = MAX_AUTO_FILE_SIZE + 1;
        harness.poll(0, vec![entry("large.part", "same", size, 1)], MAX_BATCH);
        harness.poll(2, vec![entry("large", "same", size, 2)], MAX_BATCH);
        let (ready, warnings) = harness.poll(8, vec![entry("large", "same", size, 2)], MAX_BATCH);
        assert!(ready.is_empty());
        assert_eq!(warnings, vec![FILE_TOO_LARGE]);
        assert!(harness
            .poll(20, vec![entry("large", "same", size, 2)], MAX_BATCH)
            .1
            .is_empty());
    }

    #[test]
    fn remaining_temporary_alias_is_not_a_completed_rename() {
        let mut harness = Harness::default();
        harness.poll(0, vec![entry("file.part", "same", 10, 1)], MAX_BATCH);
        for second in [2, 20] {
            assert!(harness
                .poll(
                    second,
                    vec![
                        entry("file.part", "same", 10, 1),
                        entry("file", "same", 10, 1)
                    ],
                    MAX_BATCH
                )
                .0
                .is_empty());
        }
    }

    #[test]
    fn readiness_failure_or_racing_write_does_not_enqueue() {
        let mut harness = Harness::default();
        harness.poll(0, vec![entry("file.part", "same", 10, 1)], MAX_BATCH);
        harness.poll(2, vec![entry("file", "same", 10, 2)], MAX_BATCH);
        let mut ready = Vec::new();
        let mut warnings = Vec::new();
        harness.folder.update(
            vec![entry("file", "same", 10, 2)],
            Duration::from_secs(8),
            &mut harness.history,
            1,
            |_| Err("writer still open".into()),
            &mut ready,
            &mut warnings,
        );
        assert!(ready.is_empty());
        harness.folder.update(
            vec![entry("file", "same", 10, 2)],
            Duration::from_secs(14),
            &mut harness.history,
            1,
            |_| {
                Ok(FileStamp {
                    identity: "same".into(),
                    size: 10,
                    modified: 3,
                })
            },
            &mut ready,
            &mut warnings,
        );
        assert!(ready.is_empty());
        assert!(harness
            .poll(18, vec![entry("file", "same", 10, 3)], 1)
            .0
            .is_empty());
        assert_eq!(
            harness
                .poll(20, vec![entry("file", "same", 10, 3)], 1)
                .0
                .len(),
            1
        );
    }

    #[test]
    fn temporary_suffixes_are_case_insensitive_but_generic_tmp_is_not_completion_evidence() {
        assert!(temporary_name(Path::new("file.CRDOWNLOAD")));
        assert!(temporary_name(Path::new("file.part")));
        assert!(!temporary_name(Path::new("file.tmp")));
        assert!(!temporary_name(Path::new("file.exe")));
        assert_eq!(
            expected_final(Path::new("setup.exe.crdownload")),
            PathBuf::from("setup.exe")
        );
    }

    #[test]
    fn an_unavailable_folder_requests_a_pause() {
        let folder = std::env::temp_dir().join(format!(
            "deskoy-missing-watch-folder-{}",
            std::process::id()
        ));
        let batch = DownloadWatcher::new().poll_with_limit(&[folder], 1);
        assert!(batch.ready.is_empty());
        assert!(batch.warning.is_some());
        assert!(batch.pause);
    }
}
