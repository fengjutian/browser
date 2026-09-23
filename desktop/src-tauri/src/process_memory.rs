//! Process memory snapshot for the resource panel.
//!
//! On Windows uses `K32GetProcessMemoryInfo` from `psapi.dll` against the
//! current process. Other targets return `None` so the frontend degrades to
//! "—" without breaking.

#[cfg(target_os = "windows")]
mod imp {
    use serde::Serialize;
    use windows_sys::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    #[derive(Debug, Serialize)]
    pub struct ProcessMemory {
        /// Resident / working-set size in bytes (current physical memory in use).
        pub working_set_bytes: u64,
        /// Peak working-set size in bytes.
        pub peak_working_set_bytes: u64,
        /// Virtual size committed in bytes.
        pub commit_bytes: u64,
        /// Page-fault count (informational).
        pub page_fault_count: u64,
    }

    pub fn sample() -> Option<ProcessMemory> {
        let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
        let mut out_size = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let ok = unsafe {
            K32GetProcessMemoryInfo(
                GetCurrentProcess(),
                &mut counters,
                out_size,
            )
        };
        if ok == 0 {
            return None;
        }
        Some(ProcessMemory {
            working_set_bytes: counters.WorkingSetSize as u64,
            peak_working_set_bytes: counters.PeakWorkingSetSize as u64,
            commit_bytes: counters.PagefileUsage as u64,
            page_fault_count: counters.PageFaultCount as u64,
        })
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use serde::Serialize;

    #[derive(Debug, Serialize)]
    pub struct ProcessMemory {
        pub working_set_bytes: u64,
        pub peak_working_set_bytes: u64,
        pub commit_bytes: u64,
        pub page_fault_count: u64,
    }

    pub fn sample() -> Option<ProcessMemory> {
        None
    }
}

pub use imp::{sample, ProcessMemory};

/// Tauri command: snapshot of the current process memory accounting.
///
/// Returns `None` on platforms where the OS query is not yet implemented
/// (frontend should render an em-dash instead of zero).
#[tauri::command]
pub fn browser_process_memory() -> Option<ProcessMemory> {
    sample()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_shape_when_supported() {
        let result = sample();
        if let Some(snapshot) = result {
            assert!(snapshot.peak_working_set_bytes >= snapshot.working_set_bytes.min(u64::MAX));
        }
    }
}