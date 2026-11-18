package com.drivesync.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.browser.customtabs.CustomTabsIntent
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
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors

@CapacitorPlugin(name = "DriveSyncNative")
class DriveSyncPlugin : Plugin() {

    private lateinit var db: MobileStateDb
    private lateinit var api: DriveApiClient
    private lateinit var engine: MobileSyncEngine
    private val executor = Executors.newCachedThreadPool()

    @Volatile
    private var activeAuthServer: ServerSocket? = null

    override fun load() {
        db = MobileStateDb(context)
        api = DriveApiClient(db)
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
        }
        return toJSObject(db.getAccountInfo().toJson())
    }

    @PluginMethod
    fun cancelGoogleOAuth(call: PluginCall) {
        runCatching { activeAuthServer?.close() }
        activeAuthServer = null
        call.resolve(JSObject().apply { put("ok", true) })
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
                                        "Conta Google conectada!",
                                        "Voltando automaticamente para o DriveSync..."
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
                    }
                }

                oauthError?.let { errMsg ->
                    call.reject(errMsg)
                    return@execute
                }

                val code = capturedCode ?: throw IllegalStateException("Código OAuth não recebido.")
                val token = api.exchangeOAuthCode(creds, code, redirectUri, verifier)
                db.saveToken(token)
                val (email, displayName) = api.aboutUser()
                db.saveAccountProfile(email, displayName)
                db.saveAuthSource("oauth_pkce")
                DriveSyncWorker.applySchedule(context, db.getSettings())
                call.resolve(toJSObject(db.getAccountInfo().toJson()))
            } catch (ex: Exception) {
                call.reject(ex.message ?: "Falha no login com Google.")
            } finally {
                if (activeAuthServer === server) {
                    activeAuthServer = null
                }
                runCatching { server?.close() }
            }
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
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
        }
        startActivityForResult(call, intent, "onLocalFolderPicked")
    }

    @ActivityCallback
    private fun onLocalFolderPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("Seleção de pasta cancelada.")
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            call.reject("Nenhuma pasta retornada pelo Android.")
            return
        }
        runCatching {
            val takeFlags = (result.data?.flags ?: 0) and
                (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            val fallbackFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            context.contentResolver.takePersistableUriPermission(
                uri,
                if (takeFlags != 0) takeFlags else fallbackFlags
            )
        }
        val doc = DocumentFile.fromTreeUri(context, uri)
        val label = doc?.name ?: uri.lastPathSegment ?: "Pasta do celular"
        call.resolve(JSObject().apply {
            put("uri", uri.toString())
            put("displayName", label)
        })
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
                    api.setFolderInviteMetadata(folder.remoteFolderId, folder.kind, shortCode)
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
                executor.execute { runCatching { engine.syncAllFolders(saved.id) } }
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
          <meta http-equiv="refresh" content="0;url=com.drivesync.mobile://oauth-done" />
          <title>$title</title>
          <style>
            body{font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;margin:0;text-align:center}
            .box{max-width:420px;background:#1e293b;padding:28px;border-radius:16px;border:1px solid rgba(255,255,255,.12)}
            a{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}
          </style>
        </head>
        <body>
          <div class="box">
            <h2>$title</h2>
            <p>$detail</p>
            <a href="com.drivesync.mobile://oauth-done">Voltar ao DriveSync</a>
          </div>
          <script>
            setTimeout(function() {
              window.location.href = "com.drivesync.mobile://oauth-done";
            }, 120);
          </script>
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
