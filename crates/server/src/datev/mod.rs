//! DATEV read connector. Only allowlisted accounting GET operations are exposed.
mod provider;
mod routes;
pub use routes::{public_router, router};
