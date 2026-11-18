package com.drivesync.mobile

import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.regex.Pattern

object DriveSyncConstants {
    const val MAX_UPLOAD_BYTES: Long = 4L * 1024L * 1024L * 1024L
    const val CONTROL_DIR = ".drivesync"
    const val QUARANTINE_DIR = ".DriveSync-Quarentena"
    const val JOIN_CODE_APP_PROP = "drivesyncJoinCode"
    const val FOLDER_KIND_APP_PROP = "drivesyncKind"
    const val GOOGLE_OAUTH_SCOPE =
        "https://www.googleapis.com/auth/drive openid email profile"
    private const val CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    private val random = SecureRandom()

    fun generateShortCode(): String {
        val sb = StringBuilder("DS-")
        for (i in 0 until 4) {
            sb.append(CODE_ALPHABET[random.nextInt(CODE_ALPHABET.length)])
        }
        sb.append('-')
        for (i in 0 until 4) {
            sb.append(CODE_ALPHABET[random.nextInt(CODE_ALPHABET.length)])
        }
        return sb.toString()
    }

    fun formatFullCode(remoteFolderId: String, shortCode: String): String {
        val normalized = if (shortCode.isNotBlank()) shortCode.trim().uppercase(Locale.US) else generateShortCode()
        return "DS1.${remoteFolderId.trim()}.$normalized"
    }

    fun nowIsoUtc(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }

    fun formatTimestampTag(): String {
        val fmt = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }
}

data class OAuthClientCredentials(
    val clientId: String,
    val clientSecret: String
)

data class RcloneParsedProfile(
    val remoteName: String,
    val clientId: String,
    val clientSecret: String,
    val rawTokenJson: String
)

data class StoredToken(
    val accessToken: String,
    val refreshToken: String,
    val expiryEpochMs: Long,
    val tokenType: String = "Bearer"
)

data class AccountInfo(
    val connected: Boolean,
    val email: String,
    val displayName: String,
    val authSource: String,
    val hasCustomOAuthClient: Boolean
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("connected", connected)
        put("email", email)
        put("displayName", displayName)
        put("authSource", authSource)
        put("hasCustomOAuthClient", hasCustomOAuthClient)
    }
}

data class MobileSettings(
    val deviceId: String,
    val deviceName: String,
    val maxUploadBytes: Long = DriveSyncConstants.MAX_UPLOAD_BYTES,
    val pollIntervalSeconds: Int = 900,
    val startOnBoot: Boolean = true,
    val minimizeToTray: Boolean = false,
    val enableWaybarBridge: Boolean = false,
    val defaultOnRemoteDelete: String = "keep_local",
    val wifiOnly: Boolean = true,
    val backgroundSyncEnabled: Boolean = true
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("deviceId", deviceId)
        put("deviceName", deviceName)
        put("maxUploadBytes", DriveSyncConstants.MAX_UPLOAD_BYTES)
        put("pollIntervalSeconds", pollIntervalSeconds.coerceIn(15, 3600))
        put("startOnBoot", startOnBoot)
        put("minimizeToTray", minimizeToTray)
        put("enableWaybarBridge", false)
        put("defaultOnRemoteDelete", if (defaultOnRemoteDelete == "mirror_trash") "mirror_trash" else "keep_local")
        put("wifiOnly", wifiOnly)
        put("backgroundSyncEnabled", backgroundSyncEnabled)
    }

    companion object {
        fun fromJson(obj: JSONObject, fallbackDeviceId: String, fallbackDeviceName: String): MobileSettings {
            return MobileSettings(
                deviceId = obj.optString("deviceId", fallbackDeviceId).ifBlank { fallbackDeviceId },
                deviceName = obj.optString("deviceName", fallbackDeviceName).ifBlank { fallbackDeviceName },
                maxUploadBytes = DriveSyncConstants.MAX_UPLOAD_BYTES,
                pollIntervalSeconds = obj.optInt("pollIntervalSeconds", 900).coerceIn(15, 3600),
                startOnBoot = obj.optBoolean("startOnBoot", true),
                minimizeToTray = obj.optBoolean("minimizeToTray", false),
                enableWaybarBridge = false,
                defaultOnRemoteDelete = if (obj.optString("defaultOnRemoteDelete") == "mirror_trash") "mirror_trash" else "keep_local",
                wifiOnly = obj.optBoolean("wifiOnly", true),
                backgroundSyncEnabled = obj.optBoolean("backgroundSyncEnabled", true)
            )
        }
    }
}

