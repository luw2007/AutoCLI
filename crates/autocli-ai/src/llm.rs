//! LLM client for AI-powered adapter generation.
//! Routes all requests through the AutoCLI server API.
//! Prompt is managed server-side; client only sends captured page data.

use autocli_core::CliError;
use serde_json::{json, Value};
use tracing::{debug, info};

use crate::config::api_base;

/// Send captured page data to server API and get back a YAML adapter.
/// The server handles prompt construction and LLM interaction.
pub async fn generate_with_llm(
    token: &str,
    captured_data: &Value,
    goal: &str,
    site: &str,
) -> Result<String, CliError> {
    let endpoint = format!("{}/api/ai/generate-adapter", api_base());

    info!(endpoint = %endpoint, "Calling AI for adapter generation");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| CliError::Http { message: format!("Failed to create HTTP client: {}", e), suggestions: vec![], source: None })?;

    // Send captured_data as JSON string per API spec
    let captured_str = serde_json::to_string(captured_data)
        .unwrap_or_else(|_| captured_data.to_string());

    let request_body = json!({
        "captured_data": captured_str,
        "goal": goal,
        "stream": false
    });

    debug!(body_size = request_body.to_string().len(), "Sending AI request");

    let resp = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .header("User-Agent", crate::config::user_agent())
        .json(&request_body)
        .send()
        .await
        .map_err(|e| CliError::Http { message: format!("AI request failed: {}", e), suggestions: vec![], source: None })?;

    if resp.status().as_u16() == 403 {
        return Err(CliError::Http {
            message: "Token invalid or expired".into(),
            suggestions: vec![
                "Get a new token: https://autocli.ai/get-token".into(),
                "Then run: autocli auth".into(),
            ],
            source: None,
        });
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(CliError::Http { message: format!("AI API error {}: {}", status, body.chars().take(500).collect::<String>()), suggestions: vec![], source: None });
    }

    let resp_json: Value = resp.json().await
        .map_err(|e| CliError::Http { message: format!("Failed to parse AI response: {}", e), suggestions: vec![], source: None })?;

    // Extract content from OpenAI-compatible response format
    let content = if let Some(choices) = resp_json.get("choices") {
        choices.get(0)
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        return Err(CliError::Http { message: "Unexpected AI response format".into(), suggestions: vec![], source: None });
    };

    // Clean up: remove thinking tags and markdown fencing
    let mut cleaned = content.clone();
    while let Some(start) = cleaned.find("<think>") {
        if let Some(end) = cleaned.find("</think>") {
            cleaned = format!("{}{}", &cleaned[..start], &cleaned[end + 8..]);
        } else {
            cleaned = cleaned[..start].to_string();
            break;
        }
    }
    while let Some(start) = cleaned.find("<thinking>") {
        if let Some(end) = cleaned.find("</thinking>") {
            cleaned = format!("{}{}", &cleaned[..start], &cleaned[end + 11..]);
        } else {
            cleaned = cleaned[..start].to_string();
            break;
        }
    }
    let yaml = cleaned
        .trim()
        .strip_prefix("```yaml").or_else(|| cleaned.trim().strip_prefix("```"))
        .unwrap_or(cleaned.trim())
        .strip_suffix("```")
        .unwrap_or(cleaned.trim())
        .trim()
        .to_string();

    if yaml.is_empty() {
        return Err(CliError::Http { message: "AI returned empty content".into(), suggestions: vec![], source: None });
    }

    info!(yaml_len = yaml.len(), "AI generated adapter YAML");
    Ok(yaml)
}
