use std::future::Future;
use std::str::FromStr;
use std::sync::{Arc, Mutex, Weak};
use std::{process::Command, thread, time::Duration};

use axum::Extension;
use axum::extract::ConnectInfo;
use sqlx::PgPool;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use uuid::Uuid;

use gmed_server::settings::{SettingsCache, TokenSettings};
use gmed_server::state::AppState;

static TEST_BACKEND: Mutex<Weak<TestDatabaseBackend>> = Mutex::new(Weak::new());
const TEST_AUDIT_IP_SALT: &str = "test-audit-ip-salt";
const TEST_PEER_ADDR: std::net::SocketAddr = std::net::SocketAddr::V4(std::net::SocketAddrV4::new(
    std::net::Ipv4Addr::LOCALHOST,
    40123,
));
#[allow(dead_code)]
const WAIT_UNTIL_ATTEMPTS: usize = 200;
#[allow(dead_code)]
const WAIT_UNTIL_DELAY_MS: u64 = 50;

#[allow(dead_code)]
pub struct TestSuiteContext {
    pub app: axum::Router,
    pub pool: PgPool,
    pub admin_id: Uuid,
    _suite_db: Arc<SuiteDatabase>,
}

struct SuiteDatabase {
    backend: Arc<TestDatabaseBackend>,
    database_name: String,
    pool: PgPool,
    admin_id: Uuid,
}

pub async fn suite_context(test_secret: &str) -> Option<TestSuiteContext> {
    let backend = match get_or_create_test_backend().await {
        Ok(backend) => backend,
        Err(error) => {
            eprintln!(
                "skipping integration suite: failed to resolve test database backend: {error}"
            );
            return None;
        }
    };
    let suite_db = Arc::new(match create_suite_database(backend).await {
        Ok(suite_db) => suite_db,
        Err(error) => {
            eprintln!("skipping integration suite: failed to provision test database: {error}");
            return None;
        }
    });
    let app_state = AppState::new(
        suite_db.pool.clone(),
        test_secret,
        SettingsCache::new(TokenSettings::default()),
    )
    .with_audit_sender(gmed_server::audit::spawn_writer(
        suite_db.pool.clone(),
        TEST_AUDIT_IP_SALT.to_string(),
    ));
    let app = gmed_server::build_app(app_state)
        .layer(Extension(ConnectInfo(TEST_PEER_ADDR)))
        .layer(Extension(suite_db.clone()));

    Some(TestSuiteContext {
        app,
        pool: suite_db.pool.clone(),
        admin_id: suite_db.admin_id,
        _suite_db: suite_db,
    })
}

#[allow(dead_code)]
pub async fn wait_until<F, Fut>(description: &str, mut predicate: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    for attempt in 0..WAIT_UNTIL_ATTEMPTS {
        if predicate().await {
            return;
        }

        if attempt + 1 < WAIT_UNTIL_ATTEMPTS {
            tokio::time::sleep(tokio::time::Duration::from_millis(WAIT_UNTIL_DELAY_MS)).await;
        }
    }

    panic!("timed out waiting for condition: {description}");
}

async fn get_or_create_test_backend() -> Result<Arc<TestDatabaseBackend>, String> {
    if let Some(existing) = TEST_BACKEND
        .lock()
        .map_err(|_| "test backend mutex poisoned".to_string())?
        .upgrade()
    {
        return Ok(existing);
    }

    let created = Arc::new(resolve_test_backend().await?);
    *TEST_BACKEND
        .lock()
        .map_err(|_| "test backend mutex poisoned".to_string())? = Arc::downgrade(&created);
    Ok(created)
}