data class SenderRule(
    val email: String,
    val displayName: String = "",
    val allowed: Boolean = true
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("email", email)
        if (displayName.isNotBlank()) put("displayName", displayName)
        put("allowed", allowed)
    }

    companion object {
        fun fromJson(obj: JSONObject): SenderRule = SenderRule(
            email = obj.optString("email", "").trim().lowercase(Locale.US),
            displayName = obj.optString("displayName", ""),
            allowed = obj.optBoolean("allowed", true)
        )
    }
}

data class SenderPolicy(
    val mode: String = "all",
    val unknownSenderAction: String = "allow",
    val rules: List<SenderRule> = emptyList()
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("mode", mode)
        put("unknownSenderAction", unknownSenderAction)
        val arr = JSONArray()
        rules.forEach { arr.put(it.toJson()) }
        put("rules", arr)
    }

    companion object {
        fun fromJson(obj: JSONObject?): SenderPolicy {
            if (obj == null) return SenderPolicy()
            val mode = when (obj.optString("mode", "all")) {
                "blocklist", "allowlist" -> obj.optString("mode")
                else -> "all"
            }
            val unknown = if (obj.optString("unknownSenderAction", "allow") == "block") "block" else "allow"
            val arr = obj.optJSONArray("rules") ?: JSONArray()
            val rules = mutableListOf<SenderRule>()
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                val rule = SenderRule.fromJson(item)
                if (rule.email.isNotBlank()) rules.add(rule)
            }
            return SenderPolicy(mode = mode, unknownSenderAction = unknown, rules = rules)
        }
    }
}

data class SyncFolderConfig(
    val id: String,
    val name: String,
    val localPath: String,
    val remoteFolderId: String,
    val remoteFolderName: String,
    val kind: String,
    val direction: String,
    val onRemoteDelete: String,
    val onLocalDelete: String,
    val senderPolicy: SenderPolicy,
    val paused: Boolean,
    val shareCode: String = "",
    val createdAt: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("localPath", localPath)
        put("remoteFolderId", remoteFolderId)
        put("remoteFolderName", remoteFolderName)
        put("kind", kind)
        put("direction", direction)
        put("onRemoteDelete", onRemoteDelete)
        put("onLocalDelete", onLocalDelete)
        put("senderPolicy", senderPolicy.toJson())
        put("paused", paused)
        if (shareCode.isNotBlank()) put("shareCode", shareCode)
        put("createdAt", createdAt)
    }

    companion object {
        fun fromJson(obj: JSONObject): SyncFolderConfig = SyncFolderConfig(
            id = obj.optString("id", ""),
            name = obj.optString("name", ""),
            localPath = obj.optString("localPath", ""),
            remoteFolderId = obj.optString("remoteFolderId", ""),
            remoteFolderName = obj.optString("remoteFolderName", ""),
            kind = if (obj.optString("kind") == "master") "master" else "personal",
            direction = if (obj.optString("direction") == "receive_only") "receive_only" else "bidirectional",
            onRemoteDelete = if (obj.optString("onRemoteDelete") == "mirror_trash") "mirror_trash" else "keep_local",
            onLocalDelete = if (obj.optString("onLocalDelete") == "trash_remote") "trash_remote" else "ignore",
            senderPolicy = SenderPolicy.fromJson(obj.optJSONObject("senderPolicy")),
            paused = obj.optBoolean("paused", false),
            shareCode = obj.optString("shareCode", ""),
            createdAt = obj.optString("createdAt", DriveSyncConstants.nowIsoUtc())
        )
    }
}

