package id.labjaringanukdw.frigate

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class FrigateDownloaderModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "FrigateDownloader"

  @ReactMethod
  fun downloadFile(
    url: String,
    fileName: String,
    cookie: String?,
    mimeType: String?,
    promise: Promise
  ) {
    try {
      val safeName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
      val req = DownloadManager.Request(Uri.parse(url))
      if (!cookie.isNullOrBlank()) {
        req.addRequestHeader("Cookie", cookie)
      }
      req.setMimeType(if (mimeType.isNullOrBlank()) "video/mp4" else mimeType)
      req.setTitle(safeName)
      req.setDescription("Mengunduh rekaman Frigate CCTV...")
      req.setNotificationVisibility(
        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
      )
      req.setAllowedOverMetered(true)
      req.setAllowedOverRoaming(true)
      req.setDestinationInExternalPublicDir(
        Environment.DIRECTORY_DOWNLOADS,
        "Frigate/$safeName"
      )

      val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      val id = dm.enqueue(req)
      promise.resolve(id.toString())
    } catch (e: Exception) {
      promise.reject("DOWNLOAD_ERROR", e.message ?: "Gagal memulai download", e)
    }
  }
}

class FrigateDownloaderPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ): List<NativeModule> = listOf(FrigateDownloaderModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
