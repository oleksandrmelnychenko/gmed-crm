//! Access Control Engine
//!
//! Implements the 4-dimensional authorization model:
//!   permission = role + assignment + data_sensitivity + share_status
//!
//! Every data access in the system is checked against all 4 dimensions.

pub mod data_sensitivity;
pub mod policy;
pub mod share_status;