data class FolderRuntimeState(
    val folderId: String,
    val status: String,
    val message: String,
    val lastSyncAt: String = "",
    val currentFile: String = "",
    val progressPercent: Int = 0,
    val bytesTransferred: Long = 0,
    val bytesTotal: Long = 0,
    val blocked4gbCount: Int = 0,
    val ignoredSenderCount: Int = 0,
    val keptLocalCount: Int = 0,
    val syncedFilesCount: Int = 0
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("folderId", folderId)
        put("status", status)
        put("message", message)
        if (lastSyncAt.isNotBlank()) put("lastSyncAt", lastSyncAt)
        if (currentFile.isNotBlank()) put("currentFile", currentFile)
        if (progressPercent > 0) put("progressPercent", progressPercent)
        if (bytesTransferred > 0) put("bytesTransferred", bytesTransferred)
        if (bytesTotal > 0) put("bytesTotal", bytesTotal)
        put("blocked4gbCount", blocked4gbCount)
        put("ignoredSenderCount", ignoredSenderCount)
        put("keptLocalCount", keptLocalCount)
        put("syncedFilesCount", syncedFilesCount)
    }
}

data class DeviceRegistration(
    val deviceId: String,
    val deviceName: String,
    val platform: String,
    val arch: String,
    val appVersion: String,
    val accountEmail: String,
    val syncMode: String,
    val folderId: String,
    val status: String,
    val lastSeenAt: String,
    val isCurrentDevice: Boolean = false
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("deviceId", deviceId)
        put("deviceName", deviceName)
        put("platform", platform)
        put("arch", arch)
        put("appVersion", appVersion)
        put("accountEmail", accountEmail)
        put("syncMode", syncMode)
        put("folderId", folderId)
        put("status", status)
        put("lastSeenAt", lastSeenAt)
        put("isCurrentDevice", isCurrentDevice)
    }
}

data class KnownSender(
    val folderId: String,
    val email: String,
    val displayName: String,
    val lastSeenAt: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("folderId", folderId)
        put("email", email)
        put("displayName", displayName)
        put("lastSeenAt", lastSeenAt)
    }
}

data class BlockedFileEntry(
    val id: Long,
    val folderId: String,
    val folderName: String,
    val relativePath: String,
    val localPath: String = "",
    val fileSizeBytes: Long,
    val authorEmail: String = "",
    val authorName: String = "",
    val reason: String,
    val detail: String,
    val detectedAt: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("folderId", folderId)
        put("folderName", folderName)
        put("relativePath", relativePath)
        if (localPath.isNotBlank()) put("localPath", localPath)
        put("fileSizeBytes", fileSizeBytes)
        if (authorEmail.isNotBlank()) put("authorEmail", authorEmail)
        if (authorName.isNotBlank()) put("authorName", authorName)
        put("reason", reason)
        put("detail", detail)
        put("detectedAt", detectedAt)
    }
}

data class ActivityEvent(
    val id: Long,
    val folderId: String,
    val folderName: String,
    val kind: String,
    val level: String,
    val message: String,
    val relativePath: String = "",
    val authorEmail: String = "",
    val fileSizeBytes: Long = 0,
    val createdAt: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("folderId", folderId)
        put("folderName", folderName)
        put("kind", kind)
        put("level", level)
        put("message", message)
        if (relativePath.isNotBlank()) put("relativePath", relativePath)
        if (authorEmail.isNotBlank()) put("authorEmail", authorEmail)
        if (fileSizeBytes > 0) put("fileSizeBytes", fileSizeBytes)
        put("createdAt", createdAt)
    }
}

data class RemoteFolderItem(
    val id: String,
    val name: String,
    val shared: Boolean,
    val ownerEmail: String = "",
    val ownerName: String = "",
    val canWrite: Boolean = true,
    val joinCode: String = "",
    val kind: String = ""
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("shared", shared)
        if (ownerEmail.isNotBlank()) put("ownerEmail", ownerEmail)
        if (ownerName.isNotBlank()) put("ownerName", ownerName)
        put("canWrite", canWrite)
    }
}

