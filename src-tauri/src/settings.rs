use super::{
    default_active_profile_id, hostname_from_rule, normalize_blocked_rule, DeskoyProfile,
    DeskoyProfileSettings, DeskoySettings,
};

pub(super) fn normalize_settings(mut settings: DeskoySettings) -> DeskoySettings {
    settings.cover_display = normalize_cover_display(&settings.cover_display);
    settings.font_size = normalize_font_size(&settings.font_size);
    settings.whitelist = normalized_unique_lines(settings.whitelist);
    settings.blocked_apps = normalized_unique_lines(settings.blocked_apps);
    if settings.use_custom_cover == false
        && (settings.cover_mode == "url" || settings.cover_mode == "file")
    {
        settings.use_custom_cover = true;
    }
    if settings.blocked_websites.is_empty() && !settings.blocked_title_keywords.is_empty() {
        let mut websites = Vec::new();
        let mut keywords = Vec::new();
        for rule in settings.blocked_title_keywords {
            if hostname_from_rule(&normalize_blocked_rule(&rule)).is_some() {
                websites.push(rule);
            } else {
                keywords.push(rule);
            }
        }
        settings.blocked_websites = normalized_unique_lines(websites);
        settings.blocked_title_keywords = normalized_unique_lines(keywords);
    } else {
        settings.blocked_websites = normalized_unique_lines(settings.blocked_websites);
        settings.blocked_title_keywords = normalized_unique_lines(settings.blocked_title_keywords);
    }
    let profiles = std::mem::take(&mut settings.profiles);
    settings.profiles = normalize_profiles(profiles, &settings);
    if !settings
        .profiles
        .iter()
        .any(|profile| profile.id == settings.active_profile_id)
    {
        settings.active_profile_id = default_active_profile_id();
    }
    settings
}
fn normalize_profiles(
    profiles: Vec<DeskoyProfile>,
    settings: &DeskoySettings,
) -> Vec<DeskoyProfile> {
    let mut normalized = Vec::new();
    for profile in profiles {
        let id = normalize_profile_id(&profile.id);
        if id.is_empty() || normalized.iter().any(|item: &DeskoyProfile| item.id == id) {
            continue;
        }
        let name = profile.name.trim();
        normalized.push(DeskoyProfile {
            id,
            name: if name.is_empty() {
                "Untitled".into()
            } else {
                name.chars().take(40).collect()
            },
            settings: normalize_profile_settings(profile.settings),
        });
    }

    if !normalized.iter().any(|profile| profile.id == "default") {
        normalized.insert(0, default_profile_from_settings(settings));
    }
    normalized.sort_by_key(|profile| {
        if profile.id == "default" {
            (0, String::new())
        } else {
            (1, profile.name.to_lowercase())
        }
    });
    normalized
}

fn normalize_profile_id(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(64)
        .collect()
}

fn default_profile_from_settings(settings: &DeskoySettings) -> DeskoyProfile {
    DeskoyProfile {
        id: default_active_profile_id(),
        name: "Default".into(),
        settings: profile_settings_from_settings(settings),
    }
}

fn profile_settings_from_settings(settings: &DeskoySettings) -> DeskoyProfileSettings {
    DeskoyProfileSettings {
        cover_mode: settings.cover_mode.clone(),
        cover: settings.cover.clone(),
        cover_display: settings.cover_display.clone(),
        cover_url: settings.cover_url.clone(),
        cover_file_path: settings.cover_file_path.clone(),
        audio_mute: settings.audio_mute,
        whitelist: settings.whitelist.clone(),
        use_custom_cover: settings.use_custom_cover,
        auto_cover_blocked: settings.auto_cover_blocked,
        blocked_apps: settings.blocked_apps.clone(),
        blocked_websites: settings.blocked_websites.clone(),
        blocked_title_keywords: settings.blocked_title_keywords.clone(),
    }
}

fn normalize_profile_settings(mut settings: DeskoyProfileSettings) -> DeskoyProfileSettings {
    settings.cover_display = normalize_cover_display(&settings.cover_display);
    if !settings.use_custom_cover && (settings.cover_mode == "url" || settings.cover_mode == "file")
    {
        settings.use_custom_cover = true;
    }
    settings.whitelist = normalized_unique_lines(settings.whitelist);
    settings.blocked_apps = normalized_unique_lines(settings.blocked_apps);
    settings.blocked_websites = normalized_unique_lines(settings.blocked_websites);
    settings.blocked_title_keywords = normalized_unique_lines(settings.blocked_title_keywords);
    settings
}

fn normalize_font_size(value: &str) -> String {
    match value.trim() {
        "small" => "small".into(),
        "large" => "large".into(),
        _ => "default".into(),
    }
}

fn normalize_cover_display(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed == "all" {
        return "all".into();
    }
    let Some(index) = trimmed.strip_prefix("monitor:") else {
        return "all".into();
    };
    match index.parse::<usize>() {
        Ok(index) => format!("monitor:{index}"),
        Err(_) => "all".into(),
    }
}

pub(super) fn selected_monitor_indices(settings: &DeskoySettings, monitor_count: usize) -> Vec<usize> {
    if monitor_count == 0 {
        return Vec::new();
    }
    if let Some(index) = settings
        .cover_display
        .strip_prefix("monitor:")
        .and_then(|index| index.parse::<usize>().ok())
    {
        return vec![index.min(monitor_count - 1)];
    }
    (0..monitor_count).collect()
}

fn normalized_unique_lines(lines: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = lines
        .into_iter()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    out.sort_by_key(|line| line.to_lowercase());
    out.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    out
}
