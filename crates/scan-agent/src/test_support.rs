//! A tiny HTTP/1.1 server for tests: stands in for the scanner (eSCL) and
//! for the GMED API. One request per connection (`Connection: close`).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

#[derive(Clone, Debug)]
pub struct MockRequest {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// How many earlier requests had the same method and path.
    pub seen: usize,
}

impl MockRequest {
    pub fn header(&self, name: &str) -> Option<String> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.clone())
    }
}

pub struct MockReply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl MockReply {
    pub fn status(status: u16) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    pub fn bytes(content_type: &str, body: Vec<u8>) -> Self {
        Self::status(200)
            .header("Content-Type", content_type)
            .with_body(body)
    }

    pub fn xml(body: &str) -> Self {
        Self::bytes("text/xml", body.as_bytes().to_vec())
    }

    pub fn json(value: serde_json::Value) -> Self {
        Self::bytes("application/json", serde_json::to_vec(&value).unwrap())
    }

    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn with_status(mut self, status: u16) -> Self {
        self.status = status;
        self
    }

    fn with_body(mut self, body: Vec<u8>) -> Self {
        self.body = body;
        self
    }
}

type Handler = dyn Fn(&MockRequest) -> MockReply + Send + Sync;

pub struct MockServer {
    address: String,
    requests: Arc<Mutex<Vec<MockRequest>>>,
}

impl MockServer {
    pub fn start(handler: impl Fn(&MockRequest) -> MockReply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let handler: Arc<Handler> = Arc::new(handler);
        let log = requests.clone();
        thread::spawn(move || {
            let mut counts: HashMap<(String, String), usize> = HashMap::new();
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let Some(mut request) = read_request(&stream) else {
                    continue;
                };
                let key = (request.method.clone(), request.path.clone());
                let seen = counts.entry(key).or_default();
                request.seen = *seen;
                *seen += 1;
                log.lock().unwrap().push(request.clone());
                let reply = handler(&request);
                write_reply(stream, reply);
            }
        });
        Self { address, requests }
    }

    pub fn url(&self) -> String {
        self.address.clone()
    }

    pub fn requests(&self) -> Vec<MockRequest> {
        self.requests.lock().unwrap().clone()
    }
}

fn read_request(stream: &TcpStream) -> Option<MockRequest> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = Vec::new();
    loop {
        let mut header = String::new();
        reader.read_line(&mut header).ok()?;
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        let (name, value) = header.split_once(':')?;
        headers.push((name.trim().to_string(), value.trim().to_string()));
    }
    let find = |name: &str| {
        headers
            .iter()
            .find(|(key, _): &&(String, String)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.clone())
    };
    let mut body = Vec::new();
    if let Some(length) = find("content-length").and_then(|value| value.parse::<usize>().ok()) {
        body.resize(length, 0);
        reader.read_exact(&mut body).ok()?;
    } else if find("transfer-encoding").is_some_and(|value| value.eq_ignore_ascii_case("chunked")) {
        loop {
            let mut size_line = String::new();
            reader.read_line(&mut size_line).ok()?;
            let size = usize::from_str_radix(size_line.trim().split(';').next()?, 16).ok()?;
            let mut chunk = vec![0; size + 2];
            reader.read_exact(&mut chunk).ok()?;
            if size == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..size]);
        }
    }
    Some(MockRequest {
        method,
        path,
        headers,
        body,
        seen: 0,
    })
}

fn write_reply(mut stream: TcpStream, reply: MockReply) {
    let mut head = format!(
        "HTTP/1.1 {} Mock\r\nConnection: close\r\nContent-Length: {}\r\n",
        reply.status,
        reply.body.len()
    );
    for (name, value) in &reply.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&reply.body);
    let _ = stream.flush();
}

/// A fresh, empty directory under the system temp directory.
pub fn temp_dir(label: &str) -> PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "gmed-scan-test-{label}-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
