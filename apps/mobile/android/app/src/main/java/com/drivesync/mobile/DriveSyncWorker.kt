package com.drivesync.mobile

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class DriveSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : Worker(appContext, params) {

    companion object {
        private const val WORK_NAME = "drivesync-periodic-sync"

        fun applySchedule(context: Context, settings: MobileSettings) {
            val wm = WorkManager.getInstance(context.applicationContext)
            if (!settings.backgroundSyncEnabled) {
                wm.cancelUniqueWork(WORK_NAME)
                return
            }
            val intervalMinutes = (settings.pollIntervalSeconds / 60).coerceAtLeast(15).toLong()
            val netType = if (settings.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(netType)
                .build()
            val req = PeriodicWorkRequestBuilder<DriveSyncWorker>(intervalMinutes, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            wm.enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                req
            )
        }
    }

    override fun doWork(): Result {
        val db = MobileStateDb(applicationContext)
        if (!db.getAccountInfo().connected) {
            return Result.success()
        }
        return try {
            val api = DriveApiClient(db)
            val engine = MobileSyncEngine(applicationContext, db, api)
            engine.syncAllFolders()
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
