use gloo_net::http::Request;
use gloo_storage::{LocalStorage, Storage};
use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::JsCast;

const BASE_URL: &str = "http://localhost:3000/api/v1";
const TOKEN_KEY: &str = "gmed_access_token";
const REFRESH_KEY: &str = "gmed_refresh_token";

pub fn save_tokens(access: &str, refresh: &str) {
    let _ = LocalStorage::set(TOKEN_KEY, access.to_string());
    let _ = LocalStorage::set(REFRESH_KEY, refresh.to_string());
}

pub fn get_access_token() -> Option<String> {
    LocalStorage::get::<String>(TOKEN_KEY).ok()
}

pub fn clear_tokens() {
    LocalStorage::delete(TOKEN_KEY);
    LocalStorage::delete(REFRESH_KEY);
}

fn redirect_to_login() {
    if let Some(window) = web_sys::window() {
        let _ = window.location().set_href("/login");
    }
}

pub fn is_logged_in() -> bool {
    get_access_token().is_some()
}

fn auth_header() -> Option<String> {
    let token = get_access_token()?;
    Some(format!("Bearer {token}"))
}

pub async fn get<T: DeserializeOwned>(path: &str) -> Result<T, String> {
    let url = format!("{BASE_URL}{path}");

    let req = match auth_header() {
        Some(h) => Request::get(&url).header("Authorization", &h),
        None => Request::get(&url),
    };

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if resp.status() == 401 {
        clear_tokens();
        redirect_to_login();
        return Err("Unauthorized".to_string());
    }

    if !resp.ok() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Error {}: {body}", resp.status()));
    }

    resp.json::<T>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

pub async fn post<B: Serialize, T: DeserializeOwned>(path: &str, body: &B) -> Result<T, String> {
    let url = format!("{BASE_URL}{path}");

    let builder = match auth_header() {
        Some(h) => Request::post(&url).header("Authorization", &h),
        None => Request::post(&url),
    };

    let req = builder
        .json(body)
        .map_err(|e| format!("Serialize error: {e}"))?;

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if resp.status() == 401 {
        clear_tokens();
        redirect_to_login();
        return Err("Unauthorized".to_string());
    }

    if !resp.ok() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Error {}: {body}", resp.status()));
    }

    resp.json::<T>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

/// Upload a file via multipart/form-data (uses raw fetch API).
pub async fn upload_file<T: DeserializeOwned>(
    path: &str,
    file: &web_sys::File,
    message: Option<&str>,
) -> Result<T, String> {
    let url = format!("{BASE_URL}{path}");

    let form = web_sys::FormData::new().map_err(|_| "FormData init failed".to_string())?;
    form.append_with_blob_and_filename("file", file, &file.name())
        .map_err(|_| "FormData append failed".to_string())?;
    if let Some(msg) = message {
        form.append_with_str("message", msg)
            .map_err(|_| "FormData append msg failed".to_string())?;
    }

    let opts = web_sys::RequestInit::new();
    opts.set_method("POST");
    let form_value = wasm_bindgen::JsValue::from(form);
    opts.set_body(&form_value);

    let request = web_sys::Request::new_with_str_and_init(&url, &opts)
        .map_err(|_| "Request init failed".to_string())?;

    if let Some(token) = get_access_token() {
        request
            .headers()
            .set("Authorization", &format!("Bearer {token}"))
            .map_err(|_| "Set header failed".to_string())?;
    }

    let window = web_sys::window().ok_or("No window")?;
    let resp_value = wasm_bindgen_futures::JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|_| "Fetch failed".to_string())?;
    let resp: web_sys::Response = resp_value
        .dyn_into()
        .map_err(|_| "Response cast failed".to_string())?;

    if resp.status() == 401 {
        clear_tokens();
        redirect_to_login();
        return Err("Unauthorized".to_string());
    }
    if !resp.ok() {
        return Err(format!("Error {}", resp.status()));
    }

    let json =
        wasm_bindgen_futures::JsFuture::from(resp.json().map_err(|_| "json() failed".to_string())?)
            .await
            .map_err(|_| "JSON parse failed".to_string())?;

    serde_wasm_bindgen::from_value(json).map_err(|e| format!("Deserialize error: {e}"))
}

pub async fn post_no_body(path: &str) -> Result<(), String> {
    let url = format!("{BASE_URL}{path}");

    let req = match auth_header() {
        Some(h) => Request::post(&url).header("Authorization", &h),
        None => Request::post(&url),
    };

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if resp.status() == 401 {
        clear_tokens();
        redirect_to_login();
        return Err("Unauthorized".to_string());
    }

    if !resp.ok() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Error {}: {body}", resp.status()));
    }

    Ok(())
}
