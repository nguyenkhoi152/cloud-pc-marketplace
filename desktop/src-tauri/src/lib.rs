// Vỏ native của Cloud PC Companion. Nghiệp vụ thuê/thanh toán nằm ở UI + API; không có credential quản trị trong app.
// Phần native duy nhất là `host`: tập lệnh CỐ ĐỊNH để máy host kiểm tra/khởi động/dừng môi trường guest Linux (WSL2).
mod connect;
mod host;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance PHẢI đăng ký đầu tiên. Bấm liên kết cloudpc:// khi app đang mở: không mở bản thứ hai, đưa cửa sổ hiện có lên
        // (feature "deep-link" của plugin chuyển liên kết cho on_open_url bên dưới).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_deep_link::init())
        .manage(host::HostState::default())
        .manage(connect::PendingConnect::default())
        .invoke_handler(tauri::generate_handler![
            connect::connect_take_pending,
            host::host_overview,
            host::host_set_wsl_distro,
            host::host_probe,
            host::host_install_agent,
            host::host_configure,
            host::host_enroll,
            host::host_provision_start,
            host::host_agent_start,
            host::host_agent_stop,
            host::host_cleanup,
            host::host_set_background,
            host::host_wsl_install_features,
            host::host_wsl_install_distro,
            host::host_tunnel_start,
            host::host_tunnel_state,
            host::host_tunnel_stop,
        ])
        .setup(|app| {
            // Liên kết kết nối: (1) app được MỞ bằng liên kết; (2) liên kết bấm khi app đang chạy. Lớp native chỉ kiểm dạng và chuyển cho giao diện,
            // giao diện hỏi xác nhận trước khi đổi máy chủ (xem connect.rs).
            let handle = app.handle().clone();
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for u in urls {
                    connect::offer(&handle, u.as_str());
                }
            }
            let on_link = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for u in event.urls() {
                    connect::offer(&on_link, u.as_str());
                }
                show_main(&on_link);
            });
            // Khay hệ thống: chỉ có tác dụng khi người dùng bật "Chạy nền khi đóng cửa sổ" (host_set_background). Mặc định đóng cửa sổ là thoát.
            let open = MenuItem::with_id(app, "open", "Mở Cloud PC Companion", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Dừng nhận thuê và thoát", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("Cloud PC Companion").show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "open" => show_main(app),
                // exit ⇒ RunEvent::Exit ⇒ host::shutdown: dừng agent, đóng tunnel, dọn guest.
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    show_main(tray.app_handle());
                }
            })
            .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && window.app_handle().state::<host::HostState>().hide_on_close() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("không khởi động được Cloud PC Companion")
        .run(|app, event| {
            // App thoát ⇒ đóng stdin của agent: agent cắt phiên xem, dọn guest rồi tự thoát (không để máy tiếp tục nhận thuê ngầm).
            if let RunEvent::Exit = event {
                host::shutdown(app, &app.state::<host::HostState>());
            }
        });
}
