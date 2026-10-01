use std::io::{self, BufRead, IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use chrono::Local;
use clap::{Parser, Subcommand};

use gmed_scan::api::{ApiError, Destination, Gmed, LoginPrompt, set_default_destination};
use gmed_scan::config::{Paths, Session};
use gmed_scan::discovery::{self, FoundScanner};
use gmed_scan::escl::{ColorMode, Paper, ScanRequest, Scanner, Source};
use gmed_scan::{scan, watch};

/// Scan station for GMED: scans on an eSCL (AirScan) network scanner such as
/// the Epson DS-790WN and files every scan into the GMED document intake
/// queue as a draft, where staff link it to the patient.
///
/// Without a command the interactive scan station starts.
#[derive(Parser)]
#[command(name = "gmed-scan", version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    /// File into the personnel-file intake (Personalakten: timesheets,
    /// payslips, contracts) instead of the document intake queue. The CEO
    /// assigns each scan to an employee in GMED.
    #[arg(long, global = true, env = "GMED_SCAN_PERSONNEL")]
    personnel: bool,
}

#[derive(Subcommand)]
enum Command {
    /// Interactive scan station: sign in, choose the scanner, then scan with
    /// one key press per document (what the desktop shortcut opens).
    Station,
    /// Sign in to GMED (password, then authenticator code or admin approval).
    Login {
        /// GMED address, e.g. https://gmed.example.de (remembered).
        #[arg(long, env = "GMED_SCAN_SERVER")]
        server: Option<String>,
        #[arg(long, env = "GMED_SCAN_EMAIL")]
        email: Option<String>,
    },
    /// End the session on GMED and forget it on this computer.
    Logout,
    /// Show the signed-in account and whether it may use the intake queue.
    Whoami,
    /// Find eSCL scanners on the local network.
    Scanners {
        /// Seconds to listen for answers.
        #[arg(long, default_value_t = 5)]
        timeout: u64,
        /// Remember scanner number N from the list as the default.
        #[arg(long, value_name = "N")]
        save: Option<usize>,
    },
    /// Scan a document and file it into the GMED intake queue.
    Scan {
        /// Scanner address (IP, host name or eSCL URL); default: the saved one.
        #[arg(long, env = "GMED_SCAN_SCANNER")]
        scanner: Option<String>,
        #[arg(long, value_enum, default_value_t = Source::Adf)]
        source: Source,
        /// Scan both sides (document feeder only).
        #[arg(long)]
        duplex: bool,
        #[arg(long, value_enum, default_value_t = ColorMode::Color)]
        color: ColorMode,
        #[arg(long, default_value_t = 300)]
        dpi: u32,
        #[arg(long, value_enum, default_value_t = Paper::A4)]
        paper: Paper,
        /// Document title in GMED (default: the scan file name).
        #[arg(long)]
        title: Option<String>,
        /// Note for the reviewer, e.g. who handed the papers in.
        #[arg(long)]
        note: Option<String>,
        /// Only save the PDF, do not upload it.
        #[arg(long)]
        no_upload: bool,
        /// Keep the local PDF after a successful upload.
        #[arg(long)]
        keep: bool,
        /// Folder for the PDF (default: the outbox in the gmed-scan folder).
        #[arg(long)]
        output: Option<PathBuf>,
    },
    /// Upload existing PDF, JPEG, PNG or TIFF files into the intake queue.
    Upload {
        #[arg(required = true)]
        files: Vec<PathBuf>,
        /// Document title in GMED (default: the file name).
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        note: Option<String>,
        /// Delete each file after GMED confirmed the upload.
        #[arg(long)]
        delete: bool,
    },
    /// Watch a folder (Epson Scan 2 output, Scan to Network Folder) and
    /// upload every finished scan that appears in it.
    Watch {
        folder: PathBuf,
        /// Seconds between folder checks.
        #[arg(long, default_value_t = 3)]
        interval: u64,
        /// Seconds a file must stay unchanged before it is uploaded.
        #[arg(long, default_value_t = 5)]
        settle: u64,
        #[arg(long, value_enum, default_value_t = watch::AfterUpload::Move)]
        after_upload: watch::AfterUpload,
        /// Handle the files that are there now and exit.
        #[arg(long)]
        once: bool,
        #[arg(long)]
        note: Option<String>,
    },
}

