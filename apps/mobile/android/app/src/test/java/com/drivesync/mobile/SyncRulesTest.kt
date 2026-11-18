package com.drivesync.mobile

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncRulesTest {

    @Test
    fun enforcesHard4GbLimit() {
        val exact4Gb = 4L * 1024L * 1024L * 1024L
        assertFalse(SyncRules.exceedsUploadLimit(exact4Gb))
        assertTrue(SyncRules.exceedsUploadLimit(exact4Gb + 1L))
        assertFalse(SyncRules.exceedsUploadLimit(128L * 1024L * 1024L))
    }

    @Test
    fun filtersMasterFolderSendersProperly() {
        val joao = SenderRule(email = "joao@gmail.com", allowed = true)
        val luiz = SenderRule(email = "luiz@gmail.com", allowed = false)

        val blocklistPolicy = SenderPolicy(
            mode = "blocklist",
            unknownSenderAction = "allow",
            rules = listOf(joao, luiz)
        )
        assertTrue(SyncRules.isSenderAllowed(blocklistPolicy, "JOAO@gmail.com"))
        assertFalse(SyncRules.isSenderAllowed(blocklistPolicy, "Luiz@Gmail.com"))
        assertTrue(SyncRules.isSenderAllowed(blocklistPolicy, "maria@gmail.com"))

        val allowlistPolicy = SenderPolicy(
            mode = "allowlist",
            unknownSenderAction = "block",
            rules = listOf(joao, luiz)
        )
        assertTrue(SyncRules.isSenderAllowed(allowlistPolicy, "joao@gmail.com"))
        assertFalse(SyncRules.isSenderAllowed(allowlistPolicy, "luiz@gmail.com"))
        assertFalse(SyncRules.isSenderAllowed(allowlistPolicy, "maria@gmail.com"))
    }

    @Test
    fun ignoresControlAndTempPaths() {
        assertTrue(SyncRules.shouldIgnoreRelativePath(".drivesync/devices/android-1.json"))
        assertTrue(SyncRules.shouldIgnoreRelativePath(".DriveSync-Quarentena/file.pdf"))
        assertTrue(SyncRules.shouldIgnoreRelativePath("projetos/.git/HEAD"))
        assertTrue(SyncRules.shouldIgnoreRelativePath("Downloads/aula.crdownload"))
        assertTrue(SyncRules.shouldIgnoreRelativePath("~$" + "trabalho.docx"))
        assertFalse(SyncRules.shouldIgnoreRelativePath("Faculdade/Semestre1/prova.pdf"))
    }

    @Test
    fun parsesCodesAndDriveUrls() {
        val full = SyncRules.parseJoinInput("DS1.1AbCdEfGhIjKlMnOpQr.DS-A7K9-M2P4")
        assertEquals("full_code", full.matchedBy)
        assertEquals("1AbCdEfGhIjKlMnOpQr", full.remoteFolderId)
        assertEquals("DS-A7K9-M2P4", full.shortCode)

        val fromUrl = SyncRules.parseJoinInput("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQr?usp=sharing")
        assertEquals("drive_link", fromUrl.matchedBy)
        assertEquals("1AbCdEfGhIjKlMnOpQr", fromUrl.remoteFolderId)

        val fromShort = SyncRules.parseJoinInput("ds-a7k9-m2p4")
        assertEquals("short_code", fromShort.matchedBy)
        assertEquals("DS-A7K9-M2P4", fromShort.shortCode)
    }

    @Test
    fun parsesInstalledAndWebCredentialsJson() {
        val installedJson = """{"installed":{"client_id":"123.apps.googleusercontent.com","client_secret":"sec-abc"}}"""
        val creds = SyncRules.parseGoogleCredentialsJson(installedJson)
        assertEquals("123.apps.googleusercontent.com", creds.clientId)
        assertEquals("sec-abc", creds.clientSecret)
    }

    @Test
    fun parsesRcloneConfDriveProfilesAndIntervalBounds() {
        val ini = """
            [gdrive]
            type = drive
            client_id = cid-123.apps.googleusercontent.com
            client_secret = csec-xyz
            token = {"access_token":"tok1","refresh_token":"ref1","token_type":"Bearer"}
        """.trimIndent()
        val parsed = SyncRules.parseRcloneConf(ini, "gdrive")
        assertEquals("gdrive", parsed.remoteName)
        assertEquals("cid-123.apps.googleusercontent.com", parsed.clientId)
        assertEquals("csec-xyz", parsed.clientSecret)
        assertTrue(parsed.rawTokenJson.contains("ref1"))

        val autoDetected = SyncRules.parseRcloneConf(ini, "")
        assertEquals("gdrive", autoDetected.remoteName)

        val settings = MobileSettings.fromJson(
            JSONObject("""{"pollIntervalSeconds":15,"startOnBoot":true}"""),
            "dev-1",
            "Celular"
        )
        assertEquals(15, settings.pollIntervalSeconds)
        assertTrue(settings.startOnBoot)
    }
}
