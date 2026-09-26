use super::{ActiveWindowInfo, DeskoySettings};

fn is_deskoy_window(info: &ActiveWindowInfo) -> bool {
    info.process_name.to_lowercase().contains("deskoy")
}
pub(super) fn blocked_app_reason(info: &ActiveWindowInfo, settings: &DeskoySettings) -> Option<String> {
    if is_deskoy_window(info) || is_whitelisted_process(&info.process_name, &settings.whitelist) {
        return None;
    }
    if let Some(rule) = settings
        .blocked_apps
        .iter()
        .find(|rule| process_rule_matches(&info.process_name, rule))
    {
        let _ = rule;
        return Some("app rule matched".into());
    }
    if let Some(rule) = settings
        .blocked_websites
        .iter()
        .find(|rule| website_rule_matches_window(info, rule))
    {
        let _ = rule;
        return Some("website rule matched".into());
    }
    settings
        .blocked_title_keywords
        .iter()
        .find(|rule| blocked_title_rule_matches(&info.title, rule))
        .map(|_| "title keyword matched".into())
}

fn is_whitelisted_process(process_name: &str, whitelist: &[String]) -> bool {
    whitelist
        .iter()
        .any(|rule| process_rule_matches(process_name, rule))
}

fn process_rule_matches(process_name: &str, raw_rule: &str) -> bool {
    let process = normalize_process_identifier(process_name);
    let rule = normalize_process_identifier(raw_rule);
    if rule.is_empty() || process.is_empty() {
        return false;
    }
    if process.eq_ignore_ascii_case(&rule) {
        return true;
    }

    let process_tokens = identifier_tokens(&process);
    let rule_tokens = identifier_tokens(&rule);
    !rule_tokens.is_empty() && process_tokens_match_rule(&process_tokens, &rule_tokens)
}

fn normalize_process_identifier(value: &str) -> String {
    let value = value.trim().trim_matches('"').trim_matches('\'');
    let file_name = value
        .rsplit(&['\\', '/'][..])
        .next()
        .unwrap_or(value)
        .trim();
    strip_case_insensitive_suffix(file_name, ".exe")
        .trim()
        .to_string()
}

fn strip_case_insensitive_suffix<'a>(value: &'a str, suffix: &str) -> &'a str {
    if value.to_ascii_lowercase().ends_with(suffix) {
        &value[..value.len() - suffix.len()]
    } else {
        value
    }
}