/// GMED address baked in at build time (repository variable in CI), offered
/// as the default when signing in for the first time.
fn default_server() -> Option<&'static str> {
    option_env!("GMED_SCAN_DEFAULT_SERVER").filter(|value| !value.trim().is_empty())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let interactive = matches!(cli.command, None | Some(Command::Station));
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            if interactive && io::stdin().is_terminal() {
                // Opened from a shortcut: keep the window so the error can be read.
                let _ = read_line("Press Enter to close.");
            }
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<()> {
    set_default_destination(if cli.personnel {
        Destination::Personnel
    } else {
        Destination::Documents
    });
    let paths = Paths::resolve()?;
    let Some(command) = cli.command else {
        return station(paths);
    };
    match command {
        Command::Station => station(paths),
        Command::Login { server, email } => {
            let gmed = Gmed::new(paths.clone())?;
            let session = sign_in(&paths, &gmed, server, email)?;
            println!("Signed in as {} at {}.", session.email, session.server);
            whoami(&gmed)
        }
        Command::Logout => {
            let gmed = Gmed::new(paths)?;
            if gmed.logout()? {
                println!("Signed out.");
            } else {
                println!("Not signed in.");
            }
            Ok(())
        }
        Command::Whoami => whoami(&Gmed::new(paths)?),
        Command::Scanners { timeout, save } => scanners(&paths, timeout, save),
        Command::Scan {
            scanner,
            source,
            duplex,
            color,
            dpi,
            paper,
            title,
            note,
            no_upload,
            keep,
            output,
        } => {
            let request = ScanRequest {
                source,
                duplex,
                color,
                dpi,
                paper,
            };
            let options = FileOptions {
                title,
                note,
                no_upload,
                keep,
                output,
            };
            run_scan(paths, scanner, request, options)
        }
        Command::Upload {
            files,
            title,
            note,
            delete,
        } => upload(paths, files, title, note, delete),
        Command::Watch {
            folder,
            interval,
            settle,
            after_upload,
            once,
            note,
        } => {
            let gmed = Gmed::new(paths)?;
            let options = watch::WatchOptions {
                dir: folder.clone(),
                interval: Duration::from_secs(interval.max(1)),
                settle: Duration::from_secs(settle),
                after_upload,
                once,
                notes: note,
            };
            if !once {
                println!(
                    "Watching {} - finished scans go to {}. Stop with Ctrl+C.",
                    folder.display(),
                    gmed.destination().label()
                );
            }
            let summary = watch::run(&gmed, &options, |line| {
                println!("[{}] {line}", Local::now().format("%H:%M:%S"));
            })?;
            println!(
                "{} uploaded, {} refused, {} left for a later attempt.",
                summary.uploaded, summary.rejected, summary.pending
            );
            if summary.pending > 0 {
                bail!("{} file(s) could not be uploaded", summary.pending);
            }
            Ok(())
        }
    }
}

struct TerminalPrompt;

impl LoginPrompt for TerminalPrompt {
    fn totp_code(&mut self, retry: bool) -> Result<String> {
        if retry {
            eprintln!("The code does not match, try again.");
        }
        read_line("Authenticator code: ")
    }

    fn waiting_for_approval(&mut self) {
        eprintln!(
            "This account needs an administrator to approve the sign-in; waiting (up to 15 minutes)..."
        );
    }
}

fn read_line(prompt: &str) -> Result<String> {
    eprint!("{prompt}");
    io::stderr().flush()?;
    let mut line = String::new();
    if io::stdin().lock().read_line(&mut line)? == 0 {
        bail!("no input");
    }
    Ok(line.trim().to_string())
}

