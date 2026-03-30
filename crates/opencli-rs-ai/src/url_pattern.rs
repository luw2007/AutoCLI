//! URL Pattern cleaning: converts any URL into a standardized pattern
//! for matching the same functionality across different requests.
//! Core principle: keep parts that determine function, remove parts that determine specific content.

/// Clean a URL into a standardized pattern.
///
/// Rules:
/// 1. Domain: lowercase
/// 2. Path: replace ID segments with `:id`
/// 3. Query: keep param names only, sorted alphabetically
/// 4. Fragment: apply same path + query rules
/// 5. Remove trailing slash
pub fn url_to_pattern(url: &str) -> String {
    // Split fragment first
    let (main_part, fragment) = match url.split_once('#') {
        Some((m, f)) => (m.to_string(), Some(f.to_string())),
        None => (url.to_string(), None),
    };

    // Parse main part: scheme + host + path + query
    let main_result = clean_url_part(&main_part, true);

    // Process fragment if present
    let fragment_result = fragment.map(|f| {
        // Fragment can have path and query: /path?params
        clean_fragment(&f)
    });

    match fragment_result {
        Some(frag) => format!("{}#{}", main_result, frag),
        None => main_result,
    }
}

/// Clean the main URL part (scheme + host + path + query)
fn clean_url_part(url: &str, lowercase_domain: bool) -> String {
    // Find scheme
    let (scheme, rest) = match url.split_once("://") {
        Some((s, r)) => (format!("{}://", s.to_lowercase()), r.to_string()),
        None => return url.to_string(),
    };

    // Find host and path+query
    let (host, path_and_query) = match rest.split_once('/') {
        Some((h, pq)) => (h.to_string(), format!("/{}", pq)),
        None => {
            // No path, maybe just host or host?query
            match rest.split_once('?') {
                Some((h, q)) => (h.to_string(), format!("?{}", q)),
                None => (rest.clone(), String::new()),
            }
        }
    };

    let host = if lowercase_domain { host.to_lowercase() } else { host };

    // Split path and query
    let (path, query) = match path_and_query.split_once('?') {
        Some((p, q)) => (p.to_string(), Some(q.to_string())),
        None => (path_and_query, None),
    };

    // Clean path: replace ID segments
    let cleaned_path = clean_path(&path);

    // Clean query: keep param names, sort
    let cleaned_query = query.map(|q| clean_query(&q));

    // Remove trailing slash
    let final_path = cleaned_path.strip_suffix('/').unwrap_or(&cleaned_path);

    match cleaned_query {
        Some(q) if !q.is_empty() => format!("{}{}{}?{}", scheme, host, final_path, q),
        _ => format!("{}{}{}", scheme, host, final_path),
    }
}

/// Clean a fragment string (everything after #)
fn clean_fragment(fragment: &str) -> String {
    // Fragment can be: /path/segments?params or just plain text
    let (frag_path, frag_query) = match fragment.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (fragment, None),
    };

    let cleaned_path = clean_path(frag_path);
    let cleaned_query = frag_query.map(|q| clean_query(q));

    // Remove trailing slash
    let final_path = cleaned_path.strip_suffix('/').unwrap_or(&cleaned_path);

    match cleaned_query {
        Some(q) if !q.is_empty() => format!("{}?{}", final_path, q),
        _ => final_path.to_string(),
    }
}