data class ParsedJoinInput(
    val remoteFolderId: String = "",
    val shortCode: String = "",
    val matchedBy: String = ""
)

data class SyncedFileRow(
    val folderId: String,
    val relativePath: String,
    val remoteFileId: String = "",
    val localUri: String = "",
    val localSize: Long = 0L,
    val localMtimeMs: Long = 0L,
    val localHash: String = "",
    val remoteSize: Long = 0L,
    val remoteModifiedAt: String = "",
    val remoteMd5: String = "",
    val lastAction: String = "",
    val deletedOnRemote: Boolean = false,
    val keptLocalHash: String = "",
    val keptLocalMtimeMs: Long = 0L,
    val ignoredLocalDelete: Boolean = false
)

object SyncRules {
    private val fullCodePattern = Pattern.compile("^DS1\\.([A-Za-z0-9_-]{8,})\\.([A-Za-z0-9-]+)$", Pattern.CASE_INSENSITIVE)
    private val shortCodePattern = Pattern.compile("^DS-[A-Z0-9]{4}-[A-Z0-9]{4}$", Pattern.CASE_INSENSITIVE)
    private val driveFolderUrlPattern = Pattern.compile("folders/([A-Za-z0-9_-]{8,})")
    private val driveIdParamPattern = Pattern.compile("[?&]id=([A-Za-z0-9_-]{8,})")
    private val rawIdPattern = Pattern.compile("^[A-Za-z0-9_-]{12,}$")

    fun exceedsUploadLimit(sizeBytes: Long): Boolean = sizeBytes > DriveSyncConstants.MAX_UPLOAD_BYTES

    fun shouldIgnoreRelativePath(relativePath: String): Boolean {
        val cleaned = relativePath.replace('\\', '/').trim('/')
        if (cleaned.isEmpty()) return true
        val segments = cleaned.split('/')
        for (seg in segments) {
            if (seg.isEmpty()) continue
            if (seg == ".git" ||
                seg == "node_modules" ||
                seg == DriveSyncConstants.CONTROL_DIR ||
                seg == DriveSyncConstants.QUARANTINE_DIR ||
                seg == ".Trash" ||
                seg.startsWith(".Trash-")
            ) {
                return true
            }
        }
        val base = segments.last()
        return base == ".DS_Store" ||
            base == "Thumbs.db" ||
            base == "desktop.ini" ||
            base == ".rclone-tmp" ||
            base.startsWith("~") ||
            base.endsWith(".part") ||
            base.endsWith(".crdownload") ||
            base.endsWith(".tmp")
    }

    fun isSenderAllowed(policy: SenderPolicy, email: String): Boolean {
        val normalized = email.trim().lowercase(Locale.US)
        if (policy.mode == "all") return true
        val explicit = policy.rules.firstOrNull { it.email.trim().lowercase(Locale.US) == normalized }
        if (explicit != null) {
            return explicit.allowed
        }
        return when (policy.mode) {
            "allowlist" -> false
            "blocklist" -> policy.unknownSenderAction != "block"
            else -> true
        }
    }

    fun parseJoinInput(rawInput: String): ParsedJoinInput {
        val trimmed = rawInput.trim()
        if (trimmed.isEmpty()) {
            throw IllegalArgumentException("Informe o código DS1/DS-XXXX-XXXX ou o link da pasta do Google Drive.")
        }

        val fullMatcher = fullCodePattern.matcher(trimmed)
        if (fullMatcher.matches()) {
            return ParsedJoinInput(
                remoteFolderId = fullMatcher.group(1) ?: "",
                shortCode = (fullMatcher.group(2) ?: "").uppercase(Locale.US),
                matchedBy = "full_code"
            )
        }

        val urlMatcher = driveFolderUrlPattern.matcher(trimmed)
        if (urlMatcher.find()) {
            return ParsedJoinInput(
                remoteFolderId = urlMatcher.group(1) ?: "",
                shortCode = "",
                matchedBy = "drive_link"
            )
        }

        val paramMatcher = driveIdParamPattern.matcher(trimmed)
        if (paramMatcher.find()) {
            return ParsedJoinInput(
                remoteFolderId = paramMatcher.group(1) ?: "",
                shortCode = "",
                matchedBy = "drive_link"
            )
        }

        if (shortCodePattern.matcher(trimmed).matches()) {
            return ParsedJoinInput(
                remoteFolderId = "",
                shortCode = trimmed.uppercase(Locale.US),
                matchedBy = "short_code"
            )
        }

        if (!trimmed.startsWith("http") && rawIdPattern.matcher(trimmed).matches()) {
            return ParsedJoinInput(
                remoteFolderId = trimmed,
                shortCode = "",
                matchedBy = "drive_link"
            )
        }

        throw IllegalArgumentException("Código ou link não reconhecido. Use DS1.<ID>.<DS-XXXX-XXXX>, DS-XXXX-XXXX ou o link do Google Drive.")
    }