/// Ask for whatever is missing, sign in and remember the server.
fn sign_in(
    paths: &Paths,
    gmed: &Gmed,
    server: Option<String>,
    email: Option<String>,
) -> Result<Session> {
    let mut config = paths.load_config()?;
    let server = match server.or_else(|| config.server.clone()) {
        Some(server) => server,
        None => match default_server() {
            Some(default) => {
                let answer = read_line(&format!("GMED address [{default}]: "))?;
                if answer.is_empty() {
                    default.to_string()
                } else {
                    answer
                }
            }
            None => read_line("GMED address (e.g. https://gmed.example.de): ")?,
        },
    };
    let email = match email {
        Some(email) => email,
        None => read_line("E-mail: ")?,
    };
    let password = if io::stdin().is_terminal() {
        rpassword::prompt_password("Password: ").context("read the password")?
    } else {
        // Non-interactive use (scripts): the password comes from stdin.
        read_line("")?
    };
    let session = gmed.login(&server, &email, &password, &mut TerminalPrompt)?;
    config.server = Some(session.server.clone());
    paths.save_config(&config)?;
    Ok(session)
}

fn whoami(gmed: &Gmed) -> Result<()> {
    let profile = gmed.profile()?;
    println!(
        "{} <{}>, role {}",
        profile.name.as_deref().unwrap_or("-"),
        profile.email,
        profile.role
    );
    if !profile.can_use_intake() {
        println!(
            "warning: role {} cannot add documents to the intake queue; GMED allows this for CEO and patient managers.",
            profile.role
        );
    }
    Ok(())
}

fn describe_scanner(scanner: &FoundScanner) -> String {
    format!(
        "{} ({})",
        scanner.name,
        scanner.model.as_deref().unwrap_or("unknown model")
    )
}

fn scanners(paths: &Paths, timeout: u64, save: Option<usize>) -> Result<()> {
    eprintln!("Searching for eSCL scanners for {timeout} s...");
    let found = discovery::discover(Duration::from_secs(timeout))?;
    if found.is_empty() {
        println!(
            "No scanner answered. Check that AirPrint/Bonjour is enabled in the scanner's Web Config and that this computer is on the same network, or pass the address directly: gmed-scan scan --scanner <IP>.{}",
            discovery::local_network_hint()
        );
        return Ok(());
    }
    for (index, scanner) in found.iter().enumerate() {
        println!(
            "{}. {} {}",
            index + 1,
            describe_scanner(scanner),
            scanner.urls.join("  ")
        );
    }
    let Some(number) = save else {
        return Ok(());
    };
    let Some(scanner) = number.checked_sub(1).and_then(|index| found.get(index)) else {
        bail!("there is no scanner number {number} in the list");
    };
    save_first_answering(paths, &scanner.urls, Some(&scanner.id))?;
    Ok(())
}

/// Save the first address that really answers as the default scanner:
/// HTTPS when the scanner's TLS works with this client, otherwise its plain
/// HTTP service. `id` is the Bonjour identity (`None` for a typed address).
fn save_first_answering(paths: &Paths, candidates: &[String], id: Option<&str>) -> Result<String> {
    let mut failures = Vec::new();
    for candidate in candidates {
        let probe = Scanner::new(candidate)
            .and_then(|scanner| scanner.capabilities().map(|caps| (scanner, caps)));
        match probe {
            Ok((scanner, caps)) => {
                if !failures.is_empty() {
                    eprintln!(
                        "warning: HTTPS did not work ({}); using unencrypted HTTP inside the local network",
                        failures.join("; ")
                    );
                }
                let url = scanner.base().to_string();
                let mut config = paths.load_config()?;
                config.scanner = Some(url.clone());
                config.scanner_id = id.map(str::to_string);
                paths.save_config(&config)?;
                println!(
                    "Default scanner: {} ({})",
                    url,
                    caps.make_and_model.as_deref().unwrap_or("eSCL scanner")
                );
                return Ok(url);
            }
            Err(error) => failures.push(format!("{candidate}: {error:#}")),
        }
    }
    bail!("the scanner does not answer: {}", failures.join("; "))
}

struct FileOptions {
    title: Option<String>,
    note: Option<String>,
    no_upload: bool,
    keep: bool,
    output: Option<PathBuf>,
}

fn ensure_intake_role(gmed: &Gmed) -> Result<()> {
    let profile = gmed.profile()?;
    if !profile.can_use_intake() {
        bail!(
            "role {} cannot add documents to the intake queue; sign in as a CEO or patient manager",
            profile.role
        );
    }
    Ok(())
}

