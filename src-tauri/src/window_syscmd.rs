//! 触控板三指手势（最大化 / 最小化）兼容层
//!
//! 背景：主窗口 `decorations: false`（自绘标题栏）后是 WS_POPUP 无边框窗口，
//! 缺少 WS_SYSMENU / WS_MINIMIZEBOX / WS_MAXIMIZEBOX 样式位。触摸板驱动实现
//! 「三指上滑最大化 / 三指下拉最小化」的方式是向前台窗口投递 WM_SYSCOMMAND
//! （SC_MAXIMIZE / SC_MINIMIZE），这条消息的处理依赖上述样式位——
//! 于是带系统标题栏的软件手势正常、本应用无响应。
//!
//! 修复两步（对主窗口执行，见 `run()` 的 setup，Agent 窗口为原生边框无需处理）：
//! 1. 补回三个样式位（Electron frameless 同款做法；无边框窗口上无可见副作用）；
//! 2. 子类化窗口过程，显式接住 WM_SYSCOMMAND 的 SC_MINIMIZE / SC_MAXIMIZE /
//!    SC_RESTORE，直接 ShowWindow 执行（等价原生标题栏按钮行为），
//!    其余消息原样交回原窗口过程（tao 自身的无边框命中测试不受影响）。

#[cfg(windows)]
mod imp {
  use std::collections::HashMap;
  use std::sync::Mutex;

  use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
  use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DefWindowProcW, GetWindowLongPtrW, SetWindowLongPtrW, ShowWindow, GWL_STYLE,
    GWLP_WNDPROC, SC_MAXIMIZE, SC_MINIMIZE, SC_RESTORE, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE,
    WM_SYSCOMMAND, WNDPROC, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU,
  };

  /// 原窗口过程表：hwnd 地址（isize）→ 子类化前的窗口过程，用于消息回传。
  /// 惰性初始化（Mutex::new 是 const，HashMap::new 不是）。
  static ORIGINAL_PROCS: Mutex<Option<HashMap<isize, WNDPROC>>> = Mutex::new(None);

  /// 原生窗口过程签名（windows-sys 的 WNDPROC 是 Option 包装，回传前需还原）
  type RawWndProc = unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT;

  /// 子类化窗口过程：接住 WM_SYSCOMMAND 的最小化 / 最大化 / 还原，其余回传原过程
  unsafe extern "system" fn syscmd_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
  ) -> LRESULT {
    if msg == WM_SYSCOMMAND {
      // 低 4 位由系统内部使用，命令码取 wParam & 0xFFF0（Win32 惯例）
      let show_cmd = match (wparam & 0xFFF0) as u32 {
        SC_MINIMIZE => Some(SW_MINIMIZE),
        SC_MAXIMIZE => Some(SW_MAXIMIZE),
        SC_RESTORE => Some(SW_RESTORE),
        _ => None,
      };
      if let Some(show_cmd) = show_cmd {
        ShowWindow(hwnd, show_cmd);
        return 0;
      }
    }
    let original = ORIGINAL_PROCS
      .lock()
      .ok()
      .and_then(|guard| guard.as_ref().and_then(|map| map.get(&(hwnd as isize)).copied()));
    match original {
      Some(original) => CallWindowProcW(original, hwnd, msg, wparam, lparam),
      // 找不到原过程（理论不可达，兜底）：交回默认处理，避免消息丢失
      None => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
  }

  /// 对主窗口启用系统命令支持：补样式位 + 子类化窗口过程
  pub fn enable(window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
      return;
    };
    // tauri 返回的 HWND 是 windows crate 的包装结构体，`.0` 即裸指针
    // （与 windows-sys 0.59 的 HWND = *mut c_void 同型）
    let hwnd: HWND = hwnd.0;
    unsafe {
      // 1) 补回无边框窗口缺失的三个样式位：SC_ 系统命令的合法性判定依据
      let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
      SetWindowLongPtrW(
        hwnd,
        GWL_STYLE,
        style | ((WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX) as isize),
      );
      // 2) 子类化：SetWindowLongPtrW 返回原窗口过程地址（isize）
      let original = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, syscmd_wndproc as *const () as isize);
      if original == 0 {
        return;
      }
      let original_proc: WNDPROC = Some(std::mem::transmute::<isize, RawWndProc>(original));
      if let Ok(mut guard) = ORIGINAL_PROCS.lock() {
        guard
          .get_or_insert_with(HashMap::new)
          .insert(hwnd as isize, original_proc);
      }
    }
  }
}

/// 对主窗口启用系统命令支持（三指手势 / ShowWindow 系统命令）；非 Windows 平台为空操作。
pub fn enable(window: &tauri::WebviewWindow) {
  #[cfg(windows)]
  imp::enable(window);
  #[cfg(not(windows))]
  let _ = window;
}
