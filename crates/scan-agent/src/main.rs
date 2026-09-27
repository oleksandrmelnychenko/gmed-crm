use std::io::{self, BufRead, IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use chrono::Local;
use clap::{Parser, Subcommand};

use gmed_scan::api::{Gmed, LoginPrompt};
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
                    "Watching {} - finished scans go to the GMED intake queue. Stop with Ctrl+C.",
                    folder.display()
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
            "No scanner answered. Check that AirPrint/Bonjour is enabled in the scanner's Web Config and that this computer is on the same network, or pass the address directly: gmed-scan scan --scanner <IP>"
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
    save_first_answering(paths, &scanner.urls)?;
    Ok(())
}

/// Save the first address that really answers as the default scanner:
/// HTTPS when the scanner's TLS works with this client, otherwise its plain
/// HTTP service.
fn save_first_answering(paths: &Paths, candidates: &[String]) -> Result<String> {
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
    let target = match scanner.or(paths.load_config()?.scanner) {
        Some(target) => target,
        None => {
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
    let path = scan::save_unique(&dir, &file_name, &document.pdf)?;
    let size_mb = document.pdf.len() as f64 / 1_048_576.0;
    eprintln!(
        "{} page(s), {size_mb:.1} MB -> {}",
        document.pages,
        path.display()
    );
    if options.no_upload {
        println!("{}", path.display());
        return Ok(());
    }
    let notes = scan::scan_note(&document, request, options.note.as_deref());
    match watch::upload_file(gmed, &path, options.title.clone(), Some(notes)) {
        Ok(uploaded) => {
            println!(
                "Filed into the GMED intake queue as draft document {}.",
                uploaded.id
            );
            if !options.keep {
                std::fs::remove_file(&path)
                    .with_context(|| format!("delete {}", path.display()))?;
            }
            Ok(())
        }
        Err(error) => Err(error.context(format!(
            "the scan is kept at {}; retry with: gmed-scan upload \"{}\"",
            path.display(),
            path.display()
        ))),
    }
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
        let candidates = match found.as_slice() {
            [] => {
                let address = read_line(
                    "No scanner found. Enter the scanner's IP address (shown in the network status on its display), or q to quit: ",
                )?;
                if address.eq_ignore_ascii_case("q") {
                    bail!("stopped");
                }
                if address.is_empty() {
                    continue;
                }
                vec![address]
            }
            [only] => {
                println!("Found {}.", describe_scanner(only));
                only.urls.clone()
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
                    Some(scanner) => scanner.urls.clone(),
                    None => continue,
                }
            }
        };
        match save_first_answering(paths, &candidates) {
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

fn upload_waiting(gmed: &Gmed, files: &[PathBuf]) {
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
            Err(error) => eprintln!("{}: {error:#}", file.display()),
        }
    }
}

fn station(paths: Paths) -> Result<()> {
    println!(
        "GMED Scan {} - every scan goes to the GMED intake queue as a draft.",
        env!("CARGO_PKG_VERSION")
    );
    let gmed = Gmed::new(paths.clone())?;
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
                upload_waiting(&gmed, &waiting);
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
        // Check the session before paper moves through the scanner.
        ensure_station_session(&paths, &gmed, false)?;
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