fn run_scan(
    paths: Paths,
    scanner: Option<String>,
    request: ScanRequest,
    options: FileOptions,
) -> Result<()> {
    let saved = paths.load_config()?.scanner;
    let target = match (scanner, saved) {
        (Some(target), _) => target,
        (None, Some(saved)) => reachable_scanner(&paths, &saved)?,
        (None, None) => {
            bail!("no scanner chosen; run `gmed-scan scanners --save 1` or pass --scanner <IP>")
        }
    };
    let gmed = Gmed::new(paths.clone())?;
    if !options.no_upload {
        // Fail before paper moves through the scanner, not after.
        ensure_intake_role(&gmed)?;
    }
    scan_and_file(&gmed, &paths, &target, &request, &options)
}

/// The saved scanner's address, or its new one when it moved (a new DHCP
/// lease) and Bonjour still finds it under the same identity.
fn reachable_scanner(paths: &Paths, target: &str) -> Result<String> {
    let error = match Scanner::new(target).and_then(|scanner| scanner.capabilities()) {
        Ok(_) => return Ok(target.to_string()),
        Err(error) => error,
    };
    let Some(id) = paths.load_config()?.scanner_id else {
        return Err(error);
    };
    eprintln!("The scanner does not answer at {target}; searching for it on the network...");
    let found = discovery::discover(Duration::from_secs(5)).unwrap_or_default();
    let Some(scanner) = found.iter().find(|scanner| scanner.id == id) else {
        return Err(error.context("the scanner was not found on the network either"));
    };
    save_first_answering(paths, &scanner.urls, Some(&scanner.id))
}

fn scan_and_file(
    gmed: &Gmed,
    paths: &Paths,
    target: &str,
    request: &ScanRequest,
    options: &FileOptions,
) -> Result<()> {
    let scanner = Scanner::new(target)?;
    eprintln!("Scanning on {}...", scanner.base());
    let document = scan::scan_document(&scanner, request, |page| {
        eprintln!("  page {page}");
    })?;
    let file_name = scan::scan_file_name(Local::now());
    let dir = options.output.clone().unwrap_or_else(|| paths.outbox());
    let saved = scan::save_parts(&dir, &file_name, &document)?;
    let count = saved.len();
    let size_mb = document.size() as f64 / 1_048_576.0;
    eprintln!("{} page(s), {size_mb:.1} MB", document.pages);
    if count > 1 {
        eprintln!(
            "GMED accepts at most 25 MB per document, so this scan becomes {count} documents."
        );
    }
    for path in &saved {
        eprintln!("  -> {}", path.display());
    }
    if options.no_upload {
        for path in &saved {
            println!("{}", path.display());
        }
        return Ok(());
    }
    let mut not_uploaded = Vec::new();
    for (index, path) in saved.iter().enumerate() {
        let notes = scan::scan_note(&document, index, request, options.note.as_deref());
        let title = options.title.as_ref().map(|title| match count {
            1 => title.clone(),
            _ => format!("{title} ({}/{count})", index + 1),
        });
        match watch::upload_file(gmed, path, title, Some(notes)) {
            Ok(uploaded) => {
                match gmed.destination() {
                    Destination::Documents => println!(
                        "Filed into the GMED intake queue as draft document {}.",
                        uploaded.id
                    ),
                    Destination::Personnel => println!(
                        "Filed into the GMED personnel-file intake ({}).",
                        uploaded.id
                    ),
                }
                if !options.keep
                    && let Err(error) = std::fs::remove_file(path)
                {
                    eprintln!(
                        "warning: {} was filed but could not be deleted ({error}); delete it by hand so it is not sent twice",
                        path.display()
                    );
                }
            }
            Err(error) => {
                eprintln!("error: {}: {error:#}", path.display());
                not_uploaded.push(format!("\"{}\"", path.display()));
            }
        }
    }
    if !not_uploaded.is_empty() {
        bail!(
            "{} of {count} file(s) were not uploaded and are kept; retry with: gmed-scan upload {}",
            not_uploaded.len(),
            not_uploaded.join(" ")
        );
    }
    Ok(())
}

