package com.drivesync.mobile

import android.content.Context
import android.net.Uri
import android.os.Build
import android.webkit.MimeTypeMap
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class LocalSafFile(
    val relativePath: String,
    val doc: DocumentFile,
    val sizeBytes: Long,
    val modifiedMs: Long,
    val mimeType: String
)

class MobileSyncEngine(
    private val context: Context,
    private val db: MobileStateDb,
    private val api: DriveApiClient
) {

    companion object {
        private val syncLock = Any()
    }

    fun syncAllFolders(singleFolderId: String? = null) {
        synchronized(syncLock) {
            val account = db.getAccountInfo()
            if (!account.connected) {
                throw IllegalStateException("Conecte sua conta Google antes de sincronizar.")
            }
            if (singleFolderId.isNullOrBlank()) {
                runCatching { discoverAndCacheAccountFolders() }
            }
            val folders = db.listFolders().filter {
                !it.paused && (singleFolderId.isNullOrBlank() || it.id == singleFolderId)
            }
            for (folder in folders) {
                syncFolderInternal(folder, account)
            }
        }
    }

    fun discoverAndCacheAccountFolders(): List<DiscoveredRemoteFolder> {
        val account = db.getAccountInfo()
        if (!account.connected) return emptyList()
        val settings = db.getSettings()
        val existingFolders = db.listFolders()
        val connectedRemoteIds = existingFolders.map { it.remoteFolderId }.toSet()

        val all = api.discoverAccountFolders(settings.deviceId)
        for (item in all) {
            val targetFolderId = existingFolders.firstOrNull { it.remoteFolderId == item.remoteFolderId }?.id
                ?: item.remoteFolderId
            if (item.devices.isNotEmpty()) {
                val mappedDevs = item.devices.map { d ->
                    d.copy(
                        folderId = targetFolderId,
                        isCurrentDevice = d.deviceId == settings.deviceId
                    )
                }
                db.replaceRemoteDevicesForFolder(targetFolderId, mappedDevs)
            }
        }

        val pending = all.filter { !connectedRemoteIds.contains(it.remoteFolderId) }
        db.saveDiscoveredFolders(pending)

        if (pending.isNotEmpty() && settings.autoSyncAccountFolders && settings.syncRootUri.isNotBlank()) {
            runCatching {
                connectDiscoveredFolders(Uri.parse(settings.syncRootUri), pending, createSubfolders = true)
            }
        }
        return db.getDiscoveredFolders().filter { item ->
            db.listFolders().none { it.remoteFolderId == item.remoteFolderId }
        }
    }

    fun connectDiscoveredFolders(
        targetTreeUri: Uri,
        targets: List<DiscoveredRemoteFolder>,
        createSubfolders: Boolean = true
    ): List<SyncFolderConfig> {
        val rootDoc = DocumentFile.fromTreeUri(context, targetTreeUri)
            ?: throw IllegalStateException("Sem permissão na pasta selecionada do celular.")
        val settings = db.getSettings()
        val existing = db.listFolders()
        val connectedRemote = existing.map { it.remoteFolderId }.toMutableSet()
        val connectedLocal = existing.map { it.localPath.trimEnd('/') }.toMutableSet()
        val created = mutableListOf<SyncFolderConfig>()

        for (item in targets) {
            if (item.remoteFolderId.isBlank() || connectedRemote.contains(item.remoteFolderId)) continue
            val cleanName = item.remoteFolderName
                .replace('/', '-')
                .replace('\\', '-')
                .trim()
                .ifBlank { "Pasta-${item.remoteFolderId.take(6)}" }
            val destDoc = resolveTargetFolderDoc(
                rootDoc = rootDoc,
                cleanName = cleanName,
                remoteFolderId = item.remoteFolderId,
                createSubfolders = createSubfolders,
                singleTarget = targets.size == 1
            )
            val destUriKey = destDoc.uri.toString().trimEnd('/')
            if (connectedLocal.contains(destUriKey)) {
                connectedRemote.add(item.remoteFolderId)
                continue
            }
            val policy = item.senderPolicy ?: SenderPolicy(
                mode = if (item.kind == "master") "blocklist" else "all",
                unknownSenderAction = "allow",
                rules = emptyList()
            )
            val cfg = SyncFolderConfig(
                id = "",
                name = cleanName,
                localPath = destDoc.uri.toString(),
                remoteFolderId = item.remoteFolderId,
                remoteFolderName = item.remoteFolderName,
                kind = if (item.kind == "personal") "personal" else "master",
                direction = if (item.canWrite) item.direction else "receive_only",
                onRemoteDelete = item.onRemoteDelete.ifBlank { settings.defaultOnRemoteDelete },
                onLocalDelete = item.onLocalDelete.ifBlank { "ignore" },
                senderPolicy = policy,
                paused = false,
                shareCode = item.shortCode,
                createdAt = DriveSyncConstants.nowIsoUtc()
            )
            val saved = db.upsertFolder(cfg)
            created.add(saved)
            connectedRemote.add(item.remoteFolderId)
            connectedLocal.add(destUriKey)
        }
        db.saveDiscoveredFolders(
            db.getDiscoveredFolders().filter { !connectedRemote.contains(it.remoteFolderId) }
        )
        return created
    }

    private fun resolveTargetFolderDoc(
        rootDoc: DocumentFile,
        cleanName: String,
        remoteFolderId: String,
        createSubfolders: Boolean,
        singleTarget: Boolean
    ): DocumentFile {
        if (!createSubfolders) return rootDoc

        // 1) Se a pasta escolhida já se chama igual (ex.: usuário selecionou a pasta "Teste"), não cria Teste/Teste!
        val rootName = rootDoc.name?.trim().orEmpty()
        if (rootName.equals(cleanName, ignoreCase = true)) {
            return rootDoc
        }

        // 2) Se já existir subpasta com o nome esperado dentro da pasta escolhida, reutiliza (case-insensitive)
        val existingChild = findChildDirIgnoreCase(rootDoc, cleanName)
        if (existingChild != null) {
            return existingChild
        }

        // 3) Se a pasta escolhida já contém marcador .drivesync ou arquivos correspondentes ao Drive remoto, usa ela própria
        if (singleTarget || rootDoc.listFiles().any { it.isFile }) {
            val hasControlMarker = findChildDirIgnoreCase(rootDoc, DriveSyncConstants.CONTROL_DIR) != null
            if (hasControlMarker) {
                return rootDoc
            }
            val remoteSample = runCatching { api.listTree(remoteFolderId) }.getOrDefault(emptyList())
            if (remoteSample.isNotEmpty()) {
                val remoteNames = remoteSample.map { it.relativePath.lowercase(Locale.US) }.toSet()
                val localMatches = walkSafTree(rootDoc).any { remoteNames.contains(it.relativePath.lowercase(Locale.US)) }
                if (localMatches) {
                    return rootDoc
                }
            }
        }

        return findOrCreateChildDir(rootDoc, cleanName)
            ?: throw IllegalStateException("Não foi possível criar subpasta $cleanName no celular.")
    }

    private fun findChildDirIgnoreCase(parent: DocumentFile, name: String): DocumentFile? {
        val target = name.trim()
        if (target.isBlank()) return null
        val exact = parent.findFile(target)
        if (exact != null && exact.isDirectory) return exact
        return parent.listFiles().firstOrNull {
            it.isDirectory && (it.name?.trim()?.equals(target, ignoreCase = true) == true)
        }
    }

    fun importDocumentUris(folderId: String, subpath: String, uris: List<Uri>): Pair<Int, List<String>> {
        val folder = db.getFolder(folderId) ?: throw IllegalArgumentException("Pasta não encontrada.")
        val rootDoc = DocumentFile.fromTreeUri(context, Uri.parse(folder.localPath))
            ?: throw IllegalStateException("Pasta local no celular inacessível. Selecione novamente.")
        val baseSegments = sanitizeSubpathSegments(subpath)
        var added = 0
        val skippedOver4Gb = mutableListOf<String>()
        for (srcUri in uris) {
            val srcDoc = DocumentFile.fromSingleUri(context, srcUri) ?: continue
            val name = srcDoc.name ?: "arquivo-${System.currentTimeMillis()}"
            if (copySafFileWithLimit(folder, rootDoc, baseSegments + name, srcDoc, skippedOver4Gb)) {
                added++
            }
        }
        return added to skippedOver4Gb
    }

    fun importDirectoryTree(folderId: String, subpath: String, treeUri: Uri): Pair<Int, List<String>> {
        val folder = db.getFolder(folderId) ?: throw IllegalArgumentException("Pasta não encontrada.")
        val rootDoc = DocumentFile.fromTreeUri(context, Uri.parse(folder.localPath))
            ?: throw IllegalStateException("Pasta local no celular inacessível. Selecione novamente.")
        val srcRoot = DocumentFile.fromTreeUri(context, treeUri)
            ?: throw IllegalStateException("Pasta de origem escolhida inacessível.")
        val topName = srcRoot.name?.takeIf { it.isNotBlank() } ?: "Importado"
        val baseSegments = sanitizeSubpathSegments(subpath) + topName
        var added = 0
        val skippedOver4Gb = mutableListOf<String>()

        fun walkAndImport(dir: DocumentFile, currentSegments: List<String>) {
            for (child in dir.listFiles()) {
                val childName = child.name ?: continue
                val rel = (currentSegments + childName).joinToString("/")
                if (SyncRules.shouldIgnoreRelativePath(rel)) continue
                if (child.isDirectory) {
                    var targetDir = rootDoc
                    for (seg in currentSegments + childName) {
                        targetDir = findOrCreateChildDir(targetDir, seg)
                            ?: throw IllegalStateException("Não foi possível criar subpasta $seg.")
                    }
                    walkAndImport(child, currentSegments + childName)
                } else if (child.isFile) {
                    if (copySafFileWithLimit(folder, rootDoc, currentSegments + childName, child, skippedOver4Gb)) {
                        added++
                    }
                }
            }
        }

        walkAndImport(srcRoot, baseSegments)
        return added to skippedOver4Gb
    }

    private fun copySafFileWithLimit(
        folder: SyncFolderConfig,
        rootDoc: DocumentFile,
        destSegments: List<String>,
        srcDoc: DocumentFile,
        skippedOver4Gb: MutableList<String>
    ): Boolean {
        val name = destSegments.lastOrNull() ?: "arquivo"
        val relPath = destSegments.joinToString("/")
        val size = queryUriSize(srcDoc.uri, srcDoc.length())
        if (SyncRules.exceedsUploadLimit(size)) {
            skippedOver4Gb.add(relPath)
            db.recordBlockedFile(
                folderId = folder.id,
                folderName = folder.name,
                relativePath = relPath,
                localPath = srcDoc.uri.toString(),
                fileSizeBytes = size,
                authorEmail = db.getAccountInfo().email,
                authorName = db.getAccountInfo().displayName,
                reason = "exceeds_4gb",
                detail = "Bloqueado na importação por exceder o limite fixo de 4 GB."
            )
            return false
        }
        val mime = srcDoc.type ?: guessMime(name)
        val dest = createOrReplaceFile(rootDoc, destSegments, mime)
            ?: throw IllegalStateException("Não foi possível gravar $relPath na pasta escolhida.")
        context.contentResolver.openInputStream(srcDoc.uri)?.use { input ->
            context.contentResolver.openOutputStream(dest.uri, "wt")?.use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    out.write(buf, 0, n)
                }
            }
        }
        return true
    }

    fun listFolderContents(folderId: String, subpath: String): JSONObject {
        val folder = db.getFolder(folderId) ?: throw IllegalArgumentException("Pasta não encontrada.")
        val rootDoc = DocumentFile.fromTreeUri(context, Uri.parse(folder.localPath))
            ?: throw IllegalStateException("Pasta local no celular inacessível.")
        val segments = sanitizeSubpathSegments(subpath)
        var current = rootDoc
        for (seg in segments) {
            current = current.findFile(seg)?.takeIf { it.isDirectory }
                ?: throw IllegalArgumentException("Subpasta não encontrada: $seg")
        }
        val normalizedSubpath = segments.joinToString("/")
        val isoFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val baseline = db.listSyncedFiles(folder.id)
        val rt = db.getRuntime(folder.id)
        val account = db.getAccountInfo()
        val defaultSenderName = account.displayName.ifBlank { account.email }
        val items = current.listFiles()
            .mapNotNull { child ->
                val name = child.name ?: return@mapNotNull null
                val rel = if (normalizedSubpath.isEmpty()) name else "$normalizedSubpath/$name"
                if (SyncRules.shouldIgnoreRelativePath(rel)) return@mapNotNull null
                val isDir = child.isDirectory
                val size = if (isDir) 0L else queryUriSize(child.uri, child.length())
                val mtime = child.lastModified()
                var syncStatus = ""
                var senderName = ""
                var senderEmail = ""
                if (!isDir) {
                    val syncedRow = baseline[rel]
                    when {
                        SyncRules.exceedsUploadLimit(size) -> {
                            syncStatus = "blocked_4gb"
                            senderName = defaultSenderName
                            senderEmail = account.email
                        }
                        rt?.status == "syncing" && rt.currentFile == rel -> {
                            syncStatus = "sending"
                            senderName = rt.currentAuthor.ifBlank { defaultSenderName }
                            senderEmail = account.email
                        }
                        syncedRow != null && !syncedRow.deletedOnRemote -> {
                            syncStatus = "synced"
                            senderName = syncedRow.authorName.ifBlank { syncedRow.authorEmail.ifBlank { defaultSenderName } }
                            senderEmail = syncedRow.authorEmail.ifBlank { account.email }
                        }
                        folder.direction == "receive_only" -> {
                            syncStatus = "local_only"
                            senderName = defaultSenderName
                            senderEmail = account.email
                        }
                        else -> {
                            syncStatus = "pending"
                            senderName = defaultSenderName
                            senderEmail = account.email
                        }
                    }
                }
                Triple(isDir, name.lowercase(Locale.US), JSONObject().apply {
                    put("name", name)
                    put("relativePath", rel)
                    put("isDir", isDir)
                    put("sizeBytes", size)
                    put("modifiedAt", if (mtime > 0) isoFmt.format(Date(mtime)) else "")
                    put("exceeds4gb", !isDir && SyncRules.exceedsUploadLimit(size))
                    if (syncStatus.isNotBlank()) put("syncStatus", syncStatus)
                    if (senderName.isNotBlank()) put("senderName", senderName)
                    if (senderEmail.isNotBlank()) put("senderEmail", senderEmail)
                })
            }
            .sortedWith(compareBy<Triple<Boolean, String, JSONObject>>({ !it.first }, { it.second }))

        val arr = JSONArray()
        items.forEach { arr.put(it.third) }
        return JSONObject().apply {
            put("folderId", folder.id)
            put("folderName", folder.name)
            put("localPath", folder.localPath)
            put("subpath", normalizedSubpath)
            put("items", arr)
        }
    }

    fun createSubfolder(folderId: String, subpath: String, name: String) {
        val clean = name.trim()
        require(clean.isNotEmpty() && !clean.contains('/') && !clean.contains('\\') && clean != "." && clean != "..") {
            "Nome de subpasta inválido."
        }
        val folder = db.getFolder(folderId) ?: throw IllegalArgumentException("Pasta não encontrada.")
        val rootDoc = DocumentFile.fromTreeUri(context, Uri.parse(folder.localPath))
            ?: throw IllegalStateException("Pasta local no celular inacessível.")
        var dir = rootDoc
        for (seg in sanitizeSubpathSegments(subpath)) {
            dir = findOrCreateChildDir(dir, seg)
                ?: throw IllegalStateException("Falha ao acessar subpasta $seg.")
        }
        findOrCreateChildDir(dir, clean)
            ?: throw IllegalStateException("Não foi possível criar a subpasta $clean.")
    }

    private fun sanitizeSubpathSegments(subpath: String): List<String> =
        subpath.replace('\\', '/').split('/')
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != "." && it != ".." }

    private fun syncFolderInternal(folder: SyncFolderConfig, account: AccountInfo) {
        val settings = db.getSettings()
        val startedAt = DriveSyncConstants.nowIsoUtc()
        db.updateRuntime(
            FolderRuntimeState(
                folderId = folder.id,
                status = "syncing",
                message = "Comparando pasta local e Google Drive...",
                lastSyncAt = startedAt
            )
        )

        try {
            val rootDoc = DocumentFile.fromTreeUri(context, Uri.parse(folder.localPath))
            if (rootDoc == null || !rootDoc.exists() || !rootDoc.canRead()) {
                throw IllegalStateException("Sem permissão de acesso à pasta selecionada no celular.")
            }

            val remoteFiles = api.listTree(folder.remoteFolderId)
            val remoteByPath = remoteFiles.associateBy { it.relativePath }
            val remoteByLower = remoteFiles.associateBy { it.relativePath.lowercase(Locale.US) }
            val rawLocalFiles = walkSafTree(rootDoc)
            val localFiles = filterAndCleanSelfNestedDuplicates(folder, rootDoc, rawLocalFiles, remoteByLower)
            val localByPath = localFiles.associateBy { it.relativePath }
            val localByLower = localFiles.associateBy { it.relativePath.lowercase(Locale.US) }
            val baseline = db.listSyncedFiles(folder.id)

            var uploads = 0
            var downloads = 0
            var keptCount = 0
            var reconciledCount = 0

            // 1. Avaliar arquivos existentes no Drive
            for (rf in remoteFiles) {
                if (folder.kind == "master" && rf.authorEmail.isNotBlank()) {
                    db.upsertKnownSender(folder.id, rf.authorEmail, rf.authorName)
                }
                if (folder.kind == "master" &&
                    rf.authorEmail.isNotBlank() &&
                    !SyncRules.isSenderAllowed(folder.senderPolicy, rf.authorEmail)
                ) {
                    val prev = baseline[rf.relativePath]
                    db.recordBlockedFile(
                        folderId = folder.id,
                        folderName = folder.name,
                        relativePath = rf.relativePath,
                        fileSizeBytes = rf.sizeBytes,
                        authorEmail = rf.authorEmail,
                        authorName = rf.authorName,
                        reason = "sender_blocked",
                        detail = "Remetente bloqueado pela regra da Pasta Mestre (${folder.senderPolicy.mode})."
                    )
                    if (prev?.lastAction != "blocked_sender") {
                        db.recordActivity(
                            folderId = folder.id,
                            folderName = folder.name,
                            kind = "blocked_sender",
                            level = "warning",
                            message = "Arquivo bloqueado pelo filtro de remetente (${rf.authorEmail}): ${rf.relativePath}",
                            relativePath = rf.relativePath,
                            authorEmail = rf.authorEmail,
                            fileSizeBytes = rf.sizeBytes
                        )
                    }
                    db.upsertSyncedFile(
                        (prev ?: SyncedFileRow(folder.id, rf.relativePath)).copy(
                            remoteFileId = rf.id,
                            remoteSize = rf.sizeBytes,
                            remoteModifiedAt = rf.modifiedTime,
                            remoteMd5 = rf.md5Checksum,
                            lastAction = "blocked_sender"
                        )
                    )
                    continue
                }

                db.clearBlockedFile(folder.id, rf.relativePath)
                val prev = baseline[rf.relativePath]
                val local = localByPath[rf.relativePath] ?: localByLower[rf.relativePath.lowercase(Locale.US)]

                if (local != null) {
                    val localHash = resolveLocalHash(local, prev)
                    val remoteMatchesLocal =
                        (rf.md5Checksum.isNotBlank() && localHash.isNotBlank() &&
                            rf.md5Checksum.equals(localHash, ignoreCase = true)) ||
                            (prev == null && local.sizeBytes == rf.sizeBytes &&
                                (rf.md5Checksum.isBlank() || localHash.isBlank()))
                    val remoteUnchanged = prev != null &&
                        prev.remoteFileId == rf.id &&
                        ((rf.md5Checksum.isNotBlank() && rf.md5Checksum.equals(prev.remoteMd5, ignoreCase = true)) ||
                            (rf.md5Checksum.isBlank() && rf.modifiedTime == prev.remoteModifiedAt))
                    val localUnchanged = prev != null &&
                        prev.localSize == local.sizeBytes &&
                        (prev.localMtimeMs == local.modifiedMs || (localHash.isNotBlank() && localHash.equals(prev.localHash, ignoreCase = true)))

                    if (remoteMatchesLocal || (remoteUnchanged && localUnchanged)) {
                        if (prev == null) {
                            reconciledCount++
                        }
                        db.upsertSyncedFile(
                            SyncedFileRow(
                                folderId = folder.id,
                                relativePath = rf.relativePath,
                                remoteFileId = rf.id,
                                localUri = local.doc.uri.toString(),
                                localSize = local.sizeBytes,
                                localMtimeMs = local.modifiedMs,
                                localHash = localHash,
                                remoteSize = rf.sizeBytes,
                                remoteModifiedAt = rf.modifiedTime,
                                remoteMd5 = rf.md5Checksum,
                                lastAction = "synced",
                                authorEmail = rf.authorEmail.ifBlank { prev?.authorEmail ?: account.email },
                                authorName = rf.authorName.ifBlank { prev?.authorName ?: account.displayName }
                            )
                        )
                        continue
                    }

                    if (remoteUnchanged && !localUnchanged) {
                        if (folder.direction == "bidirectional") {
                            if (uploadExistingOrNew(folder, account, local, existingRemoteId = rf.id, localHash = localHash)) {
                                uploads++
                            }
                        }
                        continue
                    }

                    if (!remoteUnchanged && !localUnchanged && prev != null && folder.direction == "bidirectional") {
                        saveConflictCopy(rootDoc, local)
                    }

                    downloadToSaf(folder, rootDoc, rf)
                    downloads++
                } else {
                    if (prev != null && !prev.deletedOnRemote && prev.lastAction != "trashed_local") {
                        val sameRemote = prev.remoteFileId == rf.id &&
                            ((rf.md5Checksum.isNotBlank() && rf.md5Checksum.equals(prev.remoteMd5, ignoreCase = true)) ||
                                rf.modifiedTime == prev.remoteModifiedAt)
                        if (sameRemote) {
                            if (folder.onLocalDelete == "trash_remote" &&
                                folder.direction == "bidirectional" &&
                                !prev.ignoredLocalDelete
                            ) {
                                api.trashFile(rf.id)
                                db.deleteSyncedFile(folder.id, rf.relativePath)
                                db.recordActivity(
                                    folderId = folder.id,
                                    folderName = folder.name,
                                    kind = "trashed_local",
                                    level = "info",
                                    message = "Exclusão local espelhada para a Lixeira do Drive: ${rf.relativePath}",
                                    relativePath = rf.relativePath
                                )
                            } else {
                                db.upsertSyncedFile(prev.copy(ignoredLocalDelete = true, lastAction = "ignored_local_delete"))
                            }
                            continue
                        }
                    }

                    downloadToSaf(folder, rootDoc, rf)
                    downloads++
                }
            }

            // 2. Avaliar arquivos apagados no Google Drive
            for ((rel, prev) in baseline) {
                if (remoteByPath.containsKey(rel) || remoteByLower.containsKey(rel.lowercase(Locale.US))) continue
                val local = localByPath[rel] ?: localByLower[rel.lowercase(Locale.US)]
                if (local == null) {
                    db.deleteSyncedFile(folder.id, rel)
                    continue
                }
                if (prev.deletedOnRemote) {
                    val hashNow = resolveLocalHash(local, prev)
                    val modifiedSinceKeep = (prev.keptLocalHash.isNotBlank() && hashNow != prev.keptLocalHash) ||
                        (prev.keptLocalMtimeMs > 0L && local.modifiedMs != prev.keptLocalMtimeMs && local.sizeBytes != prev.localSize)
                    if (!modifiedSinceKeep) {
                        keptCount++
                        continue
                    }
                    // Usuário modificou localmente após exclusão remota: tratar como arquivo novo abaixo
                    db.deleteSyncedFile(folder.id, rel)
                    continue
                }

                if (folder.onRemoteDelete == "mirror_trash") {
                    moveLocalToQuarantine(rootDoc, local)
                    db.deleteSyncedFile(folder.id, rel)
                    db.recordActivity(
                        folderId = folder.id,
                        folderName = folder.name,
                        kind = "trashed_local",
                        level = "warning",
                        message = "Apagado no Drive e movido para quarentena local: $rel",
                        relativePath = rel,
                        fileSizeBytes = local.sizeBytes
                    )
                } else {
                    val hashNow = resolveLocalHash(local, prev)
                    db.upsertSyncedFile(
                        prev.copy(
                            remoteFileId = "",
                            deletedOnRemote = true,
                            keptLocalHash = hashNow,
                            keptLocalMtimeMs = local.modifiedMs,
                            lastAction = "kept_local"
                        )
                    )
                    keptCount++
                    db.recordActivity(
                        folderId = folder.id,
                        folderName = folder.name,
                        kind = "kept_local",
                        level = "info",
                        message = "Apagado no Drive e mantido no celular com segurança: $rel",
                        relativePath = rel,
                        fileSizeBytes = local.sizeBytes
                    )
                }
            }

            // 3. Enviar novos arquivos locais (quando bidirecional)
            if (folder.direction == "bidirectional") {
                val refreshedBaseline = db.listSyncedFiles(folder.id)
                for (local in localFiles) {
                    if (remoteByPath.containsKey(local.relativePath) ||
                        remoteByLower.containsKey(local.relativePath.lowercase(Locale.US))
                    ) {
                        continue
                    }
                    val prev = refreshedBaseline[local.relativePath]
                    if (prev?.deletedOnRemote == true) {
                        val hashNow = resolveLocalHash(local, prev)
                        if (hashNow == prev.keptLocalHash || prev.keptLocalHash.isBlank()) {
                            continue
                        }
                    }

                    if (SyncRules.exceedsUploadLimit(local.sizeBytes)) {
                        db.recordBlockedFile(
                            folderId = folder.id,
                            folderName = folder.name,
                            relativePath = local.relativePath,
                            localPath = local.doc.uri.toString(),
                            fileSizeBytes = local.sizeBytes,
                            authorEmail = account.email,
                            authorName = account.displayName,
                            reason = "exceeds_4gb",
                            detail = "Arquivo acima do limite fixo de 4 GB não será enviado."
                        )
                        if (prev?.lastAction != "blocked_4gb") {
                            db.recordActivity(
                                folderId = folder.id,
                                folderName = folder.name,
                                kind = "blocked_4gb",
                                level = "warning",
                                message = "Envio bloqueado (> 4 GB): ${local.relativePath}",
                                relativePath = local.relativePath,
                                fileSizeBytes = local.sizeBytes
                            )
                            db.upsertSyncedFile(
                                SyncedFileRow(
                                    folderId = folder.id,
                                    relativePath = local.relativePath,
                                    localUri = local.doc.uri.toString(),
                                    localSize = local.sizeBytes,
                                    localMtimeMs = local.modifiedMs,
                                    lastAction = "blocked_4gb"
                                )
                            )
                        }
                        continue
                    }

                    db.clearBlockedFile(folder.id, local.relativePath)
                    val hash = resolveLocalHash(local, prev)
                    if (uploadExistingOrNew(folder, account, local, existingRemoteId = null, localHash = hash)) {
                        uploads++
                    }
                }
            }

            // 4. Presença multi-dispositivo (.drivesync/devices) + perfil na nuvem
            runCatching {
                val selfReg = DeviceRegistration(
                    deviceId = settings.deviceId,
                    deviceName = settings.deviceName,
                    platform = "android",
                    arch = Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64",
                    appVersion = BuildConfig.VERSION_NAME,
                    accountEmail = account.email,
                    syncMode = folder.direction,
                    folderId = folder.id,
                    status = "online",
                    lastSeenAt = DriveSyncConstants.nowIsoUtc(),
                    isCurrentDevice = true
                )
                if (folder.direction == "bidirectional") {
                    api.ensureFolderKindMetadata(folder.remoteFolderId, folder.kind, folder.name)
                    api.writeControlJson(
                        folder.remoteFolderId,
                        "${settings.deviceId}.json",
                        selfReg.toJson().toString(2)
                    )
                    val profJson = DiscoveredRemoteFolder(
                        remoteFolderId = folder.remoteFolderId,
                        remoteFolderName = folder.name,
                        kind = folder.kind,
                        shortCode = folder.shareCode,
                        onRemoteDelete = folder.onRemoteDelete,
                        onLocalDelete = folder.onLocalDelete,
                        direction = folder.direction,
                        senderPolicy = folder.senderPolicy
                    ).toJson().toString(2)
                    api.writeFolderProfileJson(folder.remoteFolderId, profJson)
                }
                val remoteDevs = api.listControlJsons(folder.remoteFolderId, folder.id, settings.deviceId)
                    .ifEmpty { listOf(selfReg) }
                db.replaceRemoteDevicesForFolder(folder.id, remoteDevs)
            }

            val summaryState = db.buildRuntimeState(folder)
            val hasWarnings = summaryState.blocked4gbCount > 0 || summaryState.ignoredSenderCount > 0
            val msg = buildString {
                append("Em dia")
                if (downloads > 0 || uploads > 0) {
                    append(" • $downloads baixado(s), $uploads enviado(s)")
                }
                if (reconciledCount > 0) {
                    append(" • $reconciledCount já existente(s) aproveitado(s)")
                }
                if (keptCount > 0) {
                    append(" • $keptCount mantido(s) localmente")
                }
            }
            db.updateRuntime(
                summaryState.copy(
                    status = if (hasWarnings) "warning" else "ok",
                    message = msg,
                    lastSyncAt = DriveSyncConstants.nowIsoUtc(),
                    currentFile = "",
                    progressPercent = 0
                )
            )
        } catch (ex: Exception) {
            val errMsg = ex.message ?: "Erro ao sincronizar pasta."
            db.recordActivity(
                folderId = folder.id,
                folderName = folder.name,
                kind = "sync_error",
                level = "error",
                message = errMsg
            )
            db.updateRuntime(
                db.buildRuntimeState(folder).copy(
                    status = "error",
                    message = errMsg,
                    lastSyncAt = DriveSyncConstants.nowIsoUtc()
                )
            )
            throw ex
        }
    }

    private fun downloadToSaf(
        folder: SyncFolderConfig,
        rootDoc: DocumentFile,
        rf: DriveRemoteFile
    ) {
        val segments = rf.relativePath.split('/').filter { it.isNotBlank() }
        if (segments.isEmpty()) return
        val senderLabel = rf.authorName.ifBlank { rf.authorEmail.ifBlank { "Google Drive" } }
        db.updateRuntime(
            db.buildRuntimeState(folder).copy(
                status = "syncing",
                message = "Baixando ${rf.relativePath}",
                currentFile = rf.relativePath,
                currentAction = "download",
                currentAuthor = senderLabel,
                bytesTotal = rf.sizeBytes
            )
        )
        val destDoc = createOrReplaceFile(rootDoc, segments, rf.mimeType.ifBlank { guessMime(rf.name) })
            ?: throw IllegalStateException("Não foi possível criar arquivo local: ${rf.relativePath}")
        context.contentResolver.openOutputStream(destDoc.uri, "wt")?.use { out ->
            api.downloadFile(rf.id, out)
        } ?: throw IllegalStateException("Falha ao abrir saída para ${rf.relativePath}")

        val localHash = computeMd5(destDoc.uri).ifBlank { rf.md5Checksum }
        val updatedSize = queryUriSize(destDoc.uri, destDoc.length())
        db.upsertSyncedFile(
            SyncedFileRow(
                folderId = folder.id,
                relativePath = rf.relativePath,
                remoteFileId = rf.id,
                localUri = destDoc.uri.toString(),
                localSize = updatedSize,
                localMtimeMs = destDoc.lastModified(),
                localHash = localHash,
                remoteSize = rf.sizeBytes,
                remoteModifiedAt = rf.modifiedTime,
                remoteMd5 = rf.md5Checksum,
                lastAction = "download",
                authorEmail = rf.authorEmail,
                authorName = rf.authorName
            )
        )
        db.recordActivity(
            folderId = folder.id,
            folderName = folder.name,
            kind = "download",
            level = "success",
            message = "Baixado do Drive: ${rf.relativePath}",
            relativePath = rf.relativePath,
            authorEmail = rf.authorEmail,
            fileSizeBytes = rf.sizeBytes
        )
    }

    private fun filterAndCleanSelfNestedDuplicates(
        folder: SyncFolderConfig,
        rootDoc: DocumentFile,
        rawLocalFiles: List<LocalSafFile>,
        remoteByLower: Map<String, DriveRemoteFile>
    ): List<LocalSafFile> {
        val selfNames = listOf(folder.name, folder.remoteFolderName)
            .map { it.trim().lowercase(Locale.US) }
            .filter { it.isNotBlank() }
            .toSet()
        if (selfNames.isEmpty()) return rawLocalFiles

        val rootLocalLower = rawLocalFiles.associateBy { it.relativePath.lowercase(Locale.US) }
        val filtered = mutableListOf<LocalSafFile>()
        val prunedDirs = mutableSetOf<String>()

        for (item in rawLocalFiles) {
            val slashIdx = item.relativePath.indexOf('/')
            if (slashIdx > 0) {
                val topSeg = item.relativePath.substring(0, slashIdx)
                val innerRel = item.relativePath.substring(slashIdx + 1)
                if (selfNames.contains(topSeg.lowercase(Locale.US))) {
                    val innerLower = innerRel.lowercase(Locale.US)
                    val rootLocalMatch = rootLocalLower[innerLower]
                    val remoteRootMatch = remoteByLower[innerLower]
                    val matchesRoot = (rootLocalMatch != null && rootLocalMatch.sizeBytes == item.sizeBytes) ||
                        (remoteRootMatch != null && remoteRootMatch.sizeBytes == item.sizeBytes)
                    if (matchesRoot) {
                        if (rootLocalMatch != null && !remoteByLower.containsKey(item.relativePath.lowercase(Locale.US))) {
                            runCatching { item.doc.delete() }
                            prunedDirs.add(topSeg)
                        }
                        continue
                    }
                }
            }
            filtered.add(item)
        }

        for (dirName in prunedDirs) {
            runCatching {
                val sub = findChildDirIgnoreCase(rootDoc, dirName)
                if (sub != null && sub.listFiles().isEmpty()) {
                    sub.delete()
                }
            }
        }
        return filtered
    }

    private fun uploadExistingOrNew(
        folder: SyncFolderConfig,
        account: AccountInfo,
        local: LocalSafFile,
        existingRemoteId: String?,
        localHash: String
    ): Boolean {
        val segments = local.relativePath.split('/').filter { it.isNotBlank() }
        if (segments.isEmpty()) return false
        val parentFolderId = if (existingRemoteId != null || segments.size == 1) {
            folder.remoteFolderId
        } else {
            api.ensureSubfolderPath(folder.remoteFolderId, segments.dropLast(1))
        }
        var targetRemoteId = existingRemoteId
        if (targetRemoteId == null) {
            val remoteDup = runCatching { api.findFileInFolder(parentFolderId, segments.last()) }.getOrNull()
            if (remoteDup != null) {
                val sameContent = (remoteDup.md5Checksum.isNotBlank() &&
                    localHash.isNotBlank() &&
                    remoteDup.md5Checksum.equals(localHash, ignoreCase = true)) ||
                    (remoteDup.md5Checksum.isBlank() && remoteDup.sizeBytes == local.sizeBytes)
                if (sameContent) {
                    db.upsertSyncedFile(
                        SyncedFileRow(
                            folderId = folder.id,
                            relativePath = local.relativePath,
                            remoteFileId = remoteDup.id,
                            localUri = local.doc.uri.toString(),
                            localSize = local.sizeBytes,
                            localMtimeMs = local.modifiedMs,
                            localHash = localHash,
                            remoteSize = remoteDup.sizeBytes,
                            remoteModifiedAt = remoteDup.modifiedTime,
                            remoteMd5 = remoteDup.md5Checksum,
                            lastAction = "synced",
                            authorEmail = remoteDup.authorEmail.ifBlank { account.email },
                            authorName = remoteDup.authorName.ifBlank { account.displayName }
                        )
                    )
                    return false
                }
                targetRemoteId = remoteDup.id
            }
        }
        val uploaded = context.contentResolver.openInputStream(local.doc.uri)?.use { input ->
            api.uploadStreamResumable(
                parentFolderId = parentFolderId,
                fileName = segments.last(),
                existingFileId = targetRemoteId,
                mimeType = local.mimeType,
                sizeBytes = local.sizeBytes,
                input = input,
                senderEmail = account.email,
                senderName = account.displayName
            ) { sent, total ->
                val pct = if (total > 0) ((sent * 100L) / total).toInt().coerceIn(0, 100) else 100
                val senderLabel = account.displayName.ifBlank { account.email }
                db.updateRuntime(
                    db.buildRuntimeState(folder).copy(
                        status = "syncing",
                        message = "Enviando ${local.relativePath} ($pct%)",
                        currentFile = local.relativePath,
                        currentAction = "upload",
                        currentAuthor = senderLabel,
                        progressPercent = pct,
                        bytesTransferred = sent,
                        bytesTotal = total
                    )
                )
            }
        } ?: throw IllegalStateException("Não foi possível ler o arquivo local ${local.relativePath}")

        db.upsertSyncedFile(
            SyncedFileRow(
                folderId = folder.id,
                relativePath = local.relativePath,
                remoteFileId = uploaded.id,
                localUri = local.doc.uri.toString(),
                localSize = local.sizeBytes,
                localMtimeMs = local.modifiedMs,
                localHash = localHash,
                remoteSize = uploaded.sizeBytes,
                remoteModifiedAt = uploaded.modifiedTime,
                remoteMd5 = uploaded.md5Checksum,
                lastAction = "upload",
                authorEmail = account.email,
                authorName = account.displayName
            )
        )
        db.recordActivity(
            folderId = folder.id,
            folderName = folder.name,
            kind = "upload",
            level = "success",
            message = "Enviado ao Drive: ${local.relativePath}",
            relativePath = local.relativePath,
            authorEmail = account.email,
            fileSizeBytes = local.sizeBytes
        )
        return true
    }

    private fun saveConflictCopy(rootDoc: DocumentFile, local: LocalSafFile) {
        val dot = local.relativePath.lastIndexOf('.')
        val tag = DriveSyncConstants.formatTimestampTag()
        val conflictRel = if (dot > local.relativePath.lastIndexOf('/')) {
            "${local.relativePath.substring(0, dot)}.conflict-$tag${local.relativePath.substring(dot)}"
        } else {
            "${local.relativePath}.conflict-$tag"
        }
        val dest = createOrReplaceFile(rootDoc, conflictRel.split('/'), local.mimeType) ?: return
        context.contentResolver.openInputStream(local.doc.uri)?.use { input ->
            context.contentResolver.openOutputStream(dest.uri, "wt")?.use { out ->
                input.copyTo(out)
            }
        }
    }

    private fun moveLocalToQuarantine(rootDoc: DocumentFile, local: LocalSafFile) {
        val quarantineRoot = findOrCreateChildDir(rootDoc, DriveSyncConstants.QUARANTINE_DIR)
        if (quarantineRoot != null) {
            val copyName = "${DriveSyncConstants.formatTimestampTag()}-${local.doc.name ?: "arquivo"}"
            val qFile = quarantineRoot.createFile(local.mimeType, copyName)
            if (qFile != null) {
                context.contentResolver.openInputStream(local.doc.uri)?.use { input ->
                    context.contentResolver.openOutputStream(qFile.uri, "wt")?.use { out ->
                        input.copyTo(out)
                    }
                }
            }
        }
        local.doc.delete()
    }

    private fun walkSafTree(root: DocumentFile): List<LocalSafFile> {
        val out = mutableListOf<LocalSafFile>()
        fun walk(dir: DocumentFile, prefix: String) {
            for (child in dir.listFiles()) {
                val name = child.name ?: continue
                val rel = if (prefix.isEmpty()) name else "$prefix/$name"
                if (SyncRules.shouldIgnoreRelativePath(rel)) continue
                if (child.isDirectory) {
                    walk(child, rel)
                } else if (child.isFile) {
                    val size = queryUriSize(child.uri, child.length())
                    out.add(
                        LocalSafFile(
                            relativePath = rel,
                            doc = child,
                            sizeBytes = size,
                            modifiedMs = child.lastModified(),
                            mimeType = child.type ?: guessMime(name)
                        )
                    )
                }
            }
        }
        walk(root, "")
        return out
    }

    private fun createOrReplaceFile(
        rootDoc: DocumentFile,
        segments: List<String>,
        mimeType: String
    ): DocumentFile? {
        var dir = rootDoc
        for (i in 0 until segments.size - 1) {
            dir = findOrCreateChildDir(dir, segments[i]) ?: return null
        }
        val fileName = segments.last()
        val existing = dir.findFile(fileName)
        if (existing != null && existing.isFile) {
            return existing
        }
        return dir.createFile(mimeType, fileName)
    }

    private fun findOrCreateChildDir(parent: DocumentFile, name: String): DocumentFile? {
        val existing = findChildDirIgnoreCase(parent, name)
        if (existing != null) return existing
        return parent.createDirectory(name)
    }

    private fun resolveLocalHash(local: LocalSafFile, prev: SyncedFileRow?): String {
        if (prev != null &&
            prev.localSize == local.sizeBytes &&
            prev.localMtimeMs == local.modifiedMs &&
            prev.localHash.isNotBlank()
        ) {
            return prev.localHash
        }
        return computeMd5(local.doc.uri)
    }

    private fun computeMd5(uri: Uri): String {
        return runCatching {
            val md = MessageDigest.getInstance("MD5")
            context.contentResolver.openInputStream(uri)?.use { input: InputStream ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    md.update(buf, 0, n)
                }
            }
            md.digest().joinToString("") { "%02x".format(it) }
        }.getOrDefault("")
    }

    private fun queryUriSize(uri: Uri, fallback: Long): Long {
        if (fallback > 0L) return fallback
        return runCatching {
            context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { afd ->
                if (afd.length >= 0L) afd.length else fallback
            } ?: fallback
        }.getOrDefault(fallback)
    }

    private fun guessMime(fileName: String): String {
        val ext = fileName.substringAfterLast('.', "").lowercase(Locale.US)
        if (ext.isBlank()) return "application/octet-stream"
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }
}