/// Replace ID-like path segments with `:id`
fn clean_path(path: &str) -> String {
    path.split('/')
        .map(|segment| {
            if segment.is_empty() {
                return segment.to_string();
            }
            if is_id_segment(segment) {
                ":id".to_string()
            } else {
                segment.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Check if a path segment looks like an ID:
/// - Pure digits (e.g. "42", "7353462568436219904")
/// - 8+ alphanumeric chars with at least one digit (e.g. "a387491712p528298340")
fn is_id_segment(segment: &str) -> bool {
    if segment.is_empty() {
        return false;
    }

    // Pure digits → always ID
    if segment.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }

    // 8+ chars, all alphanumeric, at least one digit — hash-like IDs
    // (e.g. "a387491712p528298340", "abc123def456")
    // But exclude product codes like ASIN "B09V3KXJPB": starts with uppercase letter,
    // mostly uppercase letters — these are short structured codes, not random IDs
    if segment.len() >= 8
        && segment.chars().all(|c| c.is_ascii_alphanumeric())
        && segment.chars().any(|c| c.is_ascii_digit())
    {
        // Heuristic: if it starts with an uppercase letter and has mostly uppercase letters,
        // it's likely a product/catalog code (ASIN, ISBN, etc.), not an ID
        let starts_upper = segment.chars().next().map_or(false, |c| c.is_ascii_uppercase());
        let upper_count = segment.chars().filter(|c| c.is_ascii_uppercase()).count();
        if starts_upper && upper_count > segment.len() / 3 && segment.len() <= 12 {
            return false;
        }
        return true;
    }

    false
}

/// Clean query string: keep param names only, sorted alphabetically
fn clean_query(query: &str) -> String {
    let mut names: Vec<&str> = query
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            // Take only the key (before '=')
            match p.split_once('=') {
                Some((key, _)) => key,
                None => p,
            }
        })
        .collect();

    names.sort();
    names.dedup();
    names.join("&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_domain_lowercase() {
        assert_eq!(
            url_to_pattern("HTTPS://WWW.GitHub.COM/search"),
            "https://www.github.com/search"
        );
    }

    #[test]
    fn test_path_id_replacement() {
        assert_eq!(
            url_to_pattern("https://example.com/post/7353462568436219904"),
            "https://example.com/post/:id"
        );
        assert_eq!(
            url_to_pattern("https://example.com/issues/42"),
            "https://example.com/issues/:id"
        );
    }

    #[test]
    fn test_path_mixed_id() {
        // 8+ alphanumeric with digits
        assert_eq!(
            url_to_pattern("https://example.com/a387491712p528298340/reports"),
            "https://example.com/:id/reports"
        );
    }

    #[test]
    fn test_path_short_code_not_replaced() {
        // Only 7 chars, not replaced
        assert_eq!(
            url_to_pattern("https://example.com/dp/B09V3KB"),
            "https://example.com/dp/B09V3KB"
        );
    }

    #[test]
    fn test_path_with_hyphen_not_replaced() {
        assert_eq!(
            url_to_pattern("https://github.com/nashsu/opencli-rs"),
            "https://github.com/nashsu/opencli-rs"
        );
    }

    #[test]
    fn test_query_params_cleaned_and_sorted() {
        assert_eq!(
            url_to_pattern("https://example.com/search?q=python+tutorial&hl=en&num=10"),
            "https://example.com/search?hl&num&q"
        );
    }

    #[test]
    fn test_fragment_with_path_and_query() {
        assert_eq!(
            url_to_pattern("https://example.com/#/a387491712p528298340/reports/intelligenthome?params=_u..nav%3Dmaui"),
            "https://example.com#/:id/reports/intelligenthome?params"
        );
    }

    #[test]
    fn test_trailing_slash_removed() {
        assert_eq!(
            url_to_pattern("https://example.com/path/"),
            "https://example.com/path"
        );
    }

    #[test]
    fn test_full_example() {
        assert_eq!(
            url_to_pattern("https://WWW.Example.COM/users/12345/posts?sort=new&page=2#/tab/abc123def456?view=grid"),
            "https://www.example.com/users/:id/posts?page&sort#/tab/:id?view"
        );
    }

    #[test]
    fn test_no_query() {
        assert_eq!(
            url_to_pattern("https://example.com/api/v1/items"),
            "https://example.com/api/v1/items"
        );
    }

    #[test]
    fn test_simple_fragment() {
        assert_eq!(
            url_to_pattern("https://example.com/#shelf"),
            "https://example.com#shelf"
        );
    }

    // --- Real-world examples from spec ---

    #[test]
    fn test_real_01_google_search() {
        assert_eq!(
            url_to_pattern("https://www.google.com/search?q=python+tutorial&hl=en&num=10"),
            "https://www.google.com/search?hl&num&q"
        );
    }

    #[test]
    fn test_real_02_github_search() {
        assert_eq!(
            url_to_pattern("https://github.com/search?q=rust+cli&type=repositories&sort=stars"),
            "https://github.com/search?q&sort&type"
        );
    }

    #[test]
    fn test_real_03_github_issue() {
        assert_eq!(
            url_to_pattern("https://github.com/nashsu/opencli-rs/issues/42?ref=main"),
            "https://github.com/nashsu/opencli-rs/issues/:id?ref"
        );
    }

    #[test]
    fn test_real_04_youtube() {
        assert_eq!(
            url_to_pattern("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120"),
            "https://www.youtube.com/watch?t&v"
        );
    }

    #[test]
    fn test_real_05_google_analytics_fragment() {
        assert_eq!(
            url_to_pattern("https://analytics.google.com/analytics/web/?authuser=0#/a387491712p528298340/reports/intelligenthome?params=_u..nav%3Dmaui"),
            "https://analytics.google.com/analytics/web?authuser#/:id/reports/intelligenthome?params"
        );
    }

    #[test]
    fn test_real_06_hackernews() {
        assert_eq!(
            url_to_pattern("https://news.ycombinator.com/item?id=39281283"),
            "https://news.ycombinator.com/item?id"
        );
    }

    #[test]
    fn test_real_07_reddit() {
        assert_eq!(
            url_to_pattern("https://www.reddit.com/r/programming/comments/abc123/some_post_title/?sort=top"),
            "https://www.reddit.com/r/programming/comments/abc123/some_post_title?sort"
        );
    }

    #[test]
    fn test_real_08_github_api() {
        assert_eq!(
            url_to_pattern("https://api.github.com/repos/nashsu/opencli-rs/stargazers?page=2&per_page=100"),
            "https://api.github.com/repos/nashsu/opencli-rs/stargazers?page&per_page"
        );
    }

    #[test]
    fn test_real_09_juejin() {
        assert_eq!(
            url_to_pattern("https://juejin.cn/post/7353462568436219904?searchId=20240315"),
            "https://juejin.cn/post/:id?searchId"
        );
    }

    #[test]
    fn test_real_10_amazon() {
        assert_eq!(
            url_to_pattern("https://www.amazon.com/dp/B09V3KXJPB?tag=abc123&ref=sr_1_1"),
            "https://www.amazon.com/dp/B09V3KXJPB?ref&tag"
        );
    }
}
