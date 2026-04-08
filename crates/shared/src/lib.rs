pub use gmed_domain::role::Role;

pub mod api {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    pub struct HealthResponse {
        pub status: String,
        pub version: String,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct ErrorResponse {
        pub error: String,
        pub message: String,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct LoginRequest {
        pub email: String,
        pub password: String,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct LoginResponse {
        pub token: String,
        pub user: UserInfo,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct UserInfo {
        pub id: String,
        pub email: String,
        pub name: String,
        pub role: super::Role,
    }
}
