// Architecture and protocol design derived from OpenCLI
// (https://github.com/jackwener/opencli) by jackwener, Apache-2.0

pub mod context;
pub mod executor;
pub mod step_registry;
pub mod steps;
pub mod template;

pub use context::PipelineContext;
pub use executor::execute_pipeline;
pub use step_registry::{StepHandler, StepRegistry};
pub use template::{render_template, render_template_str, TemplateContext};
