package com.drivesync.mobile

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

@CapacitorPlugin(name = "DriveSyncNative")
class DriveSyncPlugin : Plugin() {

    private lateinit var db: MobileStateDb
    private lateinit var api: DriveApiClient
    private lateinit var engine: MobileSyncEngine
    private val executor = Executors.newCachedThreadPool()

    @Volatile
    private var activeAuthServer: ServerSocket? = null

    @Volatile
    private var pendingAuthCreds: OAuthClientCredentials? = null

    @Volatile
    private var pendingAuthRedirectUri: String = ""

    @Volatile
    private var pendingAuthState: String = ""

    @Volatile
    private var pendingAuthVerifier: String = ""

    @Volatile
    private var activeAuthCall: PluginCall? = null

    override fun load() {
        db = MobileStateDb(context)
        api = DriveApiClient(db, context)
        engine = MobileSyncEngine(context, db, api)
        DriveSyncWorker.applySchedule(context, db.getSettings())
    }

    @PluginMethod
    fun getSnapshot(call: PluginCall) {
        executor.execute {
            runCatching {
                toJSObject(db.getSnapshotJson())
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao carregar estado do app.") }
        }
    }

    @PluginMethod
    fun saveOAuthClient(call: PluginCall) {
        val clientId = call.getString("clientId", "")?.trim().orEmpty()
        val clientSecret = call.getString("clientSecret", "")?.trim().orEmpty()
        if (clientId.isBlank()) {
            call.reject("Informe o Client ID do Google Cloud.")
            return
        }
        executor.execute {
            runCatching {
                db.saveCustomOAuthClient(OAuthClientCredentials(clientId, clientSecret))
                toJSObject(db.getAccountInfo().toJson())
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Falha ao salvar Client ID.") }
        }
    }

    @PluginMethod
    fun uploadGoogleOAuthJson(call: PluginCall) {
        val rawJson = call.getString("rawJson", "").orEmpty()
        if (rawJson.isBlank()) {
            call.reject("Arquivo credentials.json vazio.")
            return
        }
        executor.execute {
            runCatching {
                val creds = SyncRules.parseGoogleCredentialsJson(rawJson)
                db.saveCustomOAuthClient(creds)
                toJSObject(db.getAccountInfo().toJson())
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Arquivo JSON OAuth inválido.") }
        }
    }

    @PluginMethod
    fun pickAndLoadOAuthJson(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(call, intent, "onOAuthJsonPicked")
    }

    @ActivityCallback
    private fun onOAuthJsonPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("Seleção do arquivo JSON cancelada.")
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            call.reject("Nenhum arquivo selecionado.")
            return
        }
        executor.execute {
            runCatching {
                val rawJson = context.contentResolver.openInputStream(uri)?.use {
                    it.bufferedReader(StandardCharsets.UTF_8).readText()
                }.orEmpty()
                require(rawJson.isNotBlank()) { "Arquivo JSON vazio ou ilegível." }
                val creds = SyncRules.parseGoogleCredentialsJson(rawJson)
                db.saveCustomOAuthClient(creds)
                toJSObject(db.getAccountInfo().toJson())
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Não foi possível ler o credentials.json.") }
        }
    }

    @PluginMethod
    fun clearOAuthClient(call: PluginCall) {
        executor.execute {
            runCatching {
                db.clearCustomOAuthClient()
                toJSObject(db.getAccountInfo().toJson())
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Falha ao remover chave personalizada.") }
        }
    }

    @PluginMethod
    fun getOAuthStatus(call: PluginCall) {
        executor.execute {
            runCatching {
                toJSObject(db.getOAuthClientStatusJson())
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Falha ao consultar chave OAuth.") }
        }
    }

    @PluginMethod
    fun importRcloneConf(call: PluginCall) {
        val rawConf = call.getString("rawConf", "").orEmpty()
        val remoteName = call.getString("remoteName", "")?.trim().orEmpty()
        if (rawConf.isBlank()) {
            call.reject("Cole o conteúdo do rclone.conf primeiro.")
            return
        }
        executor.execute {
            runCatching {
                applyRcloneConfRaw(rawConf, remoteName)
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Não foi possível importar do rclone.conf.") }
        }
    }

    @PluginMethod
    fun pickAndImportRcloneConf(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(call, intent, "onRcloneConfPicked")
    }

    @ActivityCallback
    private fun onRcloneConfPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val remoteName = call.getString("remoteName", "")?.trim().orEmpty()
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("Seleção do arquivo rclone.conf cancelada.")
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            call.reject("Nenhum arquivo selecionado.")
            return
        }
        executor.execute {
            runCatching {
                val rawConf = context.contentResolver.openInputStream(uri)?.use {
                    it.bufferedReader(StandardCharsets.UTF_8).readText()
                }.orEmpty()
                require(rawConf.isNotBlank()) { "Arquivo rclone.conf vazio ou ilegível." }
                applyRcloneConfRaw(rawConf, remoteName)
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Falha ao ler rclone.conf.") }
        }
    }

    private fun applyRcloneConfRaw(rawConf: String, preferredRemote: String): JSObject {
        val profile = SyncRules.parseRcloneConf(rawConf, preferredRemote)
        val creds = OAuthClientCredentials(profile.clientId, profile.clientSecret)
        db.saveCustomOAuthClient(creds)
        if (profile.rawTokenJson.isNotBlank()) {
            val token = api.exchangeRcloneToken(creds, profile.rawTokenJson)
            db.saveToken(token)
            val (email, displayName) = api.aboutUser()
            db.saveAccountProfile(email, displayName)
            db.saveAuthSource("rclone_import")
            DriveSyncWorker.applySchedule(context, db.getSettings())
            runCatching { engine.discoverAndCacheAccountFolders() }
        }
        return toJSObject(db.getAccountInfo().toJson())
    }

    @PluginMethod
    fun cancelGoogleOAuth(call: PluginCall) {
        clearPendingOAuthState()
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun completeGoogleOAuthFromUrl(call: PluginCall) {
        val rawUrl = call.getString("callbackUrl", "")?.trim().orEmpty()
        if (rawUrl.isBlank()) {
            call.reject("Cole a URL completa de retorno (http://127.0.0.1:...).")
            return
        }
        val query = rawUrl.substringAfter('?', "")
        val qParams = parseQuery(query)
        val code = qParams["code"]?.trim().orEmpty()
        if (code.isBlank()) {
            call.reject("Essa URL não contém o parâmetro code= do Google.")
            return
        }
        val expectedState = pendingAuthState
        if (expectedState.isNotBlank() && qParams["state"] != null && qParams["state"] != expectedState) {
            call.reject("O parâmetro state não confere com esta sessão. Inicie o login novamente.")
            return
        }
        val creds = pendingAuthCreds ?: db.getEffectiveOAuthClient()
        if (creds == null || creds.clientId.isBlank()) {
            call.reject("Credencial OAuth ausente.")
            return
        }
        val redirectUri = pendingAuthRedirectUri.ifBlank {
            runCatching {
                val u = Uri.parse(rawUrl)
                val portPart = if (u.port > 0) ":${u.port}" else ""
                "${u.scheme ?: "http"}://${u.host ?: "127.0.0.1"}$portPart/"
            }.getOrDefault("http://127.0.0.1:53682/")
        }
        val verifier = pendingAuthVerifier
        val previousCall = activeAuthCall
        clearPendingOAuthState()

        executor.execute {
            runCatching {
                val accountJson = finishGoogleOAuthExchange(creds, code, redirectUri, verifier)
                previousCall?.resolve(accountJson)
                accountJson
            }.onSuccess { call.resolve(it) }
                .onFailure {
                    val msg = it.message ?: "Falha ao concluir login pela URL."
                    previousCall?.reject(msg)
                    call.reject(msg)
                }
        }
    }

    private fun clearPendingOAuthState() {
        runCatching { activeAuthServer?.close() }
        activeAuthServer = null
        pendingAuthCreds = null
        pendingAuthRedirectUri = ""
        pendingAuthState = ""
        pendingAuthVerifier = ""
        activeAuthCall = null
    }

    @PluginMethod
    fun startGoogleOAuth(call: PluginCall) {
        val creds = db.getEffectiveOAuthClient()
        if (creds == null || creds.clientId.isBlank()) {
            call.reject("Falta configurar o Client ID OAuth no app. Anexe o credentials.json, cole o conteúdo dele ou informe o Client ID abaixo.")
            return
        }

        executor.execute {
            var server: ServerSocket? = null
            try {
                runCatching { activeAuthServer?.close() }
                server = bindLoopbackSocket()
                activeAuthServer = server
                val port = server.localPort
                val redirectUri = "http://127.0.0.1:$port/"
                val state = randomUrlSafe(24)
                val verifier = if (creds.clientSecret.isBlank()) randomUrlSafe(48) else ""

                pendingAuthCreds = creds
                pendingAuthRedirectUri = redirectUri
                pendingAuthState = state
                pendingAuthVerifier = verifier
                activeAuthCall = call

                val params = linkedMapOf(
                    "client_id" to creds.clientId,
                    "redirect_uri" to redirectUri,
                    "response_type" to "code",
                    "scope" to DriveSyncConstants.GOOGLE_OAUTH_SCOPE,
                    "access_type" to "offline",
                    "prompt" to "select_account consent",
                    "state" to state,
                    "include_granted_scopes" to "true"
                )
                if (verifier.isNotBlank()) {
                    val digest = MessageDigest.getInstance("SHA-256")
                        .digest(verifier.toByteArray(StandardCharsets.US_ASCII))
                    val challenge = Base64.encodeToString(
                        digest,
                        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
                    )
                    params["code_challenge"] = challenge
                    params["code_challenge_method"] = "S256"
                }

                val authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" +
                    params.entries.joinToString("&") { (k, v) -> "${enc(k)}=${enc(v)}" }

                notifyListeners("authUrlReady", JSObject().apply { put("authUrl", authUrl) })

                val act = activity
                if (act != null) {
                    act.runOnUiThread {
                        runCatching {
                            CustomTabsIntent.Builder().build().launchUrl(act, Uri.parse(authUrl))
                        }.onFailure {
                            act.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(authUrl)))
                        }
                    }
                } else {
                    context.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse(authUrl)).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                    )
                }

                server.soTimeout = 5 * 60 * 1000
                var capturedCode: String? = null
                var oauthError: String? = null

                while (capturedCode == null && oauthError == null) {
                    val socket = server.accept()
                    socket.use { sock ->
                        val reader = BufferedReader(InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8))
                        val requestLine = reader.readLine().orEmpty()
                        while (true) {
                            val headerLine = reader.readLine()
                            if (headerLine.isNullOrEmpty()) break
                        }
                        val parts = requestLine.split(' ')
                        val targetPath = parts.getOrNull(1).orEmpty()
                        val query = targetPath.substringAfter('?', "")
                        val qParams = parseQuery(query)

                        if (targetPath.startsWith("/favicon")) {
                            writeHttpHtml(sock.getOutputStream(), 404, "Not found")
                            return@use
                        }

                        if (qParams["error"] != null) {
                            oauthError = "Autorização cancelada: ${qParams["error"]}"
                            writeHttpHtml(
                                sock.getOutputStream(),
                                400,
                                buildResultHtml("Login cancelado", "Você pode voltar ao aplicativo DriveSync.")
                            )
                        } else if (!qParams["code"].isNullOrBlank()) {
                            if (qParams["state"] != state) {
                                oauthError = "Validação de estado OAuth inválida. Tente novamente."
                                writeHttpHtml(
                                    sock.getOutputStream(),
                                    400,
                                    buildResultHtml("Falha de validação", "Volte ao aplicativo e tente novamente.")
                                )
                            } else {
                                capturedCode = qParams["code"]
                                writeHttpHtml(
                                    sock.getOutputStream(),
                                    200,
                                    buildResultHtml(
                                        "Autorização recebida!",
                                        "Retornando para o DriveSync para concluir a conexão..."
                                    )
                                )
                            }
                        } else {
                            writeHttpHtml(
                                sock.getOutputStream(),
                                200,
                                buildResultHtml("Aguardando Google...", "Conclua o login na janela aberta.")
                            )
                        }
                        runCatching { Thread.sleep(80) }
                    }
                }

                runCatching { server.close() }
                if (activeAuthServer === server) {
                    activeAuthServer = null
                }

                // Traz o DriveSync para primeiro plano antes da chamada HTTPS, evitando bloqueio DNS em background no Android.
                bringAppToFront()
                runCatching { Thread.sleep(450) }

                oauthError?.let { errMsg ->
                    if (activeAuthCall === call) {
                        clearPendingOAuthState()
                        call.reject(errMsg)
                    }
                    return@execute
                }

                val code = capturedCode ?: throw IllegalStateException("Código OAuth não recebido.")
                if (activeAuthCall !== call) {
                    return@execute
                }
                val result = finishGoogleOAuthExchange(creds, code, redirectUri, verifier)
                clearPendingOAuthState()
                call.resolve(result)
            } catch (ex: Exception) {
                if (activeAuthCall === call) {
                    clearPendingOAuthState()
                    call.reject(ex.message ?: "Falha no login com Google.")
                }
            } finally {
                if (activeAuthServer === server) {
                    activeAuthServer = null
                }
                runCatching { server?.close() }
            }
        }
    }

