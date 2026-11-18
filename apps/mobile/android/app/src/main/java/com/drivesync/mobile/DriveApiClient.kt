package com.drivesync.mobile

import android.content.Context
import android.net.ConnectivityManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.ProtocolException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets

data class DriveRemoteFile(
    val id: String,
    val name: String,
    val relativePath: String,
    val sizeBytes: Long,
    val md5Checksum: String,
    val modifiedTime: String,
    val mimeType: String,
    val trashed: Boolean,
    val authorEmail: String,
    val authorName: String
)

class DriveApiException(val statusCode: Int, message: String) : Exception(message)

class DriveApiClient(
    private val db: MobileStateDb,
    private val context: Context? = null
) {

    companion object {
        private const val DRIVE_API = "https://www.googleapis.com/drive/v3"
        private const val UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"
        private const val TOKEN_URL = "https://oauth2.googleapis.com/token"
        private const val TOKEN_URL_FALLBACK = "https://accounts.google.com/o/oauth2/token"
        private const val CHUNK_SIZE = 4 * 1024 * 1024 // 4 MiB (multiple of 256 KiB required by Google Drive)
        private val RETRY_DELAYS_MS = longArrayOf(0L, 450L, 800L, 1200L, 1600L)
    }

    fun exchangeOAuthCode(
        creds: OAuthClientCredentials,
        code: String,
        redirectUri: String,
        codeVerifier: String = ""
    ): StoredToken {
        val params = linkedMapOf(
            "code" to code,
            "client_id" to creds.clientId,
            "redirect_uri" to redirectUri,
            "grant_type" to "authorization_code"
        )
        if (creds.clientSecret.isNotBlank()) {
            params["client_secret"] = creds.clientSecret
        }
        if (codeVerifier.isNotBlank()) {
            params["code_verifier"] = codeVerifier
        }
        val body = formEncode(params)
        val obj = postTokenForm(body)
        val expiresIn = obj.optLong("expires_in", 3600L)
        return StoredToken(
            accessToken = obj.getString("access_token"),
            refreshToken = obj.optString("refresh_token", ""),
            expiryEpochMs = System.currentTimeMillis() + expiresIn * 1000L,
            tokenType = obj.optString("token_type", "Bearer")
        )
    }

    @Synchronized
    fun ensureAccessToken(): String {
        val token = db.getToken() ?: throw IllegalStateException("Conta Google Drive não conectada.")
        if (token.accessToken.isNotBlank() && token.expiryEpochMs > System.currentTimeMillis() + 60_000L) {
            return token.accessToken
        }
        if (token.refreshToken.isBlank()) {
            if (token.accessToken.isNotBlank()) return token.accessToken
            throw IllegalStateException("Sessão expirada. Conecte sua conta Google novamente.")
        }
        val creds = db.getEffectiveOAuthClient()
            ?: throw IllegalStateException("Client OAuth Google não configurado.")
        val params = linkedMapOf(
            "client_id" to creds.clientId,
            "refresh_token" to token.refreshToken,
            "grant_type" to "refresh_token"
        )
        if (creds.clientSecret.isNotBlank()) {
            params["client_secret"] = creds.clientSecret
        }
        val obj = postTokenForm(formEncode(params))
        val expiresIn = obj.optLong("expires_in", 3600L)
        val refreshed = StoredToken(
            accessToken = obj.getString("access_token"),
            refreshToken = obj.optString("refresh_token", token.refreshToken).ifBlank { token.refreshToken },
            expiryEpochMs = System.currentTimeMillis() + expiresIn * 1000L,
            tokenType = obj.optString("token_type", "Bearer")
        )
        db.saveToken(refreshed)
        return refreshed.accessToken
    }

    fun exchangeRcloneToken(creds: OAuthClientCredentials, rawTokenJson: String): StoredToken {
        val tokObj = JSONObject(rawTokenJson)
        val refreshToken = tokObj.optString("refresh_token", "").trim()
        val existingAccess = tokObj.optString("access_token", "").trim()
        val tokenType = tokObj.optString("token_type", "Bearer").ifBlank { "Bearer" }
        if (refreshToken.isNotBlank()) {
            val params = linkedMapOf(
                "client_id" to creds.clientId,
                "refresh_token" to refreshToken,
                "grant_type" to "refresh_token"
            )
            if (creds.clientSecret.isNotBlank()) {
                params["client_secret"] = creds.clientSecret
            }
            val obj = postTokenForm(formEncode(params))
            val expiresIn = obj.optLong("expires_in", 3600L)
            return StoredToken(
                accessToken = obj.getString("access_token"),
                refreshToken = obj.optString("refresh_token", refreshToken).ifBlank { refreshToken },
                expiryEpochMs = System.currentTimeMillis() + expiresIn * 1000L,
                tokenType = obj.optString("token_type", tokenType)
            )
        }
        if (existingAccess.isNotBlank()) {
            return StoredToken(
                accessToken = existingAccess,
                refreshToken = "",
                expiryEpochMs = System.currentTimeMillis() + 300_000L,
                tokenType = tokenType
            )
        }
        throw IllegalArgumentException("O campo 'token' do rclone.conf não possui access_token ou refresh_token válido.")
    }

    fun aboutUser(): Pair<String, String> {
        val obj = requestJson("GET", "$DRIVE_API/about?fields=user(emailAddress,displayName)")
        val user = obj.optJSONObject("user") ?: JSONObject()
        return user.optString("emailAddress", "") to user.optString("displayName", "")
    }

    fun listFolders(parentId: String, shared: Boolean): List<RemoteFolderItem> {
        val q = if (shared) {
            "mimeType='application/vnd.google-apps.folder' and trashed=false and sharedWithMe=true"
        } else {
            val safeParent = if (parentId.isBlank()) "root" else parentId.replace("'", "\\'")
            "'$safeParent' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
        }
        val url = "$DRIVE_API/files?q=${enc(q)}&fields=${
            enc("files(id,name,shared,capabilities(canEdit,canAddChildren),owners(emailAddress,displayName),appProperties)")
        }&pageSize=200&orderBy=name_natural&supportsAllDrives=true&includeItemsFromAllDrives=true"
        val obj = requestJson("GET", url)
        val files = obj.optJSONArray("files") ?: JSONArray()
        val out = mutableListOf<RemoteFolderItem>()
        for (i in 0 until files.length()) {
            out.add(parseFolderItem(files.getJSONObject(i), sharedHint = shared))
        }
        return out
    }

    fun createFolder(name: String, parentId: String): RemoteFolderItem {
        val cleanName = name.trim()
        require(cleanName.isNotEmpty()) { "Informe o nome da pasta." }
        val payload = JSONObject().apply {
            put("name", cleanName)
            put("mimeType", "application/vnd.google-apps.folder")
            if (parentId.isNotBlank() && parentId != "root") {
                put("parents", JSONArray().put(parentId))
            }
        }
        val url = "$DRIVE_API/files?fields=${
            enc("id,name,shared,capabilities(canEdit,canAddChildren),owners(emailAddress,displayName),appProperties")
        }&supportsAllDrives=true"
        val obj = requestJson("POST", url, payload.toString())
        return parseFolderItem(obj, sharedHint = false)
    }

    fun getFolderMeta(folderId: String): RemoteFolderItem {
        val url = "$DRIVE_API/files/${enc(folderId)}?fields=${
            enc("id,name,mimeType,trashed,shared,capabilities(canEdit,canAddChildren),owners(emailAddress,displayName),appProperties")
        }&supportsAllDrives=true"
        return try {
            val obj = requestJson("GET", url)
            if (obj.optBoolean("trashed", false)) {
                throw DriveApiException(404, "Esta pasta está na lixeira do Google Drive.")
            }
            if (obj.optString("mimeType") != "application/vnd.google-apps.folder") {
                throw DriveApiException(400, "O ID informado não é uma pasta do Google Drive.")
            }
            parseFolderItem(obj, sharedHint = obj.optBoolean("shared", false))
        } catch (ex: DriveApiException) {
            if (ex.statusCode == 404) {
                throw DriveApiException(
                    404,
                    "Pasta não encontrada nessa conta Google ($folderId). Peça compartilhamento para esta conta ou conecte a conta dona da pasta."
                )
            }
            throw ex
        }
    }

    fun setFolderInviteMetadata(folderId: String, kind: String, joinCode: String) {
        val props = JSONObject().apply {
            put(DriveSyncConstants.JOIN_CODE_APP_PROP, joinCode.trim().uppercase())
            put(DriveSyncConstants.FOLDER_KIND_APP_PROP, kind)
        }
        val payload = JSONObject().put("appProperties", props)
        requestJson(
            "PATCH",
            "$DRIVE_API/files/${enc(folderId)}?supportsAllDrives=true",
            payload.toString()
        )
    }

    fun findFolderByJoinCode(shortCode: String): RemoteFolderItem? {
        val norm = shortCode.trim().uppercase()
        val q =
            "mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='${DriveSyncConstants.JOIN_CODE_APP_PROP}' and value='${norm.replace("'", "\\'")}' }"
        val url = "$DRIVE_API/files?q=${enc(q)}&fields=${
            enc("files(id,name,shared,capabilities(canEdit,canAddChildren),owners(emailAddress,displayName),appProperties)")
        }&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true"
        val obj = requestJson("GET", url)
        val arr = obj.optJSONArray("files") ?: return null
        if (arr.length() == 0) return null
        return parseFolderItem(arr.getJSONObject(0), sharedHint = true)
    }

    fun shareFolder(folderId: String, accessType: String, role: String, email: String?) {
        val safeRole = if (role == "writer") "writer" else "reader"
        val payload = JSONObject().apply {
            put("role", safeRole)
            if (accessType == "anyone") {
                put("type", "anyone")
            } else {
                val target = email?.trim() ?: ""
                require(target.contains("@")) { "Informe um e-mail Google válido para compartilhar." }
                put("type", "user")
                put("emailAddress", target)
            }
        }
        val sendEmail = if (accessType == "anyone") "false" else "true"
        requestJson(
            "POST",
            "$DRIVE_API/files/${enc(folderId)}/permissions?supportsAllDrives=true&sendNotificationEmail=$sendEmail",
            payload.toString()
        )
    }

    fun listTree(rootFolderId: String): List<DriveRemoteFile> {
        val collected = mutableListOf<DriveRemoteFile>()
        walkFolder(rootFolderId, "", collected)
        return collected
    }

    private fun walkFolder(folderId: String, prefix: String, out: MutableList<DriveRemoteFile>) {
        var pageToken = ""
        do {
            val q = "'${folderId.replace("'", "\\'")}' in parents and trashed=false"
            val tokenParam = if (pageToken.isNotBlank()) "&pageToken=${enc(pageToken)}" else ""
            val fields =
                "nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,trashed,lastModifyingUser(emailAddress,displayName),owners(emailAddress,displayName),appProperties)"
            val url =
                "$DRIVE_API/files?q=${enc(q)}&fields=${enc(fields)}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true$tokenParam"
            val obj = requestJson("GET", url)
            val arr = obj.optJSONArray("files") ?: JSONArray()
            for (i in 0 until arr.length()) {
                val f = arr.getJSONObject(i)
                val name = f.optString("name", "")
                if (name.isBlank()) continue
                val rel = if (prefix.isEmpty()) name else "$prefix/$name"
                if (SyncRules.shouldIgnoreRelativePath(rel)) continue
                val mime = f.optString("mimeType", "")
                if (mime == "application/vnd.google-apps.folder") {
                    walkFolder(f.getString("id"), rel, out)
                    continue
                }
                if (mime.startsWith("application/vnd.google-apps.")) {
                    // Docs/Sheets/Slides nativos não possuem bytes binários diretos para sync espelhado.
                    continue
                }
                val (authorEmail, authorName) = extractAuthor(f)
                out.add(
                    DriveRemoteFile(
                        id = f.getString("id"),
                        name = name,
                        relativePath = rel,
                        sizeBytes = f.optString("size", "0").toLongOrNull() ?: 0L,
                        md5Checksum = f.optString("md5Checksum", ""),
                        modifiedTime = f.optString("modifiedTime", ""),
                        mimeType = mime,
                        trashed = f.optBoolean("trashed", false),
                        authorEmail = authorEmail,
                        authorName = authorName
                    )
                )
            }
            pageToken = obj.optString("nextPageToken", "")
        } while (pageToken.isNotBlank())
    }

    fun ensureSubfolderPath(rootFolderId: String, dirSegments: List<String>): String {
        var current = rootFolderId
        for (segment in dirSegments) {
            if (segment.isBlank()) continue
            current = findOrCreateChildFolder(current, segment)
        }
        return current
    }

    private fun findOrCreateChildFolder(parentId: String, name: String): String {
        val escaped = name.replace("\\", "\\\\").replace("'", "\\'")
        val q =
            "'${parentId.replace("'", "\\'")}' in parents and name='$escaped' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        val url = "$DRIVE_API/files?q=${enc(q)}&fields=files(id,name)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true"
        val obj = requestJson("GET", url)
        val arr = obj.optJSONArray("files")
        if (arr != null && arr.length() > 0) {
            return arr.getJSONObject(0).getString("id")
        }
        return createFolder(name, parentId).id
    }

    fun downloadFile(remoteFileId: String, destOut: OutputStream) {
        val token = ensureAccessToken()
        val conn = openHttp("$DRIVE_API/files/${enc(remoteFileId)}?alt=media&supportsAllDrives=true").apply {
            requestMethod = "GET"
            connectTimeout = 20_000
            readTimeout = 60_000
            setRequestProperty("Authorization", "Bearer $token")
        }
        try {
            val code = conn.responseCode
            if (code !in 200..299) {
                throw DriveApiException(code, readErrorText(conn, code))
            }
            conn.inputStream.use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    destOut.write(buf, 0, n)
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    fun uploadStreamResumable(
        parentFolderId: String,
        fileName: String,
        existingFileId: String?,
        mimeType: String,
        sizeBytes: Long,
        input: InputStream,
        senderEmail: String,
        senderName: String,
        onProgress: ((Long, Long) -> Unit)? = null
    ): DriveRemoteFile {
        require(!SyncRules.exceedsUploadLimit(sizeBytes)) {
            "Arquivo excede o limite fixo de 4 GB (${sizeBytes} bytes)."
        }

        val token = ensureAccessToken()
        val meta = JSONObject().apply {
            put("name", fileName)
            if (existingFileId.isNullOrBlank()) {
                put("parents", JSONArray().put(parentFolderId))
            }
            val props = JSONObject().apply {
                if (senderEmail.isNotBlank()) put("drivesyncSenderEmail", senderEmail)
                if (senderName.isNotBlank()) put("drivesyncSenderName", senderName)
            }
            put("appProperties", props)
        }

        val isUpdate = !existingFileId.isNullOrBlank()
        val initUrl = if (isUpdate) {
            "$UPLOAD_API/files/${enc(existingFileId!!)}?uploadType=resumable&supportsAllDrives=true&fields=${
                enc("id,name,size,md5Checksum,modifiedTime,mimeType,trashed,lastModifyingUser(emailAddress,displayName),owners(emailAddress,displayName),appProperties")
            }"
        } else {
            "$UPLOAD_API/files?uploadType=resumable&supportsAllDrives=true&fields=${
                enc("id,name,size,md5Checksum,modifiedTime,mimeType,trashed,lastModifyingUser(emailAddress,displayName),owners(emailAddress,displayName),appProperties")
            }"
        }

        val initConn = openConn(if (isUpdate) "PATCH" else "POST", initUrl, token).apply {
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            setRequestProperty("X-Upload-Content-Type", mimeType.ifBlank { "application/octet-stream" })
            setRequestProperty("X-Upload-Content-Length", sizeBytes.toString())
        }
        val sessionUri: String
        try {
            initConn.outputStream.use { it.write(meta.toString().toByteArray(StandardCharsets.UTF_8)) }
            val initCode = initConn.responseCode
            if (initCode !in 200..299) {
                throw DriveApiException(initCode, readErrorText(initConn, initCode))
            }
            sessionUri = initConn.getHeaderField("Location")
                ?: throw DriveApiException(500, "Google Drive não retornou cabeçalho Location para upload.")
        } finally {
            initConn.disconnect()
        }

        if (sizeBytes == 0L) {
            val putConn = openConn("PUT", sessionUri, token).apply {
                doOutput = true
                setFixedLengthStreamingMode(0)
                setRequestProperty("Content-Length", "0")
                setRequestProperty("Content-Type", mimeType.ifBlank { "application/octet-stream" })
            }
            try {
                putConn.outputStream.use { }
                val code = putConn.responseCode
                if (code !in 200..299) {
                    throw DriveApiException(code, readErrorText(putConn, code))
                }
                val obj = JSONObject(putConn.inputStream.bufferedReader().use { it.readText() })
                onProgress?.invoke(0L, 0L)
                return parseUploadedFile(obj, fileName)
            } finally {
                putConn.disconnect()
            }
        }

        val chunkBuf = ByteArray(CHUNK_SIZE)
        var offset = 0L
        var finalObj: JSONObject? = null
        while (offset < sizeBytes) {
            var filled = 0
            while (filled < chunkBuf.size && offset + filled < sizeBytes) {
                val n = input.read(chunkBuf, filled, chunkBuf.size - filled)
                if (n < 0) break
                filled += n
            }
            if (filled == 0) break
            val endByte = offset + filled - 1
            val chunkConn = openConn("PUT", sessionUri, token).apply {
                doOutput = true
                readTimeout = 120_000
                setFixedLengthStreamingMode(filled)
                setRequestProperty("Content-Type", mimeType.ifBlank { "application/octet-stream" })
                setRequestProperty("Content-Range", "bytes $offset-$endByte/$sizeBytes")
            }
            try {
                chunkConn.outputStream.use { out ->
                    out.write(chunkBuf, 0, filled)
                }
                val code = chunkConn.responseCode
                offset += filled
                onProgress?.invoke(offset, sizeBytes)
                when (code) {
                    308 -> Unit
                    in 200..299 -> {
                        val txt = chunkConn.inputStream.bufferedReader().use { it.readText() }
                        finalObj = JSONObject(txt)
                    }
                    else -> throw DriveApiException(code, readErrorText(chunkConn, code))
                }
            } finally {
                chunkConn.disconnect()
            }
        }

        val obj = finalObj ?: throw DriveApiException(500, "Upload incompleto para $fileName.")
        return parseUploadedFile(obj, fileName)
    }

    fun trashFile(remoteFileId: String) {
        val payload = JSONObject().put("trashed", true)
        requestJson(
            "PATCH",
            "$DRIVE_API/files/${enc(remoteFileId)}?supportsAllDrives=true",
            payload.toString()
        )
    }

    fun writeControlJson(rootFolderId: String, fileName: String, jsonText: String) {
        val devicesFolderId = ensureSubfolderPath(rootFolderId, listOf(DriveSyncConstants.CONTROL_DIR, "devices"))
        val escaped = fileName.replace("'", "\\'")
        val q = "'${devicesFolderId.replace("'", "\\'")}' in parents and name='$escaped' and trashed=false"
        val check = requestJson(
            "GET",
            "$DRIVE_API/files?q=${enc(q)}&fields=files(id)&pageSize=2&supportsAllDrives=true&includeItemsFromAllDrives=true"
        )
        val existingId = check.optJSONArray("files")?.optJSONObject(0)?.optString("id")
        val bytes = jsonText.toByteArray(StandardCharsets.UTF_8)
        uploadStreamResumable(
            parentFolderId = devicesFolderId,
            fileName = fileName,
            existingFileId = existingId,
            mimeType = "application/json",
            sizeBytes = bytes.size.toLong(),
            input = ByteArrayInputStream(bytes),
            senderEmail = "",
            senderName = ""
        )
    }

    fun listControlJsons(rootFolderId: String, folderConfigId: String, currentDeviceId: String): List<DeviceRegistration> {
        val qControl = "'${rootFolderId.replace("'", "\\'")}' in parents and name='${DriveSyncConstants.CONTROL_DIR}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        val cObj = requestJson(
            "GET",
            "$DRIVE_API/files?q=${enc(qControl)}&fields=files(id)&pageSize=2&supportsAllDrives=true&includeItemsFromAllDrives=true"
        )
        val controlId = cObj.optJSONArray("files")?.optJSONObject(0)?.optString("id") ?: return emptyList()

        val qDev = "'${controlId.replace("'", "\\'")}' in parents and name='devices' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        val dObj = requestJson(
            "GET",
            "$DRIVE_API/files?q=${enc(qDev)}&fields=files(id)&pageSize=2&supportsAllDrives=true&includeItemsFromAllDrives=true"
        )
        val devFolderId = dObj.optJSONArray("files")?.optJSONObject(0)?.optString("id") ?: return emptyList()

        val qFiles = "'${devFolderId.replace("'", "\\'")}' in parents and trashed=false"
        val fObj = requestJson(
            "GET",
            "$DRIVE_API/files?q=${enc(qFiles)}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true"
        )
        val arr = fObj.optJSONArray("files") ?: return emptyList()
        val list = mutableListOf<DeviceRegistration>()
        for (i in 0 until arr.length()) {
            val fileObj = arr.getJSONObject(i)
            val name = fileObj.optString("name", "")
            if (!name.endsWith(".json")) continue
            val fid = fileObj.getString("id")
            runCatching {
                val baos = java.io.ByteArrayOutputStream()
                downloadFile(fid, baos)
                val parsed = JSONObject(baos.toString(StandardCharsets.UTF_8.name()))
                val did = parsed.optString("deviceId", "")
                if (did.isNotBlank()) {
                    list.add(
                        DeviceRegistration(
                            deviceId = did,
                            deviceName = parsed.optString("deviceName", did),
                            platform = parsed.optString("platform", "unknown"),
                            arch = parsed.optString("arch", ""),
                            appVersion = parsed.optString("appVersion", ""),
                            accountEmail = parsed.optString("accountEmail", ""),
                            syncMode = parsed.optString("syncMode", "bidirectional"),
                            folderId = folderConfigId,
                            status = parsed.optString("status", "online"),
                            lastSeenAt = parsed.optString("lastSeenAt", ""),
                            isCurrentDevice = did == currentDeviceId
                        )
                    )
                }
            }
        }
        return list
    }

    private fun parseFolderItem(obj: JSONObject, sharedHint: Boolean): RemoteFolderItem {
        val caps = obj.optJSONObject("capabilities") ?: JSONObject()
        val canWrite = caps.optBoolean("canEdit", true) || caps.optBoolean("canAddChildren", false)
        val owners = obj.optJSONArray("owners")
        val owner = owners?.optJSONObject(0)
        val props = obj.optJSONObject("appProperties")
        return RemoteFolderItem(
            id = obj.getString("id"),
            name = obj.optString("name", "Pasta sem nome"),
            shared = obj.optBoolean("shared", sharedHint),
            ownerEmail = owner?.optString("emailAddress", "") ?: "",
            ownerName = owner?.optString("displayName", "") ?: "",
            canWrite = canWrite,
            joinCode = props?.optString(DriveSyncConstants.JOIN_CODE_APP_PROP, "") ?: "",
            kind = props?.optString(DriveSyncConstants.FOLDER_KIND_APP_PROP, "") ?: ""
        )
    }

    private fun parseUploadedFile(obj: JSONObject, fallbackName: String): DriveRemoteFile {
        val (authorEmail, authorName) = extractAuthor(obj)
        return DriveRemoteFile(
            id = obj.getString("id"),
            name = obj.optString("name", fallbackName),
            relativePath = fallbackName,
            sizeBytes = obj.optString("size", "0").toLongOrNull() ?: 0L,
            md5Checksum = obj.optString("md5Checksum", ""),
            modifiedTime = obj.optString("modifiedTime", ""),
            mimeType = obj.optString("mimeType", ""),
            trashed = obj.optBoolean("trashed", false),
            authorEmail = authorEmail,
            authorName = authorName
        )
    }

    private fun extractAuthor(obj: JSONObject): Pair<String, String> {
        val props = obj.optJSONObject("appProperties")
        val propEmail = props?.optString("drivesyncSenderEmail", "")?.trim().orEmpty()
        val propName = props?.optString("drivesyncSenderName", "")?.trim().orEmpty()
        val lastMod = obj.optJSONObject("lastModifyingUser")
        val lastEmail = lastMod?.optString("emailAddress", "")?.trim().orEmpty()
        val lastName = lastMod?.optString("displayName", "")?.trim().orEmpty()
        val owner = obj.optJSONArray("owners")?.optJSONObject(0)
        val ownerEmail = owner?.optString("emailAddress", "")?.trim().orEmpty()
        val ownerName = owner?.optString("displayName", "")?.trim().orEmpty()
        val email = propEmail.ifBlank { lastEmail }.ifBlank { ownerEmail }
        val name = propName.ifBlank { lastName }.ifBlank { ownerName }
        return email to name
    }

    private fun openHttp(urlStr: String): HttpURLConnection {
        val url = URL(urlStr)
        val cm = context?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val activeNet = cm?.activeNetwork
        if (activeNet != null) {
            runCatching { activeNet.openConnection(url) as? HttpURLConnection }.getOrNull()?.let { return it }
        }
        return url.openConnection() as HttpURLConnection
    }

    private fun isTransientNetworkError(ex: Exception): Boolean =
        ex is UnknownHostException ||
            ex is ConnectException ||
            ex is SocketException ||
            ex is SocketTimeoutException

    private fun <T> withNetworkRetry(block: () -> T): T {
        var lastErr: Exception? = null
        for (delayMs in RETRY_DELAYS_MS) {
            if (delayMs > 0L) {
                runCatching { Thread.sleep(delayMs) }
            }
            try {
                return block()
            } catch (ex: Exception) {
                if (!isTransientNetworkError(ex)) throw ex
                lastErr = ex
            }
        }
        val msg = lastErr?.message.orEmpty()
        if (lastErr is UnknownHostException) {
            throw IllegalStateException(
                "Sem acesso DNS/Internet no DriveSync ($msg). Verifique se o celular está conectado à internet e se os dados em segundo plano estão liberados para o app.",
                lastErr
            )
        }
        throw lastErr ?: IllegalStateException("Falha de conexão de rede.")
    }

    private fun openConn(method: String, urlStr: String, token: String): HttpURLConnection {
        val conn = openHttp(urlStr)
        try {
            conn.requestMethod = method
        } catch (_: ProtocolException) {
            conn.requestMethod = "POST"
            conn.setRequestProperty("X-HTTP-Method-Override", method)
        }
        conn.connectTimeout = 20_000
        conn.readTimeout = 45_000
        conn.setRequestProperty("Authorization", "Bearer $token")
        return conn
    }

    private fun requestJson(method: String, urlStr: String, bodyJson: String? = null): JSONObject {
        val token = ensureAccessToken()
        return withNetworkRetry {
            val conn = openConn(method, urlStr, token)
            try {
                if (bodyJson != null) {
                    conn.doOutput = true
                    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                    conn.outputStream.use { it.write(bodyJson.toByteArray(StandardCharsets.UTF_8)) }
                }
                val code = conn.responseCode
                if (code !in 200..299) {
                    throw DriveApiException(code, readErrorText(conn, code))
                }
                val txt = conn.inputStream.bufferedReader().use { it.readText() }
                if (txt.isBlank()) JSONObject() else JSONObject(txt)
            } finally {
                conn.disconnect()
            }
        }
    }

    private fun postTokenForm(encodedBody: String): JSONObject {
        return try {
            postForm(TOKEN_URL, encodedBody)
        } catch (ex: Exception) {
            if (ex is UnknownHostException || ex.cause is UnknownHostException || ex.message?.contains("Unable to resolve host") == true) {
                postForm(TOKEN_URL_FALLBACK, encodedBody)
            } else {
                throw ex
            }
        }
    }

    private fun postForm(urlStr: String, encodedBody: String): JSONObject {
        return withNetworkRetry {
            val conn = openHttp(urlStr).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 20_000
                readTimeout = 30_000
                setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
            }
            try {
                conn.outputStream.use { it.write(encodedBody.toByteArray(StandardCharsets.UTF_8)) }
                val code = conn.responseCode
                if (code !in 200..299) {
                    throw DriveApiException(code, readErrorText(conn, code))
                }
                val txt = conn.inputStream.bufferedReader().use { it.readText() }
                JSONObject(txt)
            } finally {
                conn.disconnect()
            }
        }
    }

    private fun readErrorText(conn: HttpURLConnection, code: Int): String {
        val raw = runCatching {
            (conn.errorStream ?: conn.inputStream)?.bufferedReader()?.use { it.readText() }
        }.getOrNull().orEmpty()
        return runCatching {
            val obj = JSONObject(raw)
            val err = obj.optJSONObject("error")
            val msg = err?.optString("message", "")?.takeIf { it.isNotBlank() }
                ?: obj.optString("error_description", "").takeIf { it.isNotBlank() }
                ?: obj.optString("error", "")
            msg.ifBlank { "Google Drive HTTP $code" }
        }.getOrElse {
            if (raw.isNotBlank()) "Google Drive HTTP $code: ${raw.take(240)}" else "Google Drive HTTP $code"
        }
    }

    private fun formEncode(params: Map<String, String>): String =
        params.entries.joinToString("&") { (k, v) -> "${enc(k)}=${enc(v)}" }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
}