fn upload(
    paths: Paths,
    files: Vec<PathBuf>,
    title: Option<String>,
    note: Option<String>,
    delete: bool,
) -> Result<()> {
    let gmed = Gmed::new(paths)?;
    let mut failures = 0;
    for file in &files {
        match watch::upload_file(&gmed, file, title.clone(), note.clone()) {
            Ok(uploaded) => {
                println!("{} -> intake document {}", file.display(), uploaded.id);
                if delete {
                    std::fs::remove_file(file)
                        .with_context(|| format!("delete {}", file.display()))?;
                }
            }
            Err(error) => {
                failures += 1;
                eprintln!("{}: {error:#}", file.display());
            }
        }
    }
    if failures > 0 {
        bail!("{failures} of {} file(s) were not uploaded", files.len());
    }
    Ok(())
}

fn ask_retry(prompt: &str) -> Result<()> {
    if read_line(prompt)?.eq_ignore_ascii_case("q") {
        bail!("stopped");
    }
    Ok(())
}

/// Make sure a session with an intake role exists, signing in if needed.
fn ensure_station_session(paths: &Paths, gmed: &Gmed, announce: bool) -> Result<()> {
    loop {
        if paths.load_session()?.is_some() {
            match gmed.profile() {
                Ok(profile) if profile.can_use_intake() => {
                    if announce {
                        println!(
                            "Signed in as {} <{}>.",
                            profile.name.as_deref().unwrap_or("-"),
                            profile.email
                        );
                    }
                    return Ok(());
                }
                Ok(profile) => {
                    println!(
                        "The role {} cannot add documents to the intake queue. Sign in with a CEO or patient manager account.",
                        profile.role
                    );
                    let _ = gmed.logout();
                }
                // The session still exists, so GMED was not reachable.
                Err(error) if paths.load_session()?.is_some() => {
                    eprintln!("error: {error:#}");
                    ask_retry("Enter = try again, q = quit: ")?;
                    continue;
                }
                // The session has ended; sign in again below.
                Err(error) => eprintln!("{error:#}"),
            }
        }
        println!("Sign in to GMED.");
        if let Err(error) = sign_in(paths, gmed, None, None) {
            eprintln!("error: {error:#}");
            ask_retry("Enter = try again, q = quit: ")?;
        }
    }
}

/// Find the scanner (or ask for its address) and remember it.
fn pick_scanner(paths: &Paths) -> Result<String> {
    loop {
        println!("Searching for scanners (5 s)...");
        let found = discovery::discover(Duration::from_secs(5)).unwrap_or_else(|error| {
            eprintln!("warning: {error:#}");
            Vec::new()
        });
        let (candidates, id) = match found.as_slice() {
            [] => {
                println!("No scanner found.{}", discovery::local_network_hint());
                let address = read_line(
                    "Scanner IP address (shown in the network status on its display), Enter = search again, q = quit: ",
                )?;
                if address.eq_ignore_ascii_case("q") {
                    bail!("stopped");
                }
                if address.is_empty() {
                    continue;
                }
                (vec![address], None)
            }
            [only] => {
                println!("Found {}.", describe_scanner(only));
                (only.urls.clone(), Some(only.id.clone()))
            }
            several => {
                for (index, scanner) in several.iter().enumerate() {
                    println!("{}. {}", index + 1, describe_scanner(scanner));
                }
                let answer = read_line("Scanner number: ")?;
                match answer
                    .parse::<usize>()
                    .ok()
                    .and_then(|number| number.checked_sub(1))
                    .and_then(|index| several.get(index))
                {
                    Some(scanner) => (scanner.urls.clone(), Some(scanner.id.clone())),
                    None => continue,
                }
            }
        };
        match save_first_answering(paths, &candidates, id.as_deref()) {
            Ok(url) => return Ok(url),
            Err(error) => {
                eprintln!("error: {error:#}");
                ask_retry("Enter = search again, q = quit: ")?;
            }
        }
    }
}

fn station_request(source: Source, duplex: bool, color: ColorMode) -> ScanRequest {
    ScanRequest {
        source,
        duplex,
        color,
        dpi: 300,
        paper: Paper::A4,
    }
}

/// Scans whose upload failed earlier (they stay in the outbox).
fn waiting_scans(paths: &Paths) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(paths.outbox())
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && watch::mime_for(path).is_some())
        .collect();
    files.sort();
    files
}