async fn create_suite_database(backend: Arc<TestDatabaseBackend>) -> Result<SuiteDatabase, String> {
    let admin_pool = connect_pool(&backend.admin_database_url, "postgres")
        .await
        .map_err(|error| format!("connect admin database: {error}"))?;
    let database_name = format!(
        "gmed_test_{}_{}",
        std::process::id(),
        Uuid::new_v4().simple()
    );
    let create_sql = format!(r#"CREATE DATABASE "{database_name}""#);

    sqlx::query(&create_sql)
        .execute(&admin_pool)
        .await
        .map_err(|error| format!("create database {database_name}: {error}"))?;

    let pool = match connect_pool(&backend.admin_database_url, &database_name).await {
        Ok(pool) => pool,
        Err(error) => {
            let drop_sql = format!(r#"DROP DATABASE IF EXISTS "{database_name}""#);
            let _ = sqlx::query(&drop_sql).execute(&admin_pool).await;
            return Err(format!("connect database {database_name}: {error}"));
        }
    };

    if let Err(error) = gmed_db::run_migrations(&pool).await {
        let drop_sql = format!(r#"DROP DATABASE IF EXISTS "{database_name}""#);
        let _ = sqlx::query(&drop_sql).execute(&admin_pool).await;
        return Err(format!("run migrations for {database_name}: {error}"));
    }

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind("admin@gmed.de")
        .fetch_one(&pool)
        .await
        .map_err(|error| format!("load seeded admin from {database_name}: {error}"))?;

    Ok(SuiteDatabase {
        backend,
        database_name,
        pool,
        admin_id,
    })
}

struct TestDatabaseBackend {
    admin_database_url: String,
    docker_container: Option<String>,
}

async fn resolve_test_backend() -> Result<TestDatabaseBackend, String> {
    if let Ok(url) = std::env::var("TEST_DATABASE_ADMIN_URL") {
        return Ok(TestDatabaseBackend {
            admin_database_url: url,
            docker_container: None,
        });
    }

    if let Ok(url) = std::env::var("DATABASE_URL") {
        return Ok(TestDatabaseBackend {
            admin_database_url: url,
            docker_container: None,
        });
    }

    start_docker_postgres().await
}

async fn connect_pool(database_url: &str, database_name: &str) -> Result<PgPool, sqlx::Error> {
    let connect_options =
        PgConnectOptions::from_str(database_url).map(|options| options.database(database_name));

    PgPoolOptions::new()
        .max_connections(test_database_max_connections())
        .min_connections(0)
        .connect_with(connect_options?)
        .await
}

fn test_database_max_connections() -> u32 {
    std::env::var("TEST_DATABASE_MAX_CONNECTIONS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(8)
}

async fn start_docker_postgres() -> Result<TestDatabaseBackend, String> {
    let image =
        std::env::var("TEST_DATABASE_IMAGE").unwrap_or_else(|_| "postgres:16-alpine".to_string());
    let container_name = format!(
        "gmed-test-postgres-{}-{}",
        std::process::id(),
        Uuid::new_v4().simple()
    );
    let container_id = docker_stdout(&[
        "run",
        "-d",
        "--rm",
        "--name",
        &container_name,
        "-e",
        "POSTGRES_USER=postgres",
        "-e",
        "POSTGRES_PASSWORD=postgres",
        "-e",
        "POSTGRES_DB=postgres",
        "-p",
        "127.0.0.1::5432",
        &image,
    ])?;

    let port_output = docker_stdout(&["port", &container_id, "5432/tcp"]).inspect_err(|_| {
        let _ = docker_stop(&container_id);
    })?;
    let host_port = parse_docker_port(&port_output)?;
    let admin_database_url = format!("postgres://postgres:postgres@127.0.0.1:{host_port}/postgres");

    for _ in 0..60 {
        if connect_pool(&admin_database_url, "postgres").await.is_ok() {
            return Ok(TestDatabaseBackend {
                admin_database_url,
                docker_container: Some(container_id),
            });
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    let _ = docker_stop(&container_id);
    Err(format!(
        "docker postgres container {container_name} started but never became ready"
    ))
}

fn docker_stdout(args: &[&str]) -> Result<String, String> {
    let output = Command::new("docker")
        .args(args)
        .output()
        .map_err(|error| format!("spawn docker {:?}: {error}", args))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "docker {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn parse_docker_port(output: &str) -> Result<u16, String> {
    let trimmed = output.trim();
    let port_str = trimmed
        .rsplit(':')
        .next()
        .ok_or_else(|| format!("unexpected docker port output: {trimmed}"))?;
    port_str
        .parse::<u16>()
        .map_err(|error| format!("parse docker port from '{trimmed}': {error}"))
}

fn docker_stop(container_id: &str) -> Result<(), String> {
    let output = Command::new("docker")
        .args(["stop", container_id])
        .output()
        .map_err(|error| format!("stop docker container {container_id}: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "docker stop {container_id} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

impl Drop for SuiteDatabase {
    fn drop(&mut self) {
        let admin_database_url = self.backend.admin_database_url.clone();
        let database_name = self.database_name.clone();

        let _ = thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();

            let Ok(runtime) = runtime else {
                return;
            };

            runtime.block_on(async move {
                let Ok(admin_pool) = connect_pool(&admin_database_url, "postgres").await else {
                    return;
                };

                let _ = sqlx::query(
                    r#"SELECT pg_terminate_backend(pid)
                       FROM pg_stat_activity
                       WHERE datname = $1
                         AND pid <> pg_backend_pid()"#,
                )
                .bind(&database_name)
                .execute(&admin_pool)
                .await;

                let drop_sql = format!(r#"DROP DATABASE IF EXISTS "{database_name}""#);
                let _ = sqlx::query(&drop_sql).execute(&admin_pool).await;
                admin_pool.close().await;
            });
        })
        .join();
    }
}

impl Drop for TestDatabaseBackend {
    fn drop(&mut self) {
        if let Some(container_id) = self.docker_container.clone() {
            thread::sleep(Duration::from_millis(200));
            let _ = docker_stop(&container_id);
        }
    }
}
