use super::client;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
}

#[derive(Deserialize, Clone, Debug)]
pub struct UserInfo {
    pub id: String,
    pub email: String,
    pub name: String,
    pub role: String,
    pub created_at: String,
}

pub async fn login(email: &str, password: &str) -> Result<UserInfo, String> {
    let body = LoginRequest {
        email: email.to_string(),
        password: password.to_string(),
    };

    let auth: AuthResponse = client::post("/auth/login", &body).await?;
    client::save_tokens(&auth.access_token, &auth.refresh_token);

    let me: UserInfo = client::get("/me").await?;
    Ok(me)
}

pub fn logout() {
    client::clear_tokens();
}

pub async fn get_me() -> Result<UserInfo, String> {
    client::get("/me").await
}
