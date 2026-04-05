use clap::Command;
use clap_complete::{generate, Shell};
use std::io;

pub fn run_completion(app: &mut Command, shell: Shell) {
    generate(shell, app, "autocli", &mut io::stdout());
}
