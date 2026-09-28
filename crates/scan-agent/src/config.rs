//! Per-user state of the scan station: settings, the signed-in session and
//! the outbox for scans that could not be uploaded yet.
//!
//! The session holds a rotating GMED refresh token. The server treats reuse
//! of a spent refresh token as theft and revokes every session of the user,
//! so all token refreshes run under an exclusive file lock and re-read the
//! session first: two `gmed-scan` processes never refresh the same token.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

const APP_DIR: &str = "gmed-scan";

#[derive(Clone, Debug)]
pub struct Paths {
    dir: PathBuf,
}

impl Paths {
    /// `GMED_SCAN_HOME` or the platform's per-user configuration directory.
    pub fn resolve() -> Result<Self> {
        if let Some(dir) = std::env::var_os("GMED_SCAN_HOME").filter(|value| !value.is_empty()) {
            return Ok(Self::at(dir));
        }
        let home = || std::env::var_os("HOME").map(PathBuf::from);
        let base = if cfg!(windows) {
            std::env::var_os("APPDATA").map(PathBuf::from)
        } else if cfg!(target_os = "macos") {
            home().map(|home| home.join("Library").join("Application Support"))
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .or_else(|| home().map(|home| home.join(".config")))
        };
        let base = base.ok_or_else(|| {
            anyhow!("cannot find the user configuration directory; set GMED_SCAN_HOME")
        })?;
        Ok(Self::at(base.join(APP_DIR)))
    }

    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn outbox(&self) -> PathBuf {
        self.dir.join("outbox")
    }

    fn config_file(&self) -> PathBuf {
        self.dir.join("config.json")
    }

    fn session_file(&self) -> PathBuf {
        self.dir.join("session.json")
    }

    fn lock_file(&self) -> PathBuf {
        self.dir.join("session.lock")
    }

    fn ensure_dir(&self) -> Result<()> {
        fs::create_dir_all(&self.dir).with_context(|| format!("create {}", self.dir.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&self.dir, fs::Permissions::from_mode(0o700));
        }
        Ok(())
    }

    pub fn load_config(&self) -> Result<Config> {
        Ok(read_json(&self.config_file())?.unwrap_or_default())
    }

    pub fn save_config(&self, config: &Config) -> Result<()> {
        self.ensure_dir()?;
        write_private_json(&self.config_file(), config)
    }

    pub fn load_session(&self) -> Result<Option<Session>> {
        read_json(&self.session_file())
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        self.ensure_dir()?;
        write_private_json(&self.session_file(), session)
    }

    pub fn clear_session(&self) -> Result<()> {
        match fs::remove_file(self.session_file()) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err(error).context("remove the stored session")
            }
            _ => Ok(()),
        }
    }

    /// Exclusive lock around session refreshes; released when dropped.
    pub fn lock_session(&self) -> Result<SessionLock> {
        self.ensure_dir()?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.lock_file())
            .context("open the session lock file")?;
        file.lock().context("lock the session")?;
        Ok(SessionLock { _file: file })
    }
}

pub struct SessionLock {
    _file: File,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Config {
    /// GMED address, e.g. `https://gmed.example.de`.
    pub server: Option<String>,
    /// Default scanner (eSCL root URL).
    pub scanner: Option<String>,
    /// The default scanner's Bonjour identity (UUID or service name), used
    /// to find it again when its address changes. `None` for an address
    /// typed by hand.
    pub scanner_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Session {
    pub server: String,
    pub email: String,
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub access_expires_at: i64,
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .with_context(|| format!("{} is corrupt; delete it and sign in again", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("read {}", path.display())),
    }
}

/// Write through a temporary file and rename, so a crash never leaves a
/// half-written session; the file is private to the user on Unix.
fn write_private_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let temporary = path.with_extension("json.tmp");
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .with_context(|| format!("write {}", temporary.display()))?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, path).with_context(|| format!("replace {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_dir;

    #[test]
    fn session_round_trips_and_clears() {
        let paths = Paths::at(temp_dir("config"));
        assert_eq!(paths.load_session().unwrap(), None);
        let session = Session {
            server: "https://gmed.example".into(),
            email: "scan@example.test".into(),
            access_token: "access".into(),
            refresh_token: "refresh".into(),
            access_expires_at: 42,
        };
        paths.save_session(&session).unwrap();
        assert_eq!(paths.load_session().unwrap(), Some(session));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(paths.session_file())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        paths.clear_session().unwrap();
        paths.clear_session().unwrap();
        assert_eq!(paths.load_session().unwrap(), None);
    }

    #[test]
    fn config_defaults_when_missing() {
        let paths = Paths::at(temp_dir("config-default"));
        assert_eq!(paths.load_config().unwrap(), Config::default());
        let config = Config {
            server: Some("https://gmed.example".into()),
            scanner: Some("http://192.168.1.20/eSCL/".into()),
            scanner_id: Some("4a3f-epson".into()),
        };
        paths.save_config(&config).unwrap();
        assert_eq!(paths.load_config().unwrap(), config);
    }

    #[test]
    fn reads_a_config_written_before_the_scanner_id_existed() {
        let paths = Paths::at(temp_dir("config-0-1"));
        fs::create_dir_all(paths.dir()).unwrap();
        fs::write(
            paths.config_file(),
            br#"{ "server": "https://gmed.example", "scanner": "http://192.168.1.20/eSCL/" }"#,
        )
        .unwrap();
        let config = paths.load_config().unwrap();
        assert_eq!(config.scanner.as_deref(), Some("http://192.168.1.20/eSCL/"));
        assert_eq!(config.scanner_id, None);
    }
}
