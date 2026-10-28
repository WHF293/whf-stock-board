//! 移动端 APK 下载与安装（Android 专属，桌面目标整文件编译为空）
//!
//! 链路：前端从 GitHub Release 拿到 APK 资产直链 → `download_apk` 交给系统
//! DownloadManager 排队下载（免存储权限、自带通知与断点）→ 前端轮询
//! `apk_download_status` 展示进度 → 完成后 `install_apk` 用系统下载器的
//! content:// Uri 发 ACTION_VIEW，直接拉起安装界面。
//! 全部经 JNI 调 Android 框架 API，不引入原生插件工程（CI 里 gen/android
//! 由 `tauri android init` 重建，自定义 Kotlin 不可靠，Rust 侧 JNI 才是可入库形态）。

/// 附加结果：JNI 环境守卫（持有线程附加状态，Drop 时分离）+ Activity Context
/// （全局 Context 足够：DownloadManager / startActivity 均可用）
#[cfg(target_os = "android")]
type JniAttach = (
    jni::AttachGuard<'static>,
    jni::objects::JObject<'static>,
);

/// 进程内共享的 JavaVM 句柄（jni 的 JavaVM 是 Arc 内核，Clone 便宜；OnceLock 只做一次 from_raw）
#[cfg(target_os = "android")]
static JAVA_VM: std::sync::OnceLock<jni::JavaVM> = std::sync::OnceLock::new();

/// Context.DOWNLOAD_SERVICE 常量值
#[cfg(target_os = "android")]
const DOWNLOAD_SERVICE: i32 = 3177;

/// DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
#[cfg(target_os = "android")]
const VISIBILITY_NOTIFY_COMPLETED: i32 = 3;

/// Intent.FLAG_NEW_TASK | FLAG_GRANT_READ_URI_PERMISSION
#[cfg(target_os = "android")]
const INTENT_FLAGS: i32 = 0x1000_0000 | 0x0000_0001;

/// APK 的 MIME（安装器按此识别安装包）
#[cfg(target_os = "android")]
const APK_MIME: &str = "application/vnd.android.package-archive";

/// 附加当前线程拿 JNIEnv 与 Activity
#[cfg(target_os = "android")]
fn attach() -> Result<JniAttach, String> {
    let ctx = ndk_context::android_context();
    let vm = JAVA_VM.get_or_init(|| {
        unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.expect("JavaVM from_raw failed")
    });
    let guard: jni::AttachGuard<'static> = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let activity = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
    Ok((guard, activity))
}

/// 便捷新建 Java String
#[cfg(target_os = "android")]
fn jstr<'local>(
    env: &mut jni::JNIEnv<'local>,
    s: &str,
) -> Result<jni::objects::JObject<'local>, String> {
    Ok(jni::objects::JObject::from(
        env.new_string(s).map_err(|e| e.to_string())?,
    ))
}

/// 取系统服务（DownloadManager 用）
#[cfg(target_os = "android")]
fn download_manager<'local>(
    env: &mut jni::JNIEnv<'local>,
    activity: &jni::objects::JObject,
) -> Result<jni::objects::JObject<'local>, String> {
    env.call_method(
        activity,
        "getSystemService",
        "(I)Ljava/lang/Object;",
        &[jni::objects::JValue::Int(DOWNLOAD_SERVICE)],
    )
    .map_err(|e| e.to_string())?
    .l()
    .map_err(|e| e.to_string())
}

/// 把 APK 下载交给系统 DownloadManager，返回下载任务 id
#[cfg(target_os = "android")]
fn enqueue(url: &str, title: &str) -> Result<u64, String> {
    let (mut guard, activity) = attach()?;
    let env: &mut jni::JNIEnv = &mut guard;
    let dm = download_manager(env, &activity)?;
    let jurl = jstr(env, url)?;
    let uri = env
        .call_static_method(
            "android/net/Uri",
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[jni::objects::JValue::Object(&jurl)],
        )
        .map_err(|e| e.to_string())?
        .l()
        .map_err(|e| e.to_string())?;
    let request = env
        .new_object(
            "android/app/DownloadManager$Request",
            "(Landroid/net/Uri;)V",
            &[jni::objects::JValue::Object(&uri)],
        )
        .map_err(|e| e.to_string())?;
    let jtitle = jstr(env, title)?;
    let title_value = jni::objects::JValue::Object(&jtitle);
    env.call_method(
        &request,
        "setTitle",
        "(Ljava/lang/CharSequence;)Landroid/app/DownloadManager$Request;",
        &[title_value],
    )
    .map_err(|e| e.to_string())?;
    env.call_method(
        &request,
        "setNotificationVisibility",
        "(I)Landroid/app/DownloadManager$Request;",
        &[jni::objects::JValue::Int(VISIBILITY_NOTIFY_COMPLETED)],
    )
    .map_err(|e| e.to_string())?;
    let id = env
        .call_method(
            &dm,
            "enqueue",
            "(Landroid/app/DownloadManager$Request;)J",
            &[jni::objects::JValue::Object(&request)],
        )
        .map_err(|e| e.to_string())?
        .j()
        .map_err(|e| e.to_string())?;
    Ok(id as u64)
}

