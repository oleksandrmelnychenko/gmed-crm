//! Scan station agent for GMED.
//!
//! Drives an eSCL ("AirScan" / "AirPrint scan") network scanner such as the
//! Epson DS-790WN, turns the scanned pages into one PDF and files it into the
//! GMED document intake queue (`manual_intake`: status `draft`, no patient
//! link) where staff review, name and link it. A folder watcher covers the
//! vendor tools (Epson Scan 2, Scan to Network Folder) that already write
//! files to disk.

pub mod api;
pub mod config;
pub mod discovery;
pub mod escl;
pub mod pdf;
pub mod scan;
pub mod watch;

#[cfg(test)]
mod test_support;
