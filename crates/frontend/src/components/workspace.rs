use gloo_storage::{LocalStorage, Storage};
use leptos::prelude::*;
use serde::{Deserialize, Serialize};

const WORKSPACE_KEY: &str = "gmed_workspace";

/// Which panel is pinned to the right side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SidePanel {
    None,
    Chat,
}

/// Layout direction of the main content area.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Layout {
    /// Side panel on the right (default).
    Right,
    /// Side panel on the left (swapped).
    Left,
    /// Side panel on the bottom.
    Bottom,
}

/// Persisted workspace configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    pub side_panel: SidePanel,
    pub layout: Layout,
    /// Width of the side panel in px (only for Left/Right).
    pub panel_width: u32,
    /// Height of the side panel in px (only for Bottom).
    pub panel_height: u32,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            side_panel: SidePanel::None,
            layout: Layout::Right,
            panel_width: 380,
            panel_height: 320,
        }
    }
}

impl WorkspaceConfig {
    pub fn load() -> Self {
        LocalStorage::get::<WorkspaceConfig>(WORKSPACE_KEY).unwrap_or_default()
    }

    pub fn save(&self) {
        let _ = LocalStorage::set(WORKSPACE_KEY, self);
    }
}

/// Reactive workspace context — provided once in AuthenticatedLayout.
#[derive(Clone, Copy)]
pub struct WorkspaceCtx {
    pub config: ReadSignal<WorkspaceConfig>,
    pub set_config: WriteSignal<WorkspaceConfig>,
}

impl WorkspaceCtx {
    pub fn toggle_chat(&self) {
        let mut cfg = self.config.get_untracked();
        cfg.side_panel = match cfg.side_panel {
            SidePanel::Chat => SidePanel::None,
            SidePanel::None => SidePanel::Chat,
        };
        cfg.save();
        self.set_config.set(cfg);
    }

    pub fn set_layout(&self, layout: Layout) {
        let mut cfg = self.config.get_untracked();
        cfg.layout = layout;
        cfg.save();
        self.set_config.set(cfg);
    }

    pub fn set_panel_width(&self, w: u32) {
        let mut cfg = self.config.get_untracked();
        cfg.panel_width = w.clamp(280, 600);
        cfg.save();
        self.set_config.set(cfg);
    }

    pub fn set_panel_height(&self, h: u32) {
        let mut cfg = self.config.get_untracked();
        cfg.panel_height = h.clamp(200, 500);
        cfg.save();
        self.set_config.set(cfg);
    }
}

pub fn provide_workspace() -> WorkspaceCtx {
    let initial = WorkspaceConfig::load();
    let (config, set_config) = signal(initial);
    let ctx = WorkspaceCtx { config, set_config };
    provide_context(ctx);
    ctx
}
