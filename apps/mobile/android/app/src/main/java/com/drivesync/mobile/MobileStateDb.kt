package com.drivesync.mobile

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class MobileStateDb(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

    companion object {
        private const val DB_NAME = "drivesync_mobile.db"
        private const val DB_VERSION = 1

        private const val KV_OAUTH_CLIENT = "oauth_client"
        private const val KV_OAUTH_TOKEN = "oauth_token"
        private const val KV_ACCOUNT_INFO = "account_info"
        private const val KV_SETTINGS = "mobile_settings"
    }

    @Volatile
    private var liveRuntime: MutableMap<String, FolderRuntimeState> = mutableMapOf()

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS kv_store (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS sync_folders (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              local_path TEXT NOT NULL,
              remote_folder_id TEXT NOT NULL,
              remote_folder_name TEXT NOT NULL,
              kind TEXT NOT NULL,
              direction TEXT NOT NULL,
              on_remote_delete TEXT NOT NULL,
              on_local_delete TEXT NOT NULL,
              sender_policy_json TEXT NOT NULL,
              paused INTEGER NOT NULL DEFAULT 0,
              share_code TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS synced_files (
              folder_id TEXT NOT NULL,
              relative_path TEXT NOT NULL,
              remote_file_id TEXT NOT NULL DEFAULT '',
              local_uri TEXT NOT NULL DEFAULT '',
              local_size INTEGER NOT NULL DEFAULT 0,
              local_mtime_ms INTEGER NOT NULL DEFAULT 0,
              local_hash TEXT NOT NULL DEFAULT '',
              remote_size INTEGER NOT NULL DEFAULT 0,
              remote_modified_at TEXT NOT NULL DEFAULT '',
              remote_md5 TEXT NOT NULL DEFAULT '',
              last_action TEXT NOT NULL DEFAULT '',
              deleted_on_remote INTEGER NOT NULL DEFAULT 0,
              kept_local_hash TEXT NOT NULL DEFAULT '',
              kept_local_mtime_ms INTEGER NOT NULL DEFAULT 0,
              ignored_local_delete INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (folder_id, relative_path)
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS known_senders (
              folder_id TEXT NOT NULL,
              email TEXT NOT NULL,
              display_name TEXT NOT NULL DEFAULT '',
              last_seen_at TEXT NOT NULL,
              PRIMARY KEY (folder_id, email)
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS blocked_files (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              folder_id TEXT NOT NULL,
              folder_name TEXT NOT NULL,
              relative_path TEXT NOT NULL,
              local_path TEXT NOT NULL DEFAULT '',
              file_size_bytes INTEGER NOT NULL DEFAULT 0,
              author_email TEXT NOT NULL DEFAULT '',
              author_name TEXT NOT NULL DEFAULT '',
              reason TEXT NOT NULL,
              detail TEXT NOT NULL,
              detected_at TEXT NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS activity_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              folder_id TEXT NOT NULL,
              folder_name TEXT NOT NULL,
              kind TEXT NOT NULL,
              level TEXT NOT NULL,
              message TEXT NOT NULL,
              relative_path TEXT NOT NULL DEFAULT '',
              author_email TEXT NOT NULL DEFAULT '',
              file_size_bytes INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS devices (
              folder_id TEXT NOT NULL,
              device_id TEXT NOT NULL,
              device_name TEXT NOT NULL,
              platform TEXT NOT NULL,
              arch TEXT NOT NULL,
              app_version TEXT NOT NULL,
              account_email TEXT NOT NULL,
              sync_mode TEXT NOT NULL,
              status TEXT NOT NULL,
              last_seen_at TEXT NOT NULL,
              PRIMARY KEY (folder_id, device_id)
            )
            """.trimIndent()
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    private fun getKv(key: String): String? {
        readableDatabase.rawQuery("SELECT value FROM kv_store WHERE key = ?", arrayOf(key)).use { c ->
            return if (c.moveToFirst()) c.getString(0) else null
        }
    }

    @Synchronized
    private fun setKv(key: String, value: String) {
        val cv = ContentValues().apply {
            put("key", key)
            put("value", value)
        }
        writableDatabase.insertWithOnConflict("kv_store", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    private fun deleteKv(key: String) {
        writableDatabase.delete("kv_store", "key = ?", arrayOf(key))
    }

    @Synchronized
    fun getSettings(): MobileSettings {
        val defaultName = (Build.MODEL ?: "Meu Celular Android").ifBlank { "Meu Celular Android" }
        val raw = getKv(KV_SETTINGS)
        if (raw == null) {
            val fresh = MobileSettings(
                deviceId = "android-" + UUID.randomUUID().toString().take(8),
                deviceName = defaultName
            )
            setKv(KV_SETTINGS, fresh.toJson().toString())
            return fresh
        }
        return runCatching {
            val parsed = MobileSettings.fromJson(JSONObject(raw), "android-1", defaultName)
            parsed
        }.getOrElse {
            MobileSettings(deviceId = "android-" + UUID.randomUUID().toString().take(8), deviceName = defaultName)
        }
    }

    @Synchronized
    fun saveSettings(settings: MobileSettings): MobileSettings {
        val current = getSettings()
        val merged = settings.copy(
            deviceId = current.deviceId,
            maxUploadBytes = DriveSyncConstants.MAX_UPLOAD_BYTES,
            enableWaybarBridge = false
        )
        setKv(KV_SETTINGS, merged.toJson().toString())
        return merged
    }

    @Synchronized
    fun getCustomOAuthClient(): OAuthClientCredentials? {
        val raw = getKv(KV_OAUTH_CLIENT) ?: return null
        return runCatching {
            val obj = JSONObject(raw)
            val id = obj.optString("clientId", "").trim()
            val secret = obj.optString("clientSecret", "").trim()
            if (id.isBlank()) null else OAuthClientCredentials(id, secret)
        }.getOrNull()
    }

    @Synchronized
    fun getEffectiveOAuthClient(): OAuthClientCredentials? {
        val custom = getCustomOAuthClient()
        if (custom != null && custom.clientId.isNotBlank()) return custom
        val builtInId = BuildConfig.DEFAULT_GOOGLE_CLIENT_ID.trim()
        val builtInSecret = BuildConfig.DEFAULT_GOOGLE_CLIENT_SECRET.trim()
        if (builtInId.isNotBlank()) {
            return OAuthClientCredentials(builtInId, builtInSecret)
        }
        return null
    }

    @Synchronized
    fun saveCustomOAuthClient(creds: OAuthClientCredentials) {
        val obj = JSONObject().apply {
            put("clientId", creds.clientId.trim())
            put("clientSecret", creds.clientSecret.trim())
        }
        setKv(KV_OAUTH_CLIENT, obj.toString())
    }

    @Synchronized
    fun getToken(): StoredToken? {
        val raw = getKv(KV_OAUTH_TOKEN) ?: return null
        return runCatching {
            val obj = JSONObject(raw)
            val access = obj.optString("accessToken", "")
            val refresh = obj.optString("refreshToken", "")
            if (access.isBlank() && refresh.isBlank()) null else StoredToken(
                accessToken = access,
                refreshToken = refresh,
                expiryEpochMs = obj.optLong("expiryEpochMs", 0L),
                tokenType = obj.optString("tokenType", "Bearer")
            )
        }.getOrNull()
    }

    @Synchronized
    fun saveToken(token: StoredToken) {
        val obj = JSONObject().apply {
            put("accessToken", token.accessToken)
            put("refreshToken", token.refreshToken)
            put("expiryEpochMs", token.expiryEpochMs)
            put("tokenType", token.tokenType)
        }
        setKv(KV_OAUTH_TOKEN, obj.toString())
    }

    @Synchronized
    fun saveAccountProfile(email: String, displayName: String) {
        val obj = JSONObject().apply {
            put("email", email)
            put("displayName", displayName)
        }
        setKv(KV_ACCOUNT_INFO, obj.toString())
    }

    @Synchronized
    fun getAccountInfo(): AccountInfo {
        val token = getToken()
        val effective = getEffectiveOAuthClient()
        val rawProfile = getKv(KV_ACCOUNT_INFO)
        var email = ""
        var displayName = ""
        if (rawProfile != null) {
            runCatching {
                val obj = JSONObject(rawProfile)
                email = obj.optString("email", "")
                displayName = obj.optString("displayName", "")
            }
        }
        val connected = token != null && (token.refreshToken.isNotBlank() || token.accessToken.isNotBlank())
        return AccountInfo(
            connected = connected,
            email = if (connected) email else "",
            displayName = if (connected) displayName else "",
            authSource = if (connected) "oauth_pkce" else "none",
            hasCustomOAuthClient = effective != null
        )
    }

    @Synchronized
    fun clearAccount() {
        deleteKv(KV_OAUTH_TOKEN)
        deleteKv(KV_ACCOUNT_INFO)
    }

    @Synchronized
    fun listFolders(): List<SyncFolderConfig> {
        val result = mutableListOf<SyncFolderConfig>()
        readableDatabase.rawQuery(
            """
            SELECT id, name, local_path, remote_folder_id, remote_folder_name, kind, direction,
                   on_remote_delete, on_local_delete, sender_policy_json, paused, share_code, created_at
            FROM sync_folders ORDER BY created_at ASC
            """.trimIndent(),
            null
        ).use { c ->
            while (c.moveToNext()) {
                val policyObj = runCatching { JSONObject(c.getString(9)) }.getOrNull()
                result.add(
                    SyncFolderConfig(
                        id = c.getString(0),
                        name = c.getString(1),
                        localPath = c.getString(2),
                        remoteFolderId = c.getString(3),
                        remoteFolderName = c.getString(4),
                        kind = c.getString(5),
                        direction = c.getString(6),
                        onRemoteDelete = c.getString(7),
                        onLocalDelete = c.getString(8),
                        senderPolicy = SenderPolicy.fromJson(policyObj),
                        paused = c.getInt(10) != 0,
                        shareCode = c.getString(11),
                        createdAt = c.getString(12)
                    )
                )
            }
        }
        return result
    }

    @Synchronized
    fun getFolder(folderId: String): SyncFolderConfig? = listFolders().firstOrNull { it.id == folderId }

    @Synchronized
    fun upsertFolder(folder: SyncFolderConfig): SyncFolderConfig {
        val normalized = if (folder.id.isBlank()) {
            folder.copy(id = "fld-" + UUID.randomUUID().toString().take(8), createdAt = DriveSyncConstants.nowIsoUtc())
        } else {
            folder
        }
        val cv = ContentValues().apply {
            put("id", normalized.id)
            put("name", normalized.name)
            put("local_path", normalized.localPath)
            put("remote_folder_id", normalized.remoteFolderId)
            put("remote_folder_name", normalized.remoteFolderName)
            put("kind", normalized.kind)
            put("direction", normalized.direction)
            put("on_remote_delete", normalized.onRemoteDelete)
            put("on_local_delete", normalized.onLocalDelete)
            put("sender_policy_json", normalized.senderPolicy.toJson().toString())
            put("paused", if (normalized.paused) 1 else 0)
            put("share_code", normalized.shareCode)
            put("created_at", normalized.createdAt)
        }
        writableDatabase.insertWithOnConflict("sync_folders", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
        return normalized
    }

    @Synchronized
    fun deleteFolder(folderId: String) {
        writableDatabase.delete("sync_folders", "id = ?", arrayOf(folderId))
        writableDatabase.delete("synced_files", "folder_id = ?", arrayOf(folderId))
        writableDatabase.delete("known_senders", "folder_id = ?", arrayOf(folderId))
        writableDatabase.delete("blocked_files", "folder_id = ?", arrayOf(folderId))
        writableDatabase.delete("devices", "folder_id = ?", arrayOf(folderId))
        liveRuntime.remove(folderId)
    }

    @Synchronized
    fun forgetDevice(folderId: String, deviceId: String) {
        writableDatabase.delete(
            "devices",
            "folder_id = ? AND device_id = ?",
            arrayOf(folderId, deviceId)
        )
    }

    @Synchronized
    fun listSyncedFiles(folderId: String): Map<String, SyncedFileRow> {
        val out = mutableMapOf<String, SyncedFileRow>()
        readableDatabase.rawQuery(
            """
            SELECT relative_path, remote_file_id, local_uri, local_size, local_mtime_ms, local_hash,
                   remote_size, remote_modified_at, remote_md5, last_action, deleted_on_remote,
                   kept_local_hash, kept_local_mtime_ms, ignored_local_delete
            FROM synced_files WHERE folder_id = ?
            """.trimIndent(),
            arrayOf(folderId)
        ).use { c ->
            while (c.moveToNext()) {
                val rel = c.getString(0)
                out[rel] = SyncedFileRow(
                    folderId = folderId,
                    relativePath = rel,
                    remoteFileId = c.getString(1),
                    localUri = c.getString(2),
                    localSize = c.getLong(3),
                    localMtimeMs = c.getLong(4),
                    localHash = c.getString(5),
                    remoteSize = c.getLong(6),
                    remoteModifiedAt = c.getString(7),
                    remoteMd5 = c.getString(8),
                    lastAction = c.getString(9),
                    deletedOnRemote = c.getInt(10) != 0,
                    keptLocalHash = c.getString(11),
                    keptLocalMtimeMs = c.getLong(12),
                    ignoredLocalDelete = c.getInt(13) != 0
                )
            }
        }
        return out
    }

    @Synchronized
    fun upsertSyncedFile(row: SyncedFileRow) {
        val cv = ContentValues().apply {
            put("folder_id", row.folderId)
            put("relative_path", row.relativePath)
            put("remote_file_id", row.remoteFileId)
            put("local_uri", row.localUri)
            put("local_size", row.localSize)
            put("local_mtime_ms", row.localMtimeMs)
            put("local_hash", row.localHash)
            put("remote_size", row.remoteSize)
            put("remote_modified_at", row.remoteModifiedAt)
            put("remote_md5", row.remoteMd5)
            put("last_action", row.lastAction)
            put("deleted_on_remote", if (row.deletedOnRemote) 1 else 0)
            put("kept_local_hash", row.keptLocalHash)
            put("kept_local_mtime_ms", row.keptLocalMtimeMs)
            put("ignored_local_delete", if (row.ignoredLocalDelete) 1 else 0)
        }
        writableDatabase.insertWithOnConflict("synced_files", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun deleteSyncedFile(folderId: String, relativePath: String) {
        writableDatabase.delete("synced_files", "folder_id = ? AND relative_path = ?", arrayOf(folderId, relativePath))
    }

    @Synchronized
    fun upsertKnownSender(folderId: String, email: String, displayName: String) {
        val norm = email.trim().lowercase()
        if (norm.isBlank()) return
        val cv = ContentValues().apply {
            put("folder_id", folderId)
            put("email", norm)
            put("display_name", displayName.ifBlank { norm })
            put("last_seen_at", DriveSyncConstants.nowIsoUtc())
        }
        writableDatabase.insertWithOnConflict("known_senders", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun recordBlockedFile(
        folderId: String,
        folderName: String,
        relativePath: String,
        localPath: String = "",
        fileSizeBytes: Long,
        authorEmail: String,
        authorName: String,
        reason: String,
        detail: String
    ) {
        writableDatabase.delete(
            "blocked_files",
            "folder_id = ? AND relative_path = ? AND reason = ?",
            arrayOf(folderId, relativePath, reason)
        )
        val cv = ContentValues().apply {
            put("folder_id", folderId)
            put("folder_name", folderName)
            put("relative_path", relativePath)
            put("local_path", localPath)
            put("file_size_bytes", fileSizeBytes)
            put("author_email", authorEmail)
            put("author_name", authorName)
            put("reason", reason)
            put("detail", detail)
            put("detected_at", DriveSyncConstants.nowIsoUtc())
        }
        writableDatabase.insert("blocked_files", null, cv)
    }

    @Synchronized
    fun clearBlockedFile(folderId: String, relativePath: String) {
        writableDatabase.delete("blocked_files", "folder_id = ? AND relative_path = ?", arrayOf(folderId, relativePath))
    }

    @Synchronized
    fun recordActivity(
        folderId: String,
        folderName: String,
        kind: String,
        level: String,
        message: String,
        relativePath: String = "",
        authorEmail: String = "",
        fileSizeBytes: Long = 0
    ) {
        val cv = ContentValues().apply {
            put("folder_id", folderId)
            put("folder_name", folderName)
            put("kind", kind)
            put("level", level)
            put("message", message)
            put("relative_path", relativePath)
            put("author_email", authorEmail)
            put("file_size_bytes", fileSizeBytes)
            put("created_at", DriveSyncConstants.nowIsoUtc())
        }
        writableDatabase.insert("activity_log", null, cv)
        writableDatabase.execSQL(
            "DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 250)"
        )
    }

    @Synchronized
    fun replaceRemoteDevicesForFolder(folderId: String, list: List<DeviceRegistration>) {
        writableDatabase.delete("devices", "folder_id = ?", arrayOf(folderId))
        for (dev in list) {
            val cv = ContentValues().apply {
                put("folder_id", folderId)
                put("device_id", dev.deviceId)
                put("device_name", dev.deviceName)
                put("platform", dev.platform)
                put("arch", dev.arch)
                put("app_version", dev.appVersion)
                put("account_email", dev.accountEmail)
                put("sync_mode", dev.syncMode)
                put("status", dev.status)
                put("last_seen_at", dev.lastSeenAt)
            }
            writableDatabase.insertWithOnConflict("devices", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
        }
    }

    fun updateRuntime(state: FolderRuntimeState) {
        liveRuntime[state.folderId] = state
    }

    @Synchronized
    fun buildRuntimeState(folder: SyncFolderConfig): FolderRuntimeState {
        val current = liveRuntime[folder.id]
        var syncedCount = 0
        var keptLocalCount = 0
        readableDatabase.rawQuery(
            "SELECT deleted_on_remote, last_action FROM synced_files WHERE folder_id = ?",
            arrayOf(folder.id)
        ).use { c ->
            while (c.moveToNext()) {
                val deletedRemote = c.getInt(0) != 0
                val action = c.getString(1)
                if (deletedRemote || action == "kept_local") {
                    keptLocalCount++
                }
                if (action != "blocked_sender" && action != "blocked_4gb" && action != "trashed_local") {
                    syncedCount++
                }
            }
        }
        var blocked4gb = 0
        var blockedSender = 0
        readableDatabase.rawQuery(
            "SELECT reason FROM blocked_files WHERE folder_id = ?",
            arrayOf(folder.id)
        ).use { c ->
            while (c.moveToNext()) {
                when (c.getString(0)) {
                    "exceeds_4gb" -> blocked4gb++
                    "sender_blocked" -> blockedSender++
                }
            }
        }
        val status = when {
            folder.paused -> "paused"
            current != null -> current.status
            else -> "idle"
        }
        val message = when {
            folder.paused -> "Sincronização pausada pelo usuário"
            current != null -> current.message
            else -> "Aguardando sincronização"
        }
        return FolderRuntimeState(
            folderId = folder.id,
            status = status,
            message = message,
            lastSyncAt = current?.lastSyncAt ?: "",
            currentFile = current?.currentFile ?: "",
            progressPercent = current?.progressPercent ?: 0,
            bytesTransferred = current?.bytesTransferred ?: 0L,
            bytesTotal = current?.bytesTotal ?: 0L,
            blocked4gbCount = blocked4gb,
            ignoredSenderCount = blockedSender,
            keptLocalCount = keptLocalCount,
            syncedFilesCount = syncedCount
        )
    }

    @Synchronized
    fun getSnapshotJson(): JSONObject {
        val account = getAccountInfo()
        val settings = getSettings()
        val folders = listFolders()

        val foldersArr = JSONArray()
        val runtimeObj = JSONObject()
        for (folder in folders) {
            foldersArr.put(folder.toJson())
            runtimeObj.put(folder.id, buildRuntimeState(folder).toJson())
        }

        val devicesArr = JSONArray()
        val seenDeviceKeys = mutableSetOf<String>()
        readableDatabase.rawQuery(
            """
            SELECT folder_id, device_id, device_name, platform, arch, app_version,
                   account_email, sync_mode, status, last_seen_at
            FROM devices ORDER BY last_seen_at DESC
            """.trimIndent(),
            null
        ).use { c ->
            while (c.moveToNext()) {
                val fid = c.getString(0)
                val did = c.getString(1)
                seenDeviceKeys.add("$fid::$did")
                devicesArr.put(
                    DeviceRegistration(
                        deviceId = did,
                        deviceName = c.getString(2),
                        platform = c.getString(3),
                        arch = c.getString(4),
                        appVersion = c.getString(5),
                        accountEmail = c.getString(6),
                        syncMode = c.getString(7),
                        folderId = fid,
                        status = c.getString(8),
                        lastSeenAt = c.getString(9),
                        isCurrentDevice = did == settings.deviceId
                    ).toJson()
                )
            }
        }
        if (folders.isEmpty() || seenDeviceKeys.none { it.endsWith("::${settings.deviceId}") }) {
            devicesArr.put(
                DeviceRegistration(
                    deviceId = settings.deviceId,
                    deviceName = settings.deviceName,
                    platform = "android",
                    arch = Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64",
                    appVersion = "0.1.0",
                    accountEmail = account.email,
                    syncMode = "bidirectional",
                    folderId = folders.firstOrNull()?.id ?: "local",
                    status = if (account.connected) "online" else "paused",
                    lastSeenAt = DriveSyncConstants.nowIsoUtc(),
                    isCurrentDevice = true
                ).toJson()
            )
        }

        val sendersArr = JSONArray()
        readableDatabase.rawQuery(
            "SELECT folder_id, email, display_name, last_seen_at FROM known_senders ORDER BY last_seen_at DESC",
            null
        ).use { c ->
            while (c.moveToNext()) {
                sendersArr.put(
                    KnownSender(
                        folderId = c.getString(0),
                        email = c.getString(1),
                        displayName = c.getString(2),
                        lastSeenAt = c.getString(3)
                    ).toJson()
                )
            }
        }

        val blockedArr = JSONArray()
        readableDatabase.rawQuery(
            """
            SELECT id, folder_id, folder_name, relative_path, local_path, file_size_bytes,
                   author_email, author_name, reason, detail, detected_at
            FROM blocked_files ORDER BY id DESC LIMIT 100
            """.trimIndent(),
            null
        ).use { c ->
            while (c.moveToNext()) {
                blockedArr.put(
                    BlockedFileEntry(
                        id = c.getLong(0),
                        folderId = c.getString(1),
                        folderName = c.getString(2),
                        relativePath = c.getString(3),
                        localPath = c.getString(4),
                        fileSizeBytes = c.getLong(5),
                        authorEmail = c.getString(6),
                        authorName = c.getString(7),
                        reason = c.getString(8),
                        detail = c.getString(9),
                        detectedAt = c.getString(10)
                    ).toJson()
                )
            }
        }

        val activityArr = JSONArray()
        readableDatabase.rawQuery(
            """
            SELECT id, folder_id, folder_name, kind, level, message, relative_path,
                   author_email, file_size_bytes, created_at
            FROM activity_log ORDER BY id DESC LIMIT 100
            """.trimIndent(),
            null
        ).use { c ->
            while (c.moveToNext()) {
                activityArr.put(
                    ActivityEvent(
                        id = c.getLong(0),
                        folderId = c.getString(1),
                        folderName = c.getString(2),
                        kind = c.getString(3),
                        level = c.getString(4),
                        message = c.getString(5),
                        relativePath = c.getString(6),
                        authorEmail = c.getString(7),
                        fileSizeBytes = c.getLong(8),
                        createdAt = c.getString(9)
                    ).toJson()
                )
            }
        }

        return JSONObject().apply {
            put("account", account.toJson())
            put("settings", settings.toJson())
            put("folders", foldersArr)
            put("runtime", runtimeObj)
            put("devices", devicesArr)
            put("knownSenders", sendersArr)
            put("blockedFiles", blockedArr)
            put("recentActivity", activityArr)
        }
    }
}