    fun parseGoogleCredentialsJson(rawJson: String): OAuthClientCredentials {
        val root = JSONObject(rawJson)
        val obj = when {
            root.has("installed") -> root.getJSONObject("installed")
            root.has("web") -> root.getJSONObject("web")
            else -> root
        }
        val clientId = obj.optString("client_id", "").trim()
        val clientSecret = obj.optString("client_secret", "").trim()
        if (clientId.isEmpty()) {
            throw IllegalArgumentException("Arquivo credentials.json sem campo client_id válido.")
        }
        return OAuthClientCredentials(clientId = clientId, clientSecret = clientSecret)
    }

    fun parseRcloneConf(rawConf: String, preferredRemote: String = ""): RcloneParsedProfile {
        val sections = linkedMapOf<String, MutableMap<String, String>>()
        var current = ""
        for (rawLine in rawConf.lineSequence()) {
            val line = rawLine.trim()
            if (line.isEmpty() || line.startsWith("#") || line.startsWith(";")) continue
            if (line.startsWith("[") && line.endsWith("]") && line.length > 2) {
                current = line.substring(1, line.length - 1).trim()
                sections.getOrPut(current) { linkedMapOf() }
                continue
            }
            if (current.isEmpty()) continue
            val eqIdx = line.indexOf('=')
            if (eqIdx > 0) {
                val key = line.substring(0, eqIdx).trim()
                val value = line.substring(eqIdx + 1).trim()
                sections[current]?.put(key, value)
            }
        }

        val cleanPreferred = preferredRemote.trim().removeSuffix(":")
        val chosenName = when {
            cleanPreferred.isNotEmpty() && sections.containsKey(cleanPreferred) -> cleanPreferred
            cleanPreferred.isNotEmpty() -> throw IllegalArgumentException("Perfil '[$cleanPreferred]' não encontrado no rclone.conf.")
            sections.containsKey("gdrive") -> "gdrive"
            else -> sections.entries.firstOrNull { it.value["type"] == "drive" }?.key
                ?: sections.keys.firstOrNull()
                ?: throw IllegalArgumentException("Nenhuma seção [nome] encontrada no rclone.conf.")
        }

        val entry = sections[chosenName]
            ?: throw IllegalArgumentException("Perfil '[$chosenName]' não encontrado no rclone.conf.")
        val remoteType = entry["type"].orEmpty().trim()
        if (remoteType.isNotEmpty() && remoteType != "drive") {
            throw IllegalArgumentException("Perfil '$chosenName' não é do tipo Google Drive (type=$remoteType).")
        }

        val clientId = entry["client_id"].orEmpty().trim()
        val clientSecret = entry["client_secret"].orEmpty().trim()
        val rawTokenJson = entry["token"].orEmpty().trim()
        if (clientId.isEmpty()) {
            throw IllegalArgumentException("O perfil '[$chosenName]' não possui client_id próprio no rclone.conf.")
        }

        return RcloneParsedProfile(
            remoteName = chosenName,
            clientId = clientId,
            clientSecret = clientSecret,
            rawTokenJson = rawTokenJson
        )
    }
}