/// 查询下载任务：`(status, bytes_so_far, total_bytes)`，status ∈ pending/running/successful/failed
#[cfg(target_os = "android")]
fn query(id: u64) -> Result<(String, i32, i32), String> {
    let (mut guard, activity) = attach()?;
    let env: &mut jni::JNIEnv = &mut guard;
    let dm = download_manager(env, &activity)?;
    let query_obj = env
        .new_object("android/app/DownloadManager$Query", "()V", &[])
        .map_err(|e| e.to_string())?;
    env.call_method(
        &query_obj,
        "setFilterById",
        "(J)Landroid/app/DownloadManager$Query;",
        &[jni::objects::JValue::Long(id as i64)],
    )
    .map_err(|e| e.to_string())?;
    let cursor = env
        .call_method(
            &dm,
            "query",
            "(Landroid/app/DownloadManager$Query;)Landroid/database/Cursor;",
            &[jni::objects::JValue::Object(&query_obj)],
        )
        .map_err(|e| e.to_string())?
        .l()
        .map_err(|e| e.to_string())?;
    let moved = env
        .call_method(&cursor, "moveToFirst", "()Z", &[])
        .map_err(|e| e.to_string())?
        .z()
        .map_err(|e| e.to_string())?;
    if !moved {
        return Ok(("pending".into(), 0, 0));
    }
    // 列序号逐个取（避免嵌套闭包共享 env 的借用冲突）
    let j_status = jstr(env, "status")?;
    let status_idx = env
        .call_method(
            &cursor,
            "getColumnIndex",
            "(Ljava/lang/String;)I",
            &[jni::objects::JValue::Object(&j_status)],
        )
        .map_err(|e| e.to_string())?
        .i()
        .map_err(|e| e.to_string())?;
    let j_so_far = jstr(env, "bytes_so_far")?;
    let so_far_idx = env
        .call_method(
            &cursor,
            "getColumnIndex",
            "(Ljava/lang/String;)I",
            &[jni::objects::JValue::Object(&j_so_far)],
        )
        .map_err(|e| e.to_string())?
        .i()
        .map_err(|e| e.to_string())?;
    let j_total = jstr(env, "total_size_bytes")?;
    let total_idx = env
        .call_method(
            &cursor,
            "getColumnIndex",
            "(Ljava/lang/String;)I",
            &[jni::objects::JValue::Object(&j_total)],
        )
        .map_err(|e| e.to_string())?
        .i()
        .map_err(|e| e.to_string())?;
    let mut get_int = |idx: i32| -> Result<i32, String> {
        env.call_method(&cursor, "getInt", "(I)I", &[jni::objects::JValue::Int(idx)])
            .map_err(|e| e.to_string())?
            .i()
            .map_err(|e| e.to_string())
    };
    let status = get_int(status_idx)?;
    let so_far = get_int(so_far_idx)?;
    let total = get_int(total_idx)?;
    env.call_method(&cursor, "close", "()V", &[])
        .map_err(|e| e.to_string())?;
    // DownloadManager.STATUS_SUCCESSFUL=8 / STATUS_FAILED=16 / RUNNING=1,2 / PENDING=4
    let status_name = match status {
        8 => "successful",
        16 => "failed",
        1 | 2 => "running",
        _ => "pending",
    };
    Ok((status_name.into(), so_far, total))
}

