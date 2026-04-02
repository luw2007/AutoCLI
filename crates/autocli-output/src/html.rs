use serde_json::Value;

fn resolve_columns(data: &Value, columns: Option<&[String]>) -> Vec<String> {
    if let Some(cols) = columns {
        return cols.to_vec();
    }
    match data {
        Value::Array(arr) => {
            if let Some(Value::Object(obj)) = arr.first() {
                obj.keys().cloned().collect()
            } else {
                vec![]
            }
        }
        Value::Object(obj) => obj.keys().cloned().collect(),
        _ => vec![],
    }
}

fn value_to_cell(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn format_content(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut result = Vec::new();
    let mut in_code_block = false;
    let mut code_lines: Vec<String> = Vec::new();
    let mut code_lang = String::new();
    let mut in_list = false;
    let mut list_items: Vec<String> = Vec::new();

    for line in &lines {
        let trimmed = line.trim();

        // 代码块处理
        if trimmed.starts_with("```") {
            if in_code_block {
                // 结束代码块
                result.push(format!(
                    r#"<pre><code class="language-{}">{}</code></pre>"#,
                    escape_html(&code_lang),
                    code_lines.join("\n")
                ));
                code_lines.clear();
                in_code_block = false;
            } else {
                // 开始代码块
                in_code_block = true;
                code_lang = if trimmed.len() > 3 {
                    trimmed[3..].trim().to_string()
                } else {
                    String::new()
                };
            }
            continue;
        }

        if in_code_block {
            code_lines.push(escape_html(line));
            continue;
        }

        // 空行
        if trimmed.is_empty() {
            if in_list {
                result.push(format!("<ul>{}</ul>", list_items.iter().map(|i| format!("<li>{}</li>", i)).collect::<String>()));
                list_items.clear();
                in_list = false;
            }
            continue;
        }

        // 标题
        if trimmed.starts_with("### ") {
            result.push(format!("<h4>{}</h4>", escape_html(&trimmed[4..])));
            continue;
        }
        if trimmed.starts_with("## ") {
            result.push(format!("<h3>{}</h3>", escape_html(&trimmed[3..])));
            continue;
        }
        if trimmed.starts_with("# ") {
            result.push(format!("<h2>{}</h2>", escape_html(&trimmed[2..])));
            continue;
        }

        // 列表项
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            if !in_list {
                in_list = true;
            }
            list_items.push(escape_html(&trimmed[2..]));
            continue;
        } else if in_list {
            result.push(format!("<ul>{}</ul>", list_items.iter().map(|i| format!("<li>{}</li>", i)).collect::<String>()));
            list_items.clear();
            in_list = false;
        }

        // 普通段落
        result.push(format!("<p>{}</p>", escape_html(line)));
    }

    // 处理未闭合的代码块
    if in_code_block {
        result.push(format!(
            r#"<pre><code class="language-{}">{}</code></pre>"#,
            escape_html(&code_lang),
            code_lines.join("\n")
        ));
    }

    // 处理未闭合的列表
    if in_list {
        result.push(format!("<ul>{}</ul>", list_items.iter().map(|i| format!("<li>{}</li>", i)).collect::<String>()));
    }

    result.join("\n")
}

