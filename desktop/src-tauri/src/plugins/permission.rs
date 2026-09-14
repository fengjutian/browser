use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PluginPermission {
    PageRead,
    PageWrite,
    TabRead,
    TabCreate,
    TabClose,
    HistoryRead,
    BookmarkRead,
    BookmarkWrite,
    KnowledgeRead,
    KnowledgeWrite,
    AiChat,
    AiEmbedding,
    NetworkRequest,
    FilesystemRead,
    FilesystemWrite,
}