/// Where the station puts outbox scans that GMED refused, so `u` does not
/// offer them forever.
const REFUSED_DIR: &str = "refused";

fn upload_waiting(gmed: &Gmed, paths: &Paths, files: &[PathBuf]) {
    for file in files {
        let notes = Some("gmed-scan: upload retried from the outbox".to_string());
        match watch::upload_file(gmed, file, None, notes) {
            Ok(uploaded) => match std::fs::remove_file(file) {
                Ok(()) => println!("{} -> intake document {}", file.display(), uploaded.id),
                Err(error) => eprintln!(
                    "{} was filed as document {} but could not be deleted ({error}); delete it by hand so it is not sent twice",
                    file.display(),
                    uploaded.id
                ),
            },
            Err(error)
                if error
                    .downcast_ref::<ApiError>()
                    .is_some_and(ApiError::rejects_file) =>
            {
                let reason = format!("{error:#}");
                match watch::set_aside(&paths.outbox(), REFUSED_DIR, file, &reason) {
                    Ok(target) => eprintln!(
                        "GMED refused {}: {reason}. It was moved to {}; scan the document again and delete that file.",
                        file.display(),
                        target.display()
                    ),
                    Err(move_error) => eprintln!(
                        "GMED refused {}: {reason}; it could not be moved aside ({move_error:#}), delete it by hand",
                        file.display()
                    ),
                }
            }
            Err(error) => eprintln!("{}: {error:#}", file.display()),
        }
    }
}

fn station(paths: Paths) -> Result<()> {
    let gmed = Gmed::new(paths.clone())?;
    match gmed.destination() {
        Destination::Documents => println!(
            "GMED Scan {} - every scan goes to the GMED intake queue as a draft.",
            env!("CARGO_PKG_VERSION")
        ),
        Destination::Personnel => println!(
            "GMED Scan {} - PERSONNEL FILES: every scan goes to the personnel-file intake.",
            env!("CARGO_PKG_VERSION")
        ),
    }
    ensure_station_session(&paths, &gmed, true)?;
    let mut target = match paths.load_config()?.scanner {
        Some(target) => target,
        None => pick_scanner(&paths)?,
    };
    let mut color = ColorMode::Color;
    loop {
        let mode = match color {
            ColorMode::Color => "color",
            ColorMode::Gray => "gray",
        };
        let waiting = waiting_scans(&paths);
        println!();
        if !waiting.is_empty() {
            println!(
                "{} earlier scan(s) could not be uploaded yet: u = upload them now",
                waiting.len()
            );
        }
        println!("Scanner {target}, {mode}, 300 dpi, A4. Load the pages, then:");
        println!("  Enter = scan from the feeder    d = both sides    f = from the glass");
        println!("  g = switch color/gray    s = other scanner    l = other account    q = quit");
        let request = match read_line("> ")?.to_ascii_lowercase().as_str() {
            "u" => {
                ensure_station_session(&paths, &gmed, false)?;
                upload_waiting(&gmed, &paths, &waiting);
                continue;
            }
            "" => station_request(Source::Adf, false, color),
            "d" => station_request(Source::Adf, true, color),
            "f" => station_request(Source::Flatbed, false, color),
            "g" => {
                color = match color {
                    ColorMode::Color => ColorMode::Gray,
                    ColorMode::Gray => ColorMode::Color,
                };
                continue;
            }
            "s" => {
                target = pick_scanner(&paths)?;
                continue;
            }
            "l" => {
                let _ = gmed.logout();
                ensure_station_session(&paths, &gmed, true)?;
                continue;
            }
            "q" => return Ok(()),
            _ => continue,
        };
        // Check the session and the scanner before paper moves through it.
        ensure_station_session(&paths, &gmed, false)?;
        target = match reachable_scanner(&paths, &target) {
            Ok(target) => target,
            Err(error) => {
                eprintln!("error: {error:#}");
                eprintln!("Check that the scanner is on, or press s to choose it again.");
                continue;
            }
        };
        let options = FileOptions {
            title: None,
            note: None,
            no_upload: false,
            keep: false,
            output: None,
        };
        if let Err(error) = scan_and_file(&gmed, &paths, &target, &request, &options) {
            eprintln!("error: {error:#}");
        }
    }
}
