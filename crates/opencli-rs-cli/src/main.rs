mod args;
mod execution;

use clap::{Arg, ArgAction, Command};
use opencli_rs_core::Registry;
use opencli_rs_discovery::{discover_builtin_adapters, discover_user_adapters};
use opencli_rs_external::{load_external_clis, ExternalCli};
use opencli_rs_output::format::{OutputFormat, RenderOptions};
use opencli_rs_output::render;
use std::collections::HashMap;
use std::str::FromStr;
use tracing_subscriber::EnvFilter;

use crate::args::coerce_and_validate_args;
use crate::execution::execute_command;

fn build_cli(registry: &Registry, external_clis: &[ExternalCli]) -> Command {
    let mut app = Command::new("opencli-rs")
        .version(env!("CARGO_PKG_VERSION"))
        .about("AI-driven CLI tool — turns websites into command-line interfaces")
        .arg(
            Arg::new("format")
                .long("format")
                .short('f')
                .global(true)
                .default_value("table")
                .help("Output format: table, json, yaml, csv, md"),
        )
        .arg(
            Arg::new("verbose")
                .long("verbose")
                .short('v')
                .global(true)
                .action(ArgAction::SetTrue)
                .help("Enable verbose output"),
        );

    // Add site subcommands from the adapter registry
    for site in registry.list_sites() {
        let mut site_cmd = Command::new(site.to_string());

        for cmd in registry.list_commands(site) {
            let mut sub = Command::new(cmd.name.clone()).about(cmd.description.clone());

            for arg_def in &cmd.args {
                let mut arg = if arg_def.positional {
                    Arg::new(arg_def.name.clone())
                } else {
                    Arg::new(arg_def.name.clone()).long(arg_def.name.clone())
                };
                if let Some(desc) = &arg_def.description {
                    arg = arg.help(desc.clone());
                }
                if arg_def.required {
                    arg = arg.required(true);
                }
                if let Some(default) = &arg_def.default {
                    arg = arg.default_value(default.to_string());
                }
                sub = sub.arg(arg);
            }
            site_cmd = site_cmd.subcommand(sub);
        }
        app = app.subcommand(site_cmd);
    }

    // Add external CLI subcommands
    for ext in external_clis {
        app = app.subcommand(
            Command::new(ext.name.clone())
                .about(ext.description.clone())
                .allow_external_subcommands(true),
        );
    }

    app
}

fn print_error(err: &opencli_rs_core::CliError) {
    eprintln!("{} {}", err.icon(), err);
    let suggestions = err.suggestions();
    if !suggestions.is_empty() {
        eprintln!();
        for s in suggestions {
            eprintln!("  -> {}", s);
        }
    }
}

#[tokio::main]
async fn main() {
    // 1. Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("RUST_LOG").unwrap_or_else(|_| {
                if std::env::var("OPENCLI_VERBOSE").is_ok() {
                    EnvFilter::new("debug")
                } else {
                    EnvFilter::new("warn")
                }
            }),
        )
        .init();

    // 2. Create registry and discover adapters
    let mut registry = Registry::new();

    match discover_builtin_adapters(&mut registry) {
        Ok(n) => tracing::debug!(count = n, "Discovered builtin adapters"),
        Err(e) => tracing::warn!(error = %e, "Failed to discover builtin adapters"),
    }

    match discover_user_adapters(&mut registry) {
        Ok(n) => tracing::debug!(count = n, "Discovered user adapters"),
        Err(e) => tracing::warn!(error = %e, "Failed to discover user adapters"),
    }

    // 3. Load external CLIs
    let external_clis = match load_external_clis() {
        Ok(clis) => {
            tracing::debug!(count = clis.len(), "Loaded external CLIs");
            clis
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to load external CLIs");
            vec![]
        }
    };

    // 4. Build clap app with dynamic subcommands
    let app = build_cli(&registry, &external_clis);
    let matches = app.get_matches();

    let format_str = matches.get_one::<String>("format").unwrap().clone();
    let verbose = matches.get_flag("verbose");

    if verbose {
        tracing::info!("Verbose mode enabled");
    }

    let output_format = OutputFormat::from_str(&format_str).unwrap_or_default();

    // 5. Route: find matching site+command or external CLI
    if let Some((site_name, site_matches)) = matches.subcommand() {
        // Check if it's an external CLI
        if let Some(ext) = external_clis.iter().find(|e| e.name == site_name) {
            // Gather remaining args for the external CLI
            let ext_args: Vec<String> = match site_matches.subcommand() {
                Some((sub, sub_matches)) => {
                    let mut args = vec![sub.to_string()];
                    if let Some(rest) = sub_matches.get_many::<std::ffi::OsString>("") {
                        args.extend(rest.map(|s| s.to_string_lossy().to_string()));
                    }
                    args
                }
                None => vec![],
            };

            match opencli_rs_external::execute_external_cli(&ext.name, &ext.binary, &ext_args)
                .await
            {
                Ok(status) => {
                    std::process::exit(status.code().unwrap_or(1));
                }
                Err(e) => {
                    print_error(&e);
                    std::process::exit(1);
                }
            }
        }

        // Check if it's a registered site
        if let Some((cmd_name, cmd_matches)) = site_matches.subcommand() {
            if let Some(cmd) = registry.get(site_name, cmd_name) {
                // Collect raw args from clap matches
                let mut raw_args: HashMap<String, String> = HashMap::new();
                for arg_def in &cmd.args {
                    if let Some(val) = cmd_matches.get_one::<String>(&arg_def.name) {
                        raw_args.insert(arg_def.name.clone(), val.clone());
                    }
                }

                // Coerce and validate
                let kwargs = match coerce_and_validate_args(&cmd.args, &raw_args) {
                    Ok(kw) => kw,
                    Err(e) => {
                        print_error(&e);
                        std::process::exit(1);
                    }
                };

                let start = std::time::Instant::now();

                match execute_command(cmd, kwargs).await {
                    Ok(data) => {
                        let opts = RenderOptions {
                            format: output_format,
                            columns: if cmd.columns.is_empty() {
                                None
                            } else {
                                Some(cmd.columns.clone())
                            },
                            title: None,
                            elapsed: Some(start.elapsed()),
                            source: Some(cmd.full_name()),
                            footer_extra: None,
                        };
                        let output = render(&data, &opts);
                        println!("{}", output);
                    }
                    Err(e) => {
                        print_error(&e);
                        std::process::exit(1);
                    }
                }
            } else {
                eprintln!("Unknown command: {} {}", site_name, cmd_name);
                std::process::exit(1);
            }
        } else {
            // Site specified but no command — show site help
            // Re-build and print help for just this site subcommand
            let app = build_cli(&registry, &external_clis);
            let app_clone = app;
            // Try to print subcommand help
            let _ = app_clone.try_get_matches_from(vec!["opencli-rs", site_name, "--help"]);
        }
    } else {
        // No subcommand specified
        eprintln!("opencli-rs v{}", env!("CARGO_PKG_VERSION"));
        eprintln!("No command specified. Use --help for usage.");
        std::process::exit(1);
    }
}
