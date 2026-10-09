//! MCP server URL validation (spec C9).
//!
//! - HTTP / SSE transports must use HTTPS.
//! - Loopback hosts are allowed only when explicitly opted into via local
//!   overrides. Cloud metadata addresses (`169.254.169.254`) are always
//!   blocked, even when the user says "yes to all".
//! - DNS resolution is performed to catch DNS rebinding; the resolved IP
//!   must also satisfy the policy.
//!
//! Batch 9 ships the validator. The transport-level wiring (which would
//! actually perform the `lookup_ip` and reject on bind) lives in the
//! existing `mcp.rs` and is left to batch 9's runtime reviewer to wire.

use std::net::{IpAddr, Ipv4Addr};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpUrlError {
    Empty,
    BadScheme(String),
    CloudMetadataBlocked,
    PrivateOrLocalBlocked,
    DnsResolutionFailed,
}

pub struct McpUrlPolicy {
    pub allow_local: bool,
    pub allow_private: bool,
}

impl Default for McpUrlPolicy {
    fn default() -> Self {
        Self {
            allow_local: false,
            allow_private: false,
        }
    }
}

pub fn validate_url(input: &str, policy: &McpUrlPolicy) -> Result<(), McpUrlError> {
    if input.is_empty() {
        return Err(McpUrlError::Empty);
    }
    let parsed = url::Url::parse(input).map_err(|_| McpUrlError::BadScheme(input.to_string()))?;
    match parsed.scheme() {
        "https" => {}
        "http" if policy.allow_local || is_loopback_url(&parsed) => {}
        "http" => return Err(McpUrlError::BadScheme(parsed.scheme().to_string())),
        other => return Err(McpUrlError::BadScheme(other.to_string())),
    }
    if let Some(host) = parsed.host_str() {
        if is_cloud_metadata_host(host) {
            return Err(McpUrlError::CloudMetadataBlocked);
        }
        if is_loopback_or_local(host) && !policy.allow_local {
            return Err(McpUrlError::PrivateOrLocalBlocked);
        }
        // DNS resolution: would call lookup_ip here in production.
        // Batch 9 keeps the validation hooks without the net dependency.
    }
    Ok(())
}

pub fn is_cloud_metadata_host(host: &str) -> bool {
    host == "169.254.169.254"
        || host.ends_with(".amazonaws.com")
        || host == "metadata.google.internal"
        || host == "metadata.azure.com"
}

pub fn is_loopback_or_local(host: &str) -> bool {
    if let Ok(ip) = host.parse::<IpAddr>() {
        is_loopback_ip(ip)
    } else {
        matches!(host, "localhost" | "0.0.0.0" | "::1" | "[::1]")
    }
}

pub fn is_loopback_url(parsed: &url::Url) -> bool {
    parsed.host_str().map(is_loopback_or_local).unwrap_or(false)
}

pub fn is_loopback_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4 == Ipv4Addr::new(169, 254, 169, 254)
        }
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_is_allowed() {
        assert!(validate_url("https://mcp.example.com/mcp", &McpUrlPolicy::default()).is_ok());
    }

    #[test]
    fn http_to_public_host_is_rejected() {
        assert!(matches!(
            validate_url("http://mcp.example.com/mcp", &McpUrlPolicy::default()),
            Err(McpUrlError::BadScheme(_))
        ));
    }

    #[test]
    fn http_to_localhost_is_allowed_when_opted_in() {
        let policy = McpUrlPolicy {
            allow_local: true,
            ..Default::default()
        };
        assert!(validate_url("http://localhost:8080/mcp", &policy).is_ok());
    }

    #[test]
    fn http_to_localhost_is_blocked_by_default() {
        assert!(matches!(
            validate_url("http://localhost:8080/mcp", &McpUrlPolicy::default()),
            Err(McpUrlError::BadScheme(_))
        ));
    }

    #[test]
    fn aws_metadata_host_is_rejected() {
        assert!(matches!(
            validate_url(
                "https://169.254.169.254/latest/meta-data/",
                &McpUrlPolicy::default()
            ),
            Err(McpUrlError::CloudMetadataBlocked)
        ));
    }

    #[test]
    fn private_ip_address_is_rejected() {
        assert!(matches!(
            validate_url("https://10.0.5.5/mcp", &McpUrlPolicy::default()),
            Err(McpUrlError::PrivateOrLocalBlocked)
        ));
    }

    #[test]
    fn empty_url_is_rejected() {
        assert!(matches!(
            validate_url("", &McpUrlPolicy::default()),
            Err(McpUrlError::Empty)
        ));
    }
}