fn identifier_tokens(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut prev_lower_or_digit = false;
    let chars: Vec<char> = value.chars().collect();

    for (index, ch) in chars.iter().copied().enumerate() {
        if ch.is_ascii_alphanumeric() {
            let next_is_lower = chars
                .get(index + 1)
                .map(|next| next.is_ascii_lowercase())
                .unwrap_or(false);
            if ch.is_ascii_uppercase()
                && !current.is_empty()
                && (prev_lower_or_digit || next_is_lower)
            {
                tokens.push(current.to_lowercase());
                current.clear();
            }
            current.push(ch.to_ascii_lowercase());
            prev_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        } else {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            prev_lower_or_digit = false;
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn process_tokens_match_rule(process: &[String], rule: &[String]) -> bool {
    if rule.is_empty() || process.len() < rule.len() {
        return false;
    }
    if process.starts_with(rule) {
        return true;
    }

    matches!(
        process.first().map(String::as_str),
        Some("ms" | "microsoft")
    ) && process[1..].starts_with(rule)
}

fn website_rule_matches_title(title: &str, raw_rule: &str) -> bool {
    let rule = normalize_blocked_rule(raw_rule);
    hostname_from_rule(&rule)
        .map(|host| title_contains_hostname(title, &host))
        .unwrap_or(false)
}

fn website_rule_matches_window(info: &ActiveWindowInfo, raw_rule: &str) -> bool {
    let rule = normalize_blocked_rule(raw_rule);
    let Some(host) = hostname_from_rule(&rule) else {
        return false;
    };
    if is_browser_process(&info.process_name) {
        title_contains_hostname(&info.title, &host)
            || browser_title_matches_host(&info.title, &info.process_name, &host)
    } else {
        title_contains_explicit_url_hostname(&info.title, &host)
    }
}

fn is_browser_process(process_name: &str) -> bool {
    let compact = identifier_tokens(&normalize_process_identifier(process_name)).join("");
    matches!(
        compact.as_str(),
        "arc"
            | "brave"
            | "bravebrowser"
            | "chrome"
            | "chromium"
            | "duckduckgo"
            | "firefox"
            | "iexplore"
            | "librewolf"
            | "msedge"
            | "opera"
            | "operagx"
            | "torbrowser"
            | "vivaldi"
            | "waterfox"
            | "zen"
    )
}

fn blocked_title_rule_matches(title: &str, raw_rule: &str) -> bool {
    let rule = normalize_blocked_rule(raw_rule);
    if rule.is_empty() {
        return false;
    }
    if hostname_from_rule(&rule).is_some() {
        return website_rule_matches_title(title, &rule);
    }

    let title = title.to_lowercase();
    expand_keyword_rule(&rule)
        .iter()
        .any(|needle| contains_bounded_phrase(&title, needle))
}

fn browser_title_matches_host(title: &str, process_name: &str, host: &str) -> bool {
    if !is_browser_process(process_name) {
        return false;
    }
    let title = browser_page_title(title).to_lowercase();
    host_title_phrases(host)
        .iter()
        .any(|phrase| contains_bounded_phrase(&title, phrase))
}

fn browser_page_title(title: &str) -> String {
    let mut page_title = title.trim();
    loop {
        let mut trimmed = false;
        for separator in [" - ", " — ", " – "] {
            if let Some((before, suffix)) = page_title.rsplit_once(separator) {
                if is_browser_title_suffix(suffix) {
                    page_title = before.trim();
                    trimmed = true;
                    break;
                }
            }
        }
        if !trimmed {
            break;
        }
    }
    page_title.to_string()
}

fn is_browser_title_suffix(value: &str) -> bool {
    let suffix = identifier_tokens(value).join("");
    matches!(
        suffix.as_str(),
        "arc"
            | "brave"
            | "bravebrowser"
            | "chrome"
            | "chromium"
            | "duckduckgo"
            | "firefox"
            | "googlechrome"
            | "internetexplorer"
            | "librewolf"
            | "microsoftedge"
            | "mozillafirefox"
            | "opera"
            | "operagx"
            | "torbrowser"
            | "vivaldi"
            | "waterfox"
            | "zen"
            | "zenbrowser"
    )
}

fn host_title_phrases(host: &str) -> Vec<String> {
    let host = strip_www(host);
    let parts: Vec<&str> = host.split('.').filter(|part| !part.is_empty()).collect();
    if parts.len() < 2 {
        return Vec::new();
    }

    let mut phrases = Vec::new();
    let registrable = parts[parts.len().saturating_sub(2)];
    if is_meaningful_host_label(registrable) {
        phrases.push(registrable.replace('-', " "));
    }

    for part in &parts[..parts.len().saturating_sub(1)] {
        if is_meaningful_host_label(part) {
            phrases.push(part.replace('-', " "));
        }
    }

    phrases.sort();
    phrases.dedup();
    phrases
}

fn is_meaningful_host_label(label: &str) -> bool {
    !matches!(
        label,
        "ac" | "accounts" | "app" | "apps" | "auth" | "cdn" | "co" | "com" | "edu" | "gov"
            | "io" | "login" | "m" | "mail" | "mobile" | "net" | "org" | "secure"
            | "signin" | "www" | "www2"
    )
}

pub(super) fn normalize_blocked_rule(raw: &str) -> String {
    raw.trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_lowercase()
}

pub(super) fn hostname_from_rule(rule: &str) -> Option<String> {
    let candidate = rule
        .strip_prefix("http://")
        .or_else(|| rule.strip_prefix("https://"))
        .unwrap_or(rule);
    let host = candidate
        .split(&['/', '?', '#'][..])
        .next()
        .unwrap_or("")
        .split('@')
        .last()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_matches('.');

    if is_specific_hostname(host) {
        Some(strip_www(host).to_string())
    } else {
        None
    }
}

fn is_specific_hostname(host: &str) -> bool {
    let parts: Vec<&str> = host.split('.').filter(|part| !part.is_empty()).collect();
    parts.len() >= 2
        && parts.iter().all(|part| {
            part.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
                && !part.starts_with('-')
                && !part.ends_with('-')
        })
}

fn strip_www(host: &str) -> &str {
    host.strip_prefix("www.").unwrap_or(host)
}

fn title_contains_hostname(title: &str, host: &str) -> bool {
    let host = strip_www(host);
    title_hostname_candidates(title)
        .into_iter()
        .map(|(candidate, _explicit_url)| candidate)
        .any(|candidate| candidate == host || candidate.ends_with(&format!(".{host}")))
}

fn title_contains_explicit_url_hostname(title: &str, host: &str) -> bool {
    let host = strip_www(host);
    title_hostname_candidates(title)
        .into_iter()
        .filter(|(_candidate, explicit_url)| *explicit_url)
        .map(|(candidate, _explicit_url)| candidate)
        .any(|candidate| candidate == host || candidate.ends_with(&format!(".{host}")))
}

fn title_hostname_candidates(title: &str) -> Vec<(String, bool)> {
    title
        .to_lowercase()
        .split(|ch: char| {
            !(ch.is_ascii_alphanumeric()
                || ch == '-'
                || ch == '.'
                || ch == ':'
                || ch == '/'
                || ch == '@')
        })
        .filter_map(|token| {
            let token = token.trim_matches('.');
            let explicit_url = token.starts_with("http://") || token.starts_with("https://");
            hostname_from_title_token(token).map(|host| (host, explicit_url))
        })
        .collect()
}

fn hostname_from_title_token(token: &str) -> Option<String> {
    let token = token
        .trim_matches('.')
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('@')
        .last()
        .unwrap_or("")
        .split(&['/', '?', '#'][..])
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_matches('.');

    if is_specific_hostname(token) {
        Some(strip_www(token).to_string())
    } else {
        None
    }
}

fn expand_keyword_rule(rule: &str) -> Vec<String> {
    let mut out = Vec::new();
    out.push(rule.to_string());
    if rule.contains('\\') || rule.contains('/') {
        if let Some(base) = rule
            .split(&['\\', '/'][..])
            .filter(|p| !p.is_empty())
            .last()
        {
            if base != rule {
                out.push(base.into());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn contains_bounded_phrase(title: &str, needle: &str) -> bool {
    let needle = needle.trim();
    if needle.is_empty() {
        return false;
    }
    title.match_indices(needle)
        .any(|(start, _)| has_phrase_boundaries(title, start, needle.len()))
}

fn has_phrase_boundaries(text: &str, start: usize, len: usize) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[start + len..].chars().next();
    before.map(is_keyword_boundary).unwrap_or(true) && after.map(is_keyword_boundary).unwrap_or(true)
}

fn is_keyword_boundary(ch: char) -> bool {
    !ch.is_ascii_alphanumeric()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_info(process_name: &str, title: &str) -> ActiveWindowInfo {
        ActiveWindowInfo {
            hwnd: 1,
            pid: 1,
            process_name: process_name.into(),
            title: title.into(),
            _class_name: String::new(),
        }
    }

    #[test]
    fn domain_rules_require_hostname_tokens() {
        assert!(website_rule_matches_title(
            "https://mail.gmail.com/mail/u/0/#inbox - Google Chrome",
            "gmail.com"
        ));
        assert!(website_rule_matches_title(
            "Inbox - https://gmail.com - Google Chrome",
            "https://gmail.com"
        ));
        assert!(!website_rule_matches_title(
            "Gmail - New Tab - Google Chrome",
            "gmail.com"
        ));
        assert!(!website_rule_matches_title(
            "https://gmail.com.evil.test - Google Chrome",
            "gmail.com"
        ));
    }

    #[test]
    fn website_rules_prefer_browser_or_explicit_url_context() {
        assert!(website_rule_matches_window(
            &active_info("chrome", "https://mail.gmail.com/mail/u/0/#inbox - Google Chrome"),
            "gmail.com"
        ));
        assert!(website_rule_matches_window(
            &active_info("notepad", "Notes - https://gmail.com - Notepad"),
            "gmail.com"
        ));
        assert!(!website_rule_matches_window(
            &active_info("notepad", "gmail.com notes.txt - Notepad"),
            "gmail.com"
        ));
        assert!(website_rule_matches_window(
            &active_info("chrome", "Gmail - Google Chrome"),
            "gmail.com"
        ));
        assert!(website_rule_matches_window(
            &active_info("msedge", "YouTube - Microsoft Edge"),
            "youtube.com"
        ));
        assert!(!website_rule_matches_window(
            &active_info("chrome", "New Tab - Google Chrome"),
            "google.com"
        ));
    }

    #[test]
    fn app_rules_match_process_tokens_not_substrings() {
        assert!(process_rule_matches("Microsoft Teams", "Teams"));
        assert!(process_rule_matches("MSTeams", "Teams"));
        assert!(process_rule_matches("DiscordCanary", "Discord"));
        assert!(process_rule_matches(
            "C:\\Program Files\\Bitwarden.exe",
            "Bitwarden"
        ));
        assert!(!process_rule_matches("Steam", "Teams"));
        assert!(!process_rule_matches("TeamViewer", "Teams"));
        assert!(!process_rule_matches("NotDiscord", "Discord"));
    }

    #[test]
    fn apps_are_hidden_only_after_an_explicit_rule_is_added() {
        let mut settings = DeskoySettings::default();
        let discord = active_info("Discord.exe", "Friends - Discord");

        assert!(blocked_app_reason(&discord, &settings).is_none());
        settings.blocked_apps.push("Discord".into());
        assert_eq!(
            blocked_app_reason(&discord, &settings).as_deref(),
            Some("app rule matched")
        );
    }

    #[test]
    fn whitelisted_processes_skip_auto_protect() {
        let mut settings = DeskoySettings::default();
        settings.blocked_title_keywords = vec!["gmail".into()];
        assert!(blocked_app_reason(&active_info("chrome", "Gmail - Google Chrome"), &settings).is_some());
        assert!(blocked_app_reason(&active_info("Outlook", "Gmail password reset"), &settings).is_none());
    }

    #[test]
    fn plain_keyword_rules_keep_title_matching() {
        assert!(blocked_title_rule_matches(
            "Inbox - Gmail - Google Chrome",
            "gmail"
        ));
        assert!(blocked_title_rule_matches(
            "C:\\Users\\User\\Desktop\\taxes.xlsx - Excel",
            "taxes.xlsx"
        ));
        assert!(blocked_title_rule_matches("Mail - Outlook", "mail"));
        assert!(blocked_title_rule_matches(
            "C:\\Users\\User\\Desktop\\taxes.xlsx - Excel",
            "taxes"
        ));
        assert!(!blocked_title_rule_matches("thumbnail.png - Photos", "mail"));
        assert!(!blocked_title_rule_matches(
            "C:\\Users\\User\\Desktop\\taxes.xlsx - Excel",
            "tax"
        ));
    }
}
