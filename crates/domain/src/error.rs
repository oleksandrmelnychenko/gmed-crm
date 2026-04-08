use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Auth(String),
    Forbidden(String),
    NotFound(String),
    Validation(String),
    Conflict(String),
    Internal(String),
}

impl AppError {
    /// Safe message for external clients — never leaks internals.
    pub fn client_message(&self) -> &str {
        match self {
            AppError::Auth(_) => "Authentication failed",
            AppError::Forbidden(_) => "Access denied",
            AppError::NotFound(_) => "Resource not found",
            AppError::Validation(msg) => msg,
            AppError::Conflict(msg) => msg,
            AppError::Internal(_) => "An internal error occurred",
        }
    }

    /// HTTP status code.
    pub fn status_code(&self) -> u16 {
        match self {
            AppError::Auth(_) => 401,
            AppError::Forbidden(_) => 403,
            AppError::NotFound(_) => 404,
            AppError::Validation(_) => 422,
            AppError::Conflict(_) => 409,
            AppError::Internal(_) => 500,
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Auth(msg) => write!(f, "Auth: {msg}"),
            AppError::Forbidden(msg) => write!(f, "Forbidden: {msg}"),
            AppError::NotFound(msg) => write!(f, "NotFound: {msg}"),
            AppError::Validation(msg) => write!(f, "Validation: {msg}"),
            AppError::Conflict(msg) => write!(f, "Conflict: {msg}"),
            AppError::Internal(msg) => write!(f, "Internal: {msg}"),
        }
    }
}

impl std::error::Error for AppError {}