pub fn render_html(data: &Value, columns: Option<&[String]>) -> String {
    let mut html = String::new();

    html.push_str(r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task Info</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .message {
            padding: 20px;
            border-bottom: 1px solid #f0f0f0;
            transition: background-color 0.2s;
        }
        .message:hover {
            background-color: #fafafa;
        }
        .message:last-child {
            border-bottom: none;
        }
        .message-header {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
        }
        .role-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .role-user {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .role-assistant {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
        }
        .role-content {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            color: white;
        }
        .role-error {
            background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
            color: white;
        }
        .role-info {
            background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
            color: #333;
        }
        .message-content {
            color: #555;
            line-height: 1.8;
        }
        .message-content p {
            margin-bottom: 8px;
        }
        .message-content p:last-child {
            margin-bottom: 0;
        }
        .message-content pre {
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
            margin: 12px 0;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 13px;
            line-height: 1.5;
        }
        .message-content code {
            background: #f0f0f0;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.9em;
            color: #e83e8c;
        }
        .message-content pre code {
            background: transparent;
            padding: 0;
            color: inherit;
        }
        .message-content h2 {
            font-size: 1.4em;
            margin: 20px 0 12px 0;
            color: #333;
            border-bottom: 2px solid #667eea;
            padding-bottom: 6px;
        }
        .message-content h3 {
            font-size: 1.2em;
            margin: 16px 0 10px 0;
            color: #444;
        }
        .message-content h4 {
            font-size: 1.1em;
            margin: 14px 0 8px 0;
            color: #555;
        }
        .message-content ul {
            margin: 10px 0 10px 24px;
        }
        .message-content li {
            margin-bottom: 6px;
        }
        .no-data {
            text-align: center;
            padding: 40px;
            color: #999;
            font-size: 16px;
        }
        .table-container {
            padding: 20px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: 600;
        }
        td {
            padding: 12px;
            border-bottom: 1px solid #f0f0f0;
        }
        tr:hover {
            background-color: #fafafa;
        }
    </style>
</head>
<body>
    <div class="container">
"#);

    match data {
        Value::Null => {
            html.push_str(r#"        <div class="no-data">暂无数据</div>"#);
        }
        Value::Array(arr) if arr.is_empty() => {
            html.push_str(r#"        <div class="no-data">空数组</div>"#);
        }
        Value::Array(arr) => {
            let cols = resolve_columns(data, columns);
            if cols.is_empty() {
                html.push_str(r#"        <div class="table-container"><table><thead><tr><th>value</th></tr></thead><tbody>"#);
                for item in arr {
                    html.push_str(&format!(
                        "            <tr><td>{}</td></tr>\n",
                        escape_html(&value_to_cell(item))
                    ));
                }
                html.push_str("        </tbody></table></div>");
            } else if cols.len() == 2 && cols.contains(&"Role".to_string()) && cols.contains(&"Content".to_string()) {
                for item in arr {
                    let role = item.get("Role").and_then(|v| v.as_str()).unwrap_or("Unknown");
                    let content = item.get("Content").and_then(|v| v.as_str()).unwrap_or("");

                    let role_class = match role.to_lowercase().as_str() {
                        "user" | "human" => "role-user",
                        "assistant" => "role-assistant",
                        "content" => "role-content",
                        "error" => "role-error",
                        "info" => "role-info",
                        _ => "role-content",
                    };

                    html.push_str(&format!(
                        r#"        <div class="message">
            <div class="message-header">
                <span class="role-badge {}">{}</span>
            </div>
            <div class="message-content">
{}
            </div>
        </div>
"#,
                        role_class,
                        escape_html(role),
                        format_content(content)
                    ));
                }
            } else {
                html.push_str(r#"        <div class="table-container"><table><thead><tr>"#);
                for col in &cols {
                    html.push_str(&format!("            <th>{}</th>\n", escape_html(col)));
                }
                html.push_str("        </tr></thead><tbody>");
                for item in arr {
                    html.push_str("            <tr>\n");
                    for col in &cols {
                        let v = item.get(col).unwrap_or(&Value::Null);
                        html.push_str(&format!(
                            "                <td>{}</td>\n",
                            escape_html(&value_to_cell(v))
                        ));
                    }
                    html.push_str("            </tr>\n");
                }
                html.push_str("        </tbody></table></div>");
            }
        }
        Value::Object(obj) => {
            let cols = resolve_columns(data, columns);
            html.push_str(r#"        <div class="table-container"><table><thead><tr><th>key</th><th>value</th></tr></thead><tbody>"#);
            for key in &cols {
                let v = obj.get(key).unwrap_or(&Value::Null);
                html.push_str(&format!(
                    "            <tr><td>{}</td><td>{}</td></tr>\n",
                    escape_html(key),
                    escape_html(&value_to_cell(v))
                ));
            }
            html.push_str("        </tbody></table></div>");
        }
        scalar => {
            html.push_str(&format!(
                r#"        <div class="message">
            <div class="message-content">
                <p>{}</p>
            </div>
        </div>
"#,
                escape_html(&value_to_cell(scalar))
            ));
        }
    }

    html.push_str(r#"    </div>
</body>
</html>"#);

    html
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_array_of_objects() {
        let data = json!([{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]);
        let out = render_html(&data, None);
        assert!(out.contains("<!DOCTYPE html>"));
        assert!(out.contains("Alice"));
        assert!(out.contains("Bob"));
    }

    #[test]
    fn test_chat_messages() {
        let data = json!([
            {"Role": "User", "Content": "Hello"},
            {"Role": "Assistant", "Content": "Hi there!"}
        ]);
        let cols = vec!["Role".to_string(), "Content".to_string()];
        let out = render_html(&data, Some(&cols));
        assert!(out.contains("role-user"));
        assert!(out.contains("role-assistant"));
        assert!(out.contains("Hello"));
        assert!(out.contains("Hi there!"));
    }

    #[test]
    fn test_empty_array() {
        let data = json!([]);
        let out = render_html(&data, None);
        assert!(out.contains("空数组"));
    }

    #[test]
    fn test_code_block_highlighting() {
        let data = json!([
            {"Role": "Assistant", "Content": "Here's some code:\n```rust\nfn main() {\n    println!(\"Hello\");\n}\n```\nEnd."}
        ]);
        let cols = vec!["Role".to_string(), "Content".to_string()];
        let out = render_html(&data, Some(&cols));
        assert!(out.contains("<pre><code"));
        assert!(out.contains("language-rust"));
        assert!(out.contains("println!"));
    }

    #[test]
    fn test_list_formatting() {
        let content = "Items:\n- First\n- Second\n- Third\n\nDone.";
        let out = format_content(content);
        assert!(out.contains("<ul>"));
        assert!(out.contains("<li>First</li>"));
        assert!(out.contains("<li>Second</li>"));
        assert!(out.contains("<li>Third</li>"));
        assert!(out.contains("</ul>"));
    }
}