/// 下载完成后拉起系统安装界面（复用下载器 content:// Uri，无需自建 FileProvider）
#[cfg(target_os = "android")]
fn install(id: u64) -> Result<(), String> {
    let (mut guard, activity) = attach()?;
    let env: &mut jni::JNIEnv = &mut guard;
    let dm = download_manager(env, &activity)?;
    let query_obj = env
        .new_object("android/app/DownloadManager$Query", "()V", &[])
        .map_err(|e| e.to_string())?;
    env.call_method(
        &query_obj,
        "setFilterById",
        "(J)Landroid/app/DownloadManager$Query;",
        &[jni::objects::JValue::Long(id as i64)],
    )
    .map_err(|e| e.to_string())?;
    let cursor = env
        .call_method(
            &dm,
            "query",
            "(Landroid/app/DownloadManager$Query;)Landroid/database/Cursor;",
            &[jni::objects::JValue::Object(&query_obj)],
        )
        .map_err(|e| e.to_string())?
        .l()
        .map_err(|e| e.to_string())?;
    let moved = env
        .call_method(&cursor, "moveToFirst", "()Z", &[])
        .map_err(|e| e.to_string())?
        .z()
        .map_err(|e| e.to_string())?;
    if !moved {
        return Err("下载任务不存在".into());
    }
    let j_uri = jstr(env, "uri")?;
    let uri_idx = env
        .call_method(
            &cursor,
            "getColumnIndexOrThrow",
            "(Ljava/lang/String;)I",
            &[jni::objects::JValue::Object(&j_uri)],
        )
        .map_err(|e| e.to_string())?
        .i()
        .map_err(|e| e.to_string())?;
    let local_uri = env
        .call_method(
            &cursor,
            "getString",
            "(I)Ljava/lang/String;",
            &[jni::objects::JValue::Int(uri_idx)],
        )
        .map_err(|e| e.to_string())?
        .l()
        .map_err(|e| e.to_string())?;
    env.call_method(&cursor, "close", "()V", &[])
        .map_err(|e| e.to_string())?;
    let j_action = jstr(env, "android.intent.action.VIEW")?;
    let intent = env
        .new_object(
            "android/content/Intent",
            "(Ljava/lang/String;)V",
            &[jni::objects::JValue::Object(&j_action)],
        )
        .map_err(|e| e.to_string())?;
    let parsed = env
        .call_static_method(
            "android/net/Uri",
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[jni::objects::JValue::Object(&local_uri)],
        )
        .map_err(|e| e.to_string())?
        .l()
        .map_err(|e| e.to_string())?;
    let j_mime = jstr(env, APK_MIME)?;
    let uri_value = jni::objects::JValue::Object(&parsed);
    let mime_value = jni::objects::JValue::Object(&j_mime);
    env.call_method(
        &intent,
        "setDataAndType",
        "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;",
        &[uri_value, mime_value],
    )
    .map_err(|e| e.to_string())?;
    env.call_method(
        &intent,
        "addFlags",
        "(I)Landroid/content/Intent;",
        &[jni::objects::JValue::Int(INTENT_FLAGS)],
    )
    .map_err(|e| e.to_string())?;
    env.call_method(
        &activity,
        "startActivity",
        "(Landroid/content/Intent;)V",
        &[jni::objects::JValue::Object(&intent)],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 交给系统 DownloadManager 下载 APK，返回任务 id（前端轮询用）
///
/// # Errors
/// 非 Android 平台或 JNI 失败时返回错误文案
#[tauri::command]
pub fn download_apk(url: String, title: String) -> Result<u64, String> {
    #[cfg(target_os = "android")]
    return enqueue(&url, &title);
    #[cfg(not(target_os = "android"))]
    {
        let _ = (url, title);
        Err("仅 Android 支持在线更新".into())
    }
}

/// 查询下载进度：`(status, bytes_so_far, total_bytes)`
///
/// # Errors
/// JNI 失败时返回错误文案
#[tauri::command]
pub fn apk_download_status(id: u64) -> Result<(String, i32, i32), String> {
    #[cfg(target_os = "android")]
    return query(id);
    #[cfg(not(target_os = "android"))]
    {
        let _ = id;
        Err("仅 Android 支持在线更新".into())
    }
}

/// 拉起系统安装界面（下载完成后调用）
///
/// # Errors
/// 下载未完成或系统拒绝安装意图时返回错误文案
#[tauri::command]
pub fn install_apk(id: u64) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return install(id);
    #[cfg(not(target_os = "android"))]
    {
        let _ = id;
        Err("仅 Android 支持在线更新".into())
    }
}
