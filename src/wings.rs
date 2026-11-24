use axum::http::StatusCode;
use tokio::io::AsyncReadExt;
use wings_api::client::{ApiHttpError, WingsClient};

const PER_PAGE: u64 = 100;

/// Lists every entry of `directory`, paging through Wings until all entries
/// are read or `max_pages` pages were fetched. A missing directory is `None`.
pub async fn list_directory(
    client: &WingsClient,
    server: uuid::Uuid,
    directory: &str,
    ignored: Option<Vec<compact_str::CompactString>>,
    max_pages: u64,
) -> Result<Option<Vec<wings_api::DirectoryEntry>>, ApiHttpError> {
    let mut query = wings_api::servers_server_files_list::get::Query {
        directory: Some(directory.into()),
        ignored,
        per_page: Some(PER_PAGE),
        ..Default::default()
    };

    let mut entries = Vec::new();
    for page in 1..=max_pages {
        query.page = Some(page);

        let response = match client.get_servers_server_files_list(server, &query).await {
            Ok(response) => response,
            Err(ApiHttpError::Http(StatusCode::NOT_FOUND, _)) if page == 1 => return Ok(None),
            Err(err) => return Err(err),
        };

        let received = response.entries.len() as u64;
        entries.extend(response.entries);

        if received < PER_PAGE || entries.len() as u64 >= response.total {
            break;
        }
        if page == max_pages {
            tracing::warn!(
                %server,
                directory,
                total = response.total,
                "directory listing truncated after {max_pages} pages"
            );
        }
    }

    Ok(Some(entries))
}

/// The most recently modified entries of `directory` (one page). A missing directory is `None`.
pub async fn newest_entries(
    client: &WingsClient,
    server: uuid::Uuid,
    directory: &str,
    ignored: Option<Vec<compact_str::CompactString>>,
) -> Result<Option<Vec<wings_api::DirectoryEntry>>, ApiHttpError> {
    let query = wings_api::servers_server_files_list::get::Query {
        directory: Some(directory.into()),
        ignored,
        per_page: Some(PER_PAGE),
        page: Some(1),
        sort: Some(wings_api::DirectorySortingMode::ModifiedDesc),
        ..Default::default()
    };

    match client.get_servers_server_files_list(server, &query).await {
        Ok(response) => Ok(Some(response.entries)),
        Err(ApiHttpError::Http(StatusCode::NOT_FOUND, _)) => Ok(None),
        Err(err) => Err(err),
    }
}

/// Reads a file of at most `max_size` bytes as (lossy) UTF-8. `None` when it is missing,
/// larger, ignored for the subuser or unreadable.
pub async fn read_file(
    client: &WingsClient,
    server: uuid::Uuid,
    file: &str,
    ignored: Option<Vec<compact_str::CompactString>>,
    max_size: u64,
) -> Option<String> {
    let reader = match client
        .get_servers_server_files_contents(
            server,
            &wings_api::servers_server_files_contents::get::Query {
                file: Some(file.into()),
                max_size: Some(max_size),
                ignored,
                ..Default::default()
            },
        )
        .await
    {
        Ok(reader) => reader,
        Err(err) => {
            tracing::debug!(%server, file, "failed to read: {err:?}");
            return None;
        }
    };

    let mut content = Vec::new();
    reader.take(max_size).read_to_end(&mut content).await.ok()?;
    Some(String::from_utf8_lossy(&content).into_owned())
}