    private fun finishGoogleOAuthExchange(
        creds: OAuthClientCredentials,
        code: String,
        redirectUri: String,
        verifier: String
    ): JSObject {
        val token = api.exchangeOAuthCode(creds, code, redirectUri, verifier)
        db.saveToken(token)
        val (email, displayName) = api.aboutUser()
        db.saveAccountProfile(email, displayName)
        db.saveAuthSource("oauth_pkce")
        DriveSyncWorker.applySchedule(context, db.getSettings())
        runCatching { engine.discoverAndCacheAccountFolders() }
        return toJSObject(db.getAccountInfo().toJson())
    }

    private fun bringAppToFront() {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("com.drivesync.mobile://oauth-done")
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
        }
        val act = activity
        if (act != null) {
            act.runOnUiThread { runCatching { act.startActivity(intent) } }
        } else {
            runCatching { context.startActivity(intent) }
        }
    }

    @PluginMethod
    fun disconnectAccount(call: PluginCall) {
        executor.execute {
            db.clearAccount()
            call.resolve(JSObject().apply { put("ok", true) })
        }
    }

    @PluginMethod
    fun pickLocalFolder(call: PluginCall) {
        startTreePicker(call, "onLocalFolderPicked")
    }

    @PluginMethod
    fun pickSyncRootFolder(call: PluginCall) {
        startTreePicker(call, "onSyncRootPicked")
    }

    private fun startTreePicker(call: PluginCall, callbackName: String) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
        }
        startActivityForResult(call, intent, callbackName)
    }

    private fun persistTreeUri(data: Intent?): Pair<Uri, String> {
        val uri = data?.data ?: throw IllegalStateException("Nenhuma pasta retornada pelo Android.")
        runCatching {
            val takeFlags = data.flags and
                (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            val fallbackFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            context.contentResolver.takePersistableUriPermission(
                uri,
                if (takeFlags != 0) takeFlags else fallbackFlags
            )
        }
        val doc = DocumentFile.fromTreeUri(context, uri)
        val label = doc?.name ?: uri.lastPathSegment ?: "Pasta do celular"
        return uri to label
    }

    @ActivityCallback
    private fun onLocalFolderPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("Seleção de pasta cancelada.")
            return
        }
        runCatching {
            val (uri, label) = persistTreeUri(result.data)
            JSObject().apply {
                put("uri", uri.toString())
                put("displayName", label)
            }
        }.onSuccess { call.resolve(it) }
            .onFailure { call.reject(it.message ?: "Nenhuma pasta selecionada.") }
    }

    @ActivityCallback
    private fun onSyncRootPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("Seleção de pasta cancelada.")
            return
        }
        val autoConnectAll = call.getBoolean("autoConnectDiscovered", false) ?: false
        executor.execute {
            runCatching {
                val (uri, label) = persistTreeUri(result.data)
                val cur = db.getSettings()
                val updated = db.saveSettings(
                    cur.copy(syncRootUri = uri.toString(), syncRootLabel = label)
                )
                var connectedCount = 0
                if (autoConnectAll) {
                    val discovered = engine.discoverAndCacheAccountFolders()
                    if (discovered.isNotEmpty()) {
                        val created = engine.connectDiscoveredFolders(uri, discovered, createSubfolders = true)
                        connectedCount = created.size
                        created.forEach { cfg ->
                            executor.execute { runCatching { engine.syncAllFolders(cfg.id) } }
                        }
                    }
                }
                JSObject().apply {
                    put("uri", updated.syncRootUri)
                    put("displayName", updated.syncRootLabel)
                    put("connectedCount", connectedCount)
                }
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao configurar pasta base.") }
        }
    }

    @PluginMethod
    fun discoverAccountFolders(call: PluginCall) {
        executor.execute {
            runCatching {
                val list = engine.discoverAndCacheAccountFolders()
                val arr = JSONArray()
                list.forEach { arr.put(it.toJson()) }
                toJSObject(JSONObject().put("items", arr))
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao buscar pastas da conta no Drive.") }
        }
    }

    @PluginMethod
    fun syncDiscoveredFolders(call: PluginCall) {
        val baseUriStr = call.getString("baseUri", "")?.trim().orEmpty()
        val createSubfolders = call.getBoolean("createSubfolders", true) ?: true
        val foldersArr = call.getArray("folders")
        executor.execute {
            runCatching {
                val settings = db.getSettings()
                val resolvedUri = baseUriStr.ifBlank { settings.syncRootUri }
                require(resolvedUri.isNotBlank()) { "Escolha onde salvar as pastas no celular primeiro." }
                val targets = mutableListOf<DiscoveredRemoteFolder>()
                if (foldersArr != null) {
                    for (i in 0 until foldersArr.length()) {
                        val obj = foldersArr.optJSONObject(i) ?: continue
                        val parsed = DiscoveredRemoteFolder.fromJson(obj)
                        if (parsed.remoteFolderId.isNotBlank()) targets.add(parsed)
                    }
                } else {
                    targets.addAll(db.getDiscoveredFolders())
                }
                val created = engine.connectDiscoveredFolders(
                    Uri.parse(resolvedUri),
                    targets,
                    createSubfolders = createSubfolders
                )
                created.forEach { cfg ->
                    executor.execute { runCatching { engine.syncAllFolders(cfg.id) } }
                }
                val arr = JSONArray()
                created.forEach { arr.put(it.toJson()) }
                toJSObject(JSONObject().put("folders", arr))
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao conectar pastas descobertas.") }
        }
    }

    @PluginMethod
    fun pickAndImportFiles(call: PluginCall) {
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        if (folderId.isBlank()) {
            call.reject("Informe o ID da pasta sincronizada.")
            return
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        startActivityForResult(call, intent, "onImportFilesPicked")
    }

    @ActivityCallback
    private fun onImportFilesPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        val subpath = call.getString("subpath", "")?.trim().orEmpty()
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(JSObject().apply {
                put("addedCount", 0)
                put("skippedOver4GB", JSArray())
                put("errors", JSArray())
            })
            return
        }
        val uris = mutableListOf<Uri>()
        val clip = result.data?.clipData
        if (clip != null) {
            for (i in 0 until clip.itemCount) {
                clip.getItemAt(i).uri?.let { uris.add(it) }
            }
        } else {
            result.data?.data?.let { uris.add(it) }
        }
        executor.execute {
            runCatching {
                val (added, skipped) = engine.importDocumentUris(folderId, subpath, uris)
                if (added > 0) {
                    executor.execute { runCatching { engine.syncAllFolders(folderId) } }
                }
                JSObject().apply {
                    put("addedCount", added)
                    put("skippedOver4GB", JSArray().apply { skipped.forEach { put(it) } })
                    put("errors", JSArray())
                }
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao importar arquivos.") }
        }
    }

    @PluginMethod
    fun pickAndImportFolder(call: PluginCall) {
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        if (folderId.isBlank()) {
            call.reject("Informe o ID da pasta sincronizada.")
            return
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "onImportFolderPicked")
    }

    @ActivityCallback
    private fun onImportFolderPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        val subpath = call.getString("subpath", "")?.trim().orEmpty()
        if (result.resultCode != Activity.RESULT_OK || result.data?.data == null) {
            call.resolve(JSObject().apply {
                put("addedCount", 0)
                put("skippedOver4GB", JSArray())
                put("errors", JSArray())
            })
            return
        }
        val treeUri = result.data!!.data!!
        executor.execute {
            runCatching {
                val (added, skipped) = engine.importDirectoryTree(folderId, subpath, treeUri)
                if (added > 0) {
                    executor.execute { runCatching { engine.syncAllFolders(folderId) } }
                }
                JSObject().apply {
                    put("addedCount", added)
                    put("skippedOver4GB", JSArray().apply { skipped.forEach { put(it) } })
                    put("errors", JSArray())
                }
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao importar pasta.") }
        }
    }

    @PluginMethod
    fun openLocalItem(call: PluginCall) {
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        val relativePath = call.getString("relativePath", "")?.trim().orEmpty()
        val directUri = call.getString("uri", "")?.trim().orEmpty()
        executor.execute {
            runCatching {
                val targetDoc: DocumentFile? = when {
                    directUri.isNotBlank() -> {
                        val parsed = Uri.parse(directUri)
                        if (directUri.contains("/tree/")) {
                            DocumentFile.fromTreeUri(context, parsed)
                        } else {
                            DocumentFile.fromSingleUri(context, parsed)
                        }
                    }
                    folderId.isNotBlank() -> {
                        val folder = db.getFolder(folderId)
                            ?: throw IllegalArgumentException("Pasta sincronizada não encontrada.")
                        var doc: DocumentFile? = DocumentFile.fromTreeUri(context, Uri.parse(folder.localPath))
                        if (relativePath.isNotBlank()) {
                            for (seg in relativePath.split('/').filter { it.isNotBlank() }) {
                                doc = doc?.findFile(seg)
                            }
                        }
                        doc
                    }
                    else -> null
                }
                if (targetDoc == null || !targetDoc.exists()) {
                    throw IllegalStateException("Arquivo ou pasta não encontrado no celular.")
                }
                val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(
                        targetDoc.uri,
                        if (targetDoc.isDirectory) "vnd.android.document/directory"
                        else (targetDoc.type ?: "*/*")
                    )
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(Intent.createChooser(viewIntent, "Abrir com").apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                JSObject().apply { put("ok", true) }
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Nenhum aplicativo disponível para abrir este item.") }
        }
    }

    @PluginMethod
    fun listFolderContents(call: PluginCall) {
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        val subpath = call.getString("subpath", "")?.trim().orEmpty()
        if (folderId.isBlank()) {
            call.reject("Informe o ID da pasta sincronizada.")
            return
        }
        executor.execute {
            runCatching {
                toJSObject(engine.listFolderContents(folderId, subpath))
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao listar arquivos da pasta local.") }
        }
    }

    @PluginMethod
    fun createSubfolder(call: PluginCall) {
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        val subpath = call.getString("subpath", "")?.trim().orEmpty()
        val name = call.getString("name", "")?.trim().orEmpty()
        executor.execute {
            runCatching {
                engine.createSubfolder(folderId, subpath, name)
                JSObject().apply { put("ok", true) }
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao criar subpasta.") }
        }
    }

    @PluginMethod
    fun listDriveFolders(call: PluginCall) {
        val parentId = call.getString("parentId", "root") ?: "root"
        val shared = call.getBoolean("shared", false) ?: false
        executor.execute {
            runCatching {
                val list = api.listFolders(parentId, shared)
                val arr = JSONArray()
                list.forEach { arr.put(it.toJson()) }
                val root = JSONObject().put("items", arr)
                toJSObject(root)
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao listar pastas do Google Drive.") }
        }
    }

    @PluginMethod
    fun createDriveFolder(call: PluginCall) {
        val name = call.getString("name", "")?.trim().orEmpty()
        val parentId = call.getString("parentId", "root") ?: "root"
        executor.execute {
            runCatching {
                val created = api.createFolder(name, parentId)
                toJSObject(created.toJson())
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao criar pasta no Google Drive.") }
        }
    }

    @PluginMethod
    fun resolveFolderCode(call: PluginCall) {
        val codeOrLink = call.getString("codeOrLink", "").orEmpty()
        executor.execute {
            runCatching {
                val parsed = SyncRules.parseJoinInput(codeOrLink)
                val meta = if (parsed.remoteFolderId.isNotBlank()) {
                    api.getFolderMeta(parsed.remoteFolderId)
                } else {
                    api.findFolderByJoinCode(parsed.shortCode)
                        ?: throw IllegalArgumentException(
                            "Código ${parsed.shortCode} não encontrado nesta conta Google. Cole o link do Drive ou o código DS1 completo."
                        )
                }
                val detectedKind = when {
                    meta.kind == "master" || meta.kind == "personal" -> meta.kind
                    meta.shared -> "master"
                    else -> "personal"
                }
                val resolvedShort = parsed.shortCode.ifBlank { meta.joinCode }
                val out = JSONObject().apply {
                    put("remoteFolderId", meta.id)
                    put("remoteFolderName", meta.name)
                    if (resolvedShort.isNotBlank()) put("shortCode", resolvedShort)
                    put("kind", detectedKind)
                    if (meta.ownerEmail.isNotBlank()) put("ownerEmail", meta.ownerEmail)
                    if (meta.ownerName.isNotBlank()) put("ownerName", meta.ownerName)
                    put("canWrite", meta.canWrite)
                    put("matchedBy", parsed.matchedBy)
                }
                toJSObject(out)
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Código inválido.") }
        }
    }

    @PluginMethod
    fun generateFolderInvite(call: PluginCall) {
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        executor.execute {
            runCatching {
                val folder = db.getFolder(folderId)
                    ?: throw IllegalArgumentException("Pasta sincronizada não encontrada.")
                val existingShort = folder.shareCode.split('.').lastOrNull()
                    ?.takeIf { it.startsWith("DS-") }
                val shortCode = existingShort ?: DriveSyncConstants.generateShortCode()
                val fullCode = DriveSyncConstants.formatFullCode(folder.remoteFolderId, shortCode)
                db.upsertFolder(folder.copy(shareCode = fullCode))
                runCatching {
                    api.setFolderInviteMetadata(folder.remoteFolderId, folder.kind, shortCode, folder.name)
                }
                val out = JSONObject().apply {
                    put("folderId", folder.remoteFolderId)
                    put("folderName", folder.remoteFolderName)
                    put("shortCode", shortCode)
                    put("fullCode", fullCode)
                    put("driveUrl", "https://drive.google.com/drive/folders/${folder.remoteFolderId}")
                    put("kind", folder.kind)
                }
                toJSObject(out)
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao gerar código da pasta.") }
        }
    }

    @PluginMethod
    fun shareFolder(call: PluginCall) {
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        val input = call.getObject("input")
        if (input == null) {
            call.reject("Dados de compartilhamento ausentes.")
            return
        }
        executor.execute {
            runCatching {
                val remoteId = db.getFolder(folderId)?.remoteFolderId ?: folderId
                api.shareFolder(
                    folderId = remoteId,
                    accessType = input.getString("accessType") ?: "user",
                    role = input.getString("role") ?: "reader",
                    email = input.getString("email")
                )
                JSObject().apply { put("shared", true) }
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao compartilhar pasta.") }
        }
    }

    @PluginMethod
    fun createSyncFolder(call: PluginCall) {
        val inputObj = call.getObject("input")
        if (inputObj == null) {
            call.reject("Parâmetros da pasta ausentes.")
            return
        }
        executor.execute {
            runCatching {
                val rawJson = JSONObject(inputObj.toString())
                val localPath = rawJson.optString("localPath", "").trim()
                val remoteId = rawJson.optString("remoteFolderId", "").trim()
                require(localPath.isNotBlank()) { "Escolha uma pasta do celular primeiro." }
                require(remoteId.isNotBlank()) { "Escolha uma pasta do Google Drive." }
                val cfg = SyncFolderConfig.fromJson(rawJson).copy(
                    id = "",
                    createdAt = DriveSyncConstants.nowIsoUtc()
                )
                val saved = db.upsertFolder(cfg)
                DriveSyncWorker.applySchedule(context, db.getSettings())
                executor.execute {
                    runCatching {
                        api.ensureFolderKindMetadata(saved.remoteFolderId, saved.kind, saved.name)
                    }
                    runCatching { engine.syncAllFolders(saved.id) }
                }
                toJSObject(saved.toJson())
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao adicionar pasta.") }
        }
    }

    @PluginMethod
    fun updateSyncFolder(call: PluginCall) {
        val folderObj = call.getObject("folder")
        if (folderObj == null) {
            call.reject("Configuração da pasta ausente.")
            return
        }
        executor.execute {
            runCatching {
                val parsed = SyncFolderConfig.fromJson(JSONObject(folderObj.toString()))
                require(parsed.id.isNotBlank()) { "ID da pasta inválido." }
                val previous = db.getFolder(parsed.id)
                val saved = db.upsertFolder(parsed)
                if (previous != null && previous.paused && !saved.paused) {
                    executor.execute { runCatching { engine.syncAllFolders(saved.id) } }
                }
                toJSObject(saved.toJson())
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao atualizar pasta.") }
        }
    }

    @PluginMethod
    fun deleteSyncFolder(call: PluginCall) {
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        executor.execute {
            db.deleteFolder(folderId)
            call.resolve(JSObject().apply { put("deleted", true) })
        }
    }

    @PluginMethod
    fun forgetDevice(call: PluginCall) {
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        val deviceId = call.getString("deviceId", "")?.trim().orEmpty()
        executor.execute {
            db.forgetDevice(folderId, deviceId)
            call.resolve(JSObject().apply { put("ok", true) })
        }
    }

    @PluginMethod
    fun syncNow(call: PluginCall) {
        val folderId = call.getString("folderId", "")?.trim().orEmpty()
        if (!db.getAccountInfo().connected) {
            call.reject("Conecte sua conta Google antes de sincronizar.")
            return
        }
        executor.execute {
            runCatching {
                engine.syncAllFolders(folderId.ifBlank { null })
            }
            call.resolve(JSObject().apply { put("started", true) })
        }
    }

    @PluginMethod
    fun updateSettings(call: PluginCall) {
        val obj = call.getObject("settings")
        if (obj == null) {
            call.reject("Configurações ausentes.")
            return
        }
        executor.execute {
            runCatching {
                val cur = db.getSettings()
                val next = MobileSettings.fromJson(
                    JSONObject(obj.toString()),
                    cur.deviceId,
                    cur.deviceName
                )
                val saved = db.saveSettings(next)
                DriveSyncWorker.applySchedule(context, saved)
                toJSObject(saved.toJson())
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Erro ao salvar configurações.") }
        }
    }

    @PluginMethod
    fun checkForAppUpdate(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            val prefs = context.getSharedPreferences(UPDATE_PREFS_NAME, Context.MODE_PRIVATE)
            if (!prefs.getBoolean("asked_notif_perm", false)) {
                prefs.edit().putBoolean("asked_notif_perm", true).apply()
                activity?.let { act ->
                    act.runOnUiThread {
                        runCatching {
                            ActivityCompat.requestPermissions(
                                act,
                                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                                4102
                            )
                        }
                    }
                }
            }
        }

        executor.execute {
            runCatching {
                val res = checkGitHubLatestRelease()
                if (res.optBoolean("hasUpdate", false)) {
                    postUpdateNotificationIfNeeded(context, res.optString("latestVersion", ""))
                }
                toJSObject(res)
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Não foi possível verificar atualizações.") }
        }
    }

    @PluginMethod
    fun downloadAndInstallUpdate(call: PluginCall) {
        val rawUrl = call.getString("downloadUrl", "")?.trim().orEmpty()
        val targetUrl = if (rawUrl.startsWith("https://")) rawUrl else LATEST_APK_DOWNLOAD_URL

        executor.execute {
            runCatching {
                val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
                val apkFile = File(updatesDir, "DriveSync-update.apk")
                downloadFileWithRedirects(targetUrl, apkFile)

                val apkUri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    apkFile
                )
                val installIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(apkUri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }

                val launcher: (Intent) -> Unit = { intent ->
                    val act = activity
                    if (act != null) {
                        act.runOnUiThread { act.startActivity(intent) }
                    } else {
                        context.startActivity(intent)
                    }
                }

                runCatching {
                    launcher(installIntent)
                }.onFailure {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                        !context.packageManager.canRequestPackageInstalls()
                    ) {
                        val permIntent = Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:${context.packageName}")
                        ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                        launcher(permIntent)
                    } else {
                        launcher(
                            Intent(Intent.ACTION_VIEW, Uri.parse(targetUrl)).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                        )
                    }
                }

                JSObject().apply {
                    put("started", true)
                    put("mode", "apk_installer")
                }
            }.onSuccess { call.resolve(it) }
                .onFailure { call.reject(it.message ?: "Falha ao baixar atualização.") }
        }
    }

    private fun downloadFileWithRedirects(initialUrl: String, destFile: File) {
        var currentUrl = initialUrl
        for (hop in 0 until 6) {
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                instanceFollowRedirects = false
                connectTimeout = 15_000
                readTimeout = 60_000
                setRequestProperty("User-Agent", "DriveSync-Android/${BuildConfig.VERSION_NAME}")
            }
            try {
                val code = conn.responseCode
                if (code in listOf(301, 302, 303, 307, 308)) {
                    val location = conn.getHeaderField("Location").orEmpty()
                    if (location.isBlank()) {
                        throw IllegalStateException("Redirecionamento vazio ($code) ao baixar APK.")
                    }
                    currentUrl = URL(URL(currentUrl), location).toString()
                    continue
                }
                if (code !in 200..299) {
                    throw IllegalStateException("Servidor retornou HTTP $code ao baixar atualização.")
                }
                val tempFile = File(destFile.parentFile, "${destFile.name}.tmp")
                conn.inputStream.use { input ->
                    FileOutputStream(tempFile).use { output ->
                        val buffer = ByteArray(16 * 1024)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                        }
                    }
                }
                if (destFile.exists()) destFile.delete()
                if (!tempFile.renameTo(destFile)) {
                    tempFile.copyTo(destFile, overwrite = true)
                    tempFile.delete()
                }
                return
            } finally {
                conn.disconnect()
            }
        }
        throw IllegalStateException("Excesso de redirecionamentos ao baixar APK.")
    }

    companion object {
        private const val UPDATE_PREFS_NAME = "drivesync_update_prefs"
        private const val UPDATE_CHANNEL_ID = "drivesync_updates"
        private const val LATEST_RELEASE_API_URL =
            "https://api.github.com/repos/JoaoVitorSteffenDoNascimento/DriveSync/releases/latest"
        private const val LATEST_RELEASES_PAGE_URL =
            "https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases/latest"
        private const val LATEST_APK_DOWNLOAD_URL =
            "https://github.com/JoaoVitorSteffenDoNascimento/DriveSync/releases/latest/download/DriveSync-Android.apk"

        private fun normalizeSemVer(raw: String?): String {
            val cleaned = raw.orEmpty().trim().removePrefix("v").removePrefix("V")
            val match = Regex("^(\\d+)\\.(\\d+)\\.(\\d+)").find(cleaned) ?: return ""
            return "${match.groupValues[1].toInt()}.${match.groupValues[2].toInt()}.${match.groupValues[3].toInt()}"
        }

        private fun parseSemVerCode(raw: String): Int {
            val norm = normalizeSemVer(raw)
            if (norm.isBlank()) return 0
            val parts = norm.split('.')
            return parts[0].toInt() * 10000 + parts[1].toInt() * 100 + parts[2].toInt()
        }

        fun checkGitHubLatestRelease(): JSONObject {
            val conn = (URL(LATEST_RELEASE_API_URL).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10_000
                readTimeout = 12_000
                setRequestProperty("Accept", "application/vnd.github+json")
                setRequestProperty("User-Agent", "DriveSync-Android/${BuildConfig.VERSION_NAME}")
            }
            try {
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val bodyText = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
                if (code !in 200..299) {
                    throw IllegalStateException("GitHub Releases retornou HTTP $code.")
                }
                val payload = JSONObject(bodyText)
                val currentVersion = normalizeSemVer(BuildConfig.VERSION_NAME).ifBlank { BuildConfig.VERSION_NAME }
                val latestVersion = normalizeSemVer(payload.optString("tag_name", "")).ifBlank { currentVersion }
                val hasUpdate = parseSemVerCode(latestVersion) > parseSemVerCode(currentVersion)

                var assetName = "DriveSync-Android.apk"
                var downloadUrl = LATEST_APK_DOWNLOAD_URL
                var assetSizeBytes = 0L
                val assets = payload.optJSONArray("assets") ?: JSONArray()
                for (i in 0 until assets.length()) {
                    val item = assets.optJSONObject(i) ?: continue
                    val name = item.optString("name", "")
                    if (name.endsWith(".apk", ignoreCase = true)) {
                        assetName = name
                        downloadUrl = item.optString("browser_download_url", LATEST_APK_DOWNLOAD_URL)
                        assetSizeBytes = item.optLong("size", 0L)
                        break
                    }
                }

                val isoFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }

                return JSONObject().apply {
                    put("currentVersion", currentVersion)
                    put("latestVersion", latestVersion)
                    put("hasUpdate", hasUpdate)
                    put("releaseUrl", payload.optString("html_url", LATEST_RELEASES_PAGE_URL))
                    put("downloadUrl", downloadUrl)
                    put("assetName", assetName)
                    if (assetSizeBytes > 0L) put("assetSizeBytes", assetSizeBytes)
                    put("releaseNotes", payload.optString("body", ""))
                    put("publishedAt", payload.optString("published_at", ""))
                    put("checkedAt", isoFmt.format(Date()))
                }
            } finally {
                conn.disconnect()
            }
        }

        fun postUpdateNotificationIfNeeded(context: Context, latestVersion: String) {
            val clean = normalizeSemVer(latestVersion)
            if (clean.isBlank()) return

            val prefs = context.getSharedPreferences(UPDATE_PREFS_NAME, Context.MODE_PRIVATE)
            if (prefs.getString("notified_version", "") == clean) return

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                return
            }

            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    UPDATE_CHANNEL_ID,
                    "Atualizações do DriveSync",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Avisa quando uma nova versão do DriveSync está pronta para instalar."
                }
                nm.createNotificationChannel(channel)
            }

            val openIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = PendingIntent.getActivity(context, 4100, openIntent, piFlags)

            val smallIcon = if (context.applicationInfo.icon != 0) {
                context.applicationInfo.icon
            } else {
                android.R.drawable.stat_sys_download_done
            }

            val notification = NotificationCompat.Builder(context, UPDATE_CHANNEL_ID)
                .setSmallIcon(smallIcon)
                .setContentTitle("DriveSync v$clean disponível")
                .setContentText("Toque para abrir o app e atualizar em 1 clique.")
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent)
                .build()

            nm.notify(4100, notification)
            prefs.edit().putString("notified_version", clean).apply()
        }
    }

    private fun bindLoopbackSocket(): ServerSocket {
        val loopback = InetAddress.getByName("127.0.0.1")
        return runCatching {
            ServerSocket(53682, 2, loopback)
        }.getOrElse {
            ServerSocket(0, 2, loopback)
        }
    }

    private fun parseQuery(query: String): Map<String, String> {
        if (query.isBlank()) return emptyMap()
        val out = mutableMapOf<String, String>()
        for (pair in query.split('&')) {
            val idx = pair.indexOf('=')
            if (idx <= 0) continue
            val k = URLDecoder.decode(pair.substring(0, idx), "UTF-8")
            val v = URLDecoder.decode(pair.substring(idx + 1), "UTF-8")
            out[k] = v
        }
        return out
    }

    private fun writeHttpHtml(out: java.io.OutputStream, status: Int, html: String) {
        val body = html.toByteArray(StandardCharsets.UTF_8)
        val statusText = if (status == 200) "OK" else "Error"
        val headers = buildString {
            append("HTTP/1.1 $status $statusText\r\n")
            append("Content-Type: text/html; charset=UTF-8\r\n")
            append("Content-Length: ${body.size}\r\n")
            append("Connection: close\r\n\r\n")
        }.toByteArray(StandardCharsets.US_ASCII)
        out.write(headers)
        out.write(body)
        out.flush()
    }

    private fun buildResultHtml(title: String, detail: String): String = """
        <!doctype html>
        <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>$title</title>
          <style>
            body{font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;margin:0;text-align:center}
            .box{max-width:420px;background:#1e293b;padding:28px;border-radius:16px;border:1px solid rgba(255,255,255,.12)}
            a{display:inline-block;margin-top:16px;padding:13px 22px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700}
            p.sub{font-size:13px;color:#94a3b8;margin-top:14px}
          </style>
        </head>
        <body>
          <div class="box">
            <h2>$title</h2>
            <p>$detail</p>
            <a href="intent://oauth-done#Intent;scheme=com.drivesync.mobile;package=com.drivesync.mobile;end">Voltar ao DriveSync</a>
            <p class="sub">Se esta aba não fechar sozinha, toque no botão azul acima ou no X no canto da janela.</p>
          </div>
        </body>
        </html>
    """.trimIndent()

    private fun randomUrlSafe(byteCount: Int): String {
        val bytes = ByteArray(byteCount)
        SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    private fun toJSObject(obj: JSONObject): JSObject = JSObject(obj.toString())

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
}
